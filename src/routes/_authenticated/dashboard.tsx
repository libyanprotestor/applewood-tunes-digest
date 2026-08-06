import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as ReTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getBreakdown, getSalesSummary, getViewer } from "@/lib/analytics.functions";
import { listSublabels } from "@/lib/admin.functions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Revenue overview | Apple Music Sales Dashboard" },
      {
        name: "description",
        content: "Daily, weekly, monthly and yearly Apple Music units and USD revenue by sublabel.",
      },
      { property: "og:title", content: "Revenue overview | Apple Music Sales Dashboard" },
      {
        property: "og:description",
        content: "Daily, weekly, monthly and yearly Apple Music units and USD revenue by sublabel.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Dashboard,
});

type Bucket = "day" | "week" | "month" | "year";

const presets: { id: Bucket; label: string; days: number }[] = [
  { id: "day", label: "Daily", days: 30 },
  { id: "week", label: "Weekly", days: 182 },
  { id: "month", label: "Monthly", days: 365 },
  { id: "year", label: "Yearly", days: 365 * 5 },
];

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const num = new Intl.NumberFormat("en-US");

function isoDaysAgo(days: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function Dashboard() {
  const [bucket, setBucket] = useState<Bucket>("day");
  const [sublabelId, setSublabelId] = useState<string>("all");

  const preset = presets.find((p) => p.id === bucket)!;
  const range = useMemo(
    () => ({ from: isoDaysAgo(preset.days), to: new Date().toISOString().slice(0, 10) }),
    [preset.days],
  );

  const viewer = useQuery({ queryKey: ["viewer"], queryFn: useServerFn(getViewer) });
  const isAdmin = viewer.data?.isAdmin ?? false;

  const sublabels = useQuery({
    queryKey: ["sublabels"],
    queryFn: useServerFn(listSublabels),
    enabled: isAdmin,
  });

  const scoped = sublabelId === "all" ? null : sublabelId;
  const summaryFn = useServerFn(getSalesSummary);
  const breakdownFn = useServerFn(getBreakdown);

  const summary = useQuery({
    queryKey: ["summary", bucket, scoped, range.from],
    queryFn: () => summaryFn({ data: { ...range, bucket, sublabelId: scoped } }),
  });

  const breakdown = useQuery({
    queryKey: ["breakdown", scoped, range.from],
    queryFn: () => breakdownFn({ data: { ...range, sublabelId: scoped } }),
  });

  const chartData = (summary.data ?? []).map((row) => ({
    label: row.bucket.slice(0, 10),
    revenue: Number(row.revenue_usd),
    units: Number(row.units),
  }));

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            {isAdmin ? "Company revenue" : (viewer.data?.sublabelName ?? "Your revenue")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {range.from} → {range.to}, converted to USD at the report date's rate.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {isAdmin && (
            <Select value={sublabelId} onValueChange={setSublabelId}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="All sublabels" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sublabels</SelectItem>
                {(sublabels.data ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className="flex rounded-full border border-border p-1">
            {presets.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setBucket(p.id)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  bucket === p.id ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-8 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-3">
        <Stat label="Revenue (USD)" value={usd.format(breakdown.data?.totalRevenue ?? 0)} />
        <Stat label="Units sold" value={num.format(breakdown.data?.totalUnits ?? 0)} />
        <Stat
          label="Catalog items with sales"
          value={num.format(breakdown.data?.topItems.length ?? 0)}
        />
      </div>

      <section className="mt-8 rounded-2xl border border-border bg-card p-6">
        <h2 className="text-sm font-semibold">Revenue over time</h2>
        <div className="mt-6 h-72">
          {chartData.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No sales in this period yet. Once a report is fetched the chart fills in.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ left: -12, right: 8 }}>
                <defs>
                  <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <ReTooltip
                  contentStyle={{
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 12,
                    fontSize: 12,
                  }}
                  formatter={(value: number, name) =>
                    name === "revenue" ? usd.format(value) : num.format(value)
                  }
                />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  stroke="hsl(var(--primary))"
                  fill="url(#rev)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Panel title="Top items">
          {(breakdown.data?.topItems ?? []).length === 0 ? (
            <Empty />
          ) : (
            <ul className="divide-y divide-border">
              {breakdown.data?.topItems.map((item) => (
                <li key={`${item.title}-${item.artist}`} className="flex items-center justify-between py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{item.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {item.artist || "—"} · {item.type} · {num.format(item.units)} units
                    </p>
                  </div>
                  <span className="ml-4 shrink-0 text-sm tabular-nums">{usd.format(item.revenue)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={isAdmin ? "Top sublabels" : "By item type"}>
          {isAdmin ? (
            (breakdown.data?.topSublabels ?? []).length === 0 ? (
              <Empty />
            ) : (
              <ul className="divide-y divide-border">
                {breakdown.data?.topSublabels.map((label) => (
                  <li key={label.name} className="flex items-center justify-between py-3">
                    <div>
                      <p className="text-sm font-medium">{label.name}</p>
                      <p className="text-xs text-muted-foreground">{num.format(label.units)} units</p>
                    </div>
                    <span className="text-sm tabular-nums">{usd.format(label.revenue)}</span>
                  </li>
                ))}
              </ul>
            )
          ) : (breakdown.data?.byType ?? []).length === 0 ? (
            <Empty />
          ) : (
            <ul className="divide-y divide-border">
              {breakdown.data?.byType.map((row) => (
                <li key={row.type} className="flex items-center justify-between py-3">
                  <p className="text-sm font-medium capitalize">{row.type}</p>
                  <span className="text-sm tabular-nums">{usd.format(row.revenue)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card p-6">
      <p className="text-xs uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="mt-2 text-3xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-6">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function Empty() {
  return <p className="py-6 text-sm text-muted-foreground">Nothing to show for this period.</p>;
}
