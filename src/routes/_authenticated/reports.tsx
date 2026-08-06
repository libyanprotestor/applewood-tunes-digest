import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { listRuns, runReportFetch } from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({
    meta: [
      { title: "Report runs | Apple Music Sales Dashboard" },
      { name: "description", content: "History of daily Apple Music report fetches and manual re-runs." },
      { property: "og:title", content: "Report runs | Apple Music Sales Dashboard" },
      { property: "og:description", content: "History of daily Apple Music report fetches and manual re-runs." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ReportsPage,
});

const regions = [
  { id: "americas", label: "Americas" },
  { id: "japan_anz", label: "Japan / Australia / NZ" },
  { id: "europe_other", label: "Europe & rest of world" },
] as const;

function ReportsPage() {
  const qc = useQueryClient();
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const [date, setDate] = useState(yesterday);
  const [region, setRegion] = useState<(typeof regions)[number]["id"]>("americas");

  const runs = useQuery({ queryKey: ["runs"], queryFn: useServerFn(listRuns) });
  const runFn = useServerFn(runReportFetch);

  const run = useMutation({
    mutationFn: () => runFn({ data: { reportDate: date, region } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["runs"] });
      toast.success("Fetch finished");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Report runs</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Reports fetch automatically each day per region. You can also re-run a specific date.
      </p>

      <div className="mt-8 flex flex-wrap items-end gap-3 rounded-2xl border border-border bg-card p-6">
        <div className="space-y-2">
          <Label htmlFor="date">Report date</Label>
          <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="min-w-56 space-y-2">
          <Label>Region</Label>
          <Select value={region} onValueChange={(v) => setRegion(v as typeof region)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {regions.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={() => run.mutate()} disabled={run.isPending}>
          {run.isPending ? "Fetching…" : "Fetch now"}
        </Button>
      </div>

      <div className="mt-8 divide-y divide-border rounded-2xl border border-border bg-card">
        {(runs.data ?? []).length === 0 && (
          <p className="p-6 text-sm text-muted-foreground">No runs recorded yet.</p>
        )}
        {(runs.data ?? []).map((r) => (
          <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="text-sm font-medium">
                {r.report_date} · {r.region}
              </p>
              <p className="text-xs text-muted-foreground">
                {r.rows_matched ?? 0} matched · {r.rows_unmatched ?? 0} unmatched
                {r.message ? ` · ${r.message}` : ""}
              </p>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                r.status === "success"
                  ? "bg-primary/15 text-primary"
                  : r.status === "failed"
                    ? "bg-destructive/15 text-destructive"
                    : "bg-secondary text-secondary-foreground"
              }`}
            >
              {r.status}
            </span>
          </div>
        ))}
      </div>
    </main>
  );
}
