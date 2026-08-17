import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { deliveryQueue, importIsrcCodes, isrcPoolStats, retryDelivery } from "@/lib/delivery.functions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/deliveries")({
  head: () => ({
    meta: [
      { title: "Deliveries & ISRC pool | Apple Music Delivery Console" },
      {
        name: "description",
        content: "Track packaging and Apple Transporter deliveries and manage the pool of available ISRC codes.",
      },
      { property: "og:title", content: "Deliveries & ISRC pool | Apple Music Delivery Console" },
      {
        property: "og:description",
        content: "Track packaging and Apple Transporter deliveries and manage the pool of available ISRC codes.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DeliveriesPage,
});

function DeliveriesPage() {
  const qc = useQueryClient();
  const queue = useQuery({
    queryKey: ["delivery-queue"],
    queryFn: useServerFn(deliveryQueue),
    refetchInterval: 10000,
  });
  const pool = useQuery({ queryKey: ["isrc-pool"], queryFn: useServerFn(isrcPoolStats) });
  const importFn = useServerFn(importIsrcCodes);
  const retryFn = useServerFn(retryDelivery);

  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleImport() {
    if (!raw.trim()) {
      toast.error("Paste some ISRC codes first.");
      return;
    }
    setBusy(true);
    try {
      const report = await importFn({ data: { raw } });
      toast.success(
        `Added ${report.added} code${report.added === 1 ? "" : "s"} · ${report.duplicates} already there · ${report.invalid.length} invalid`,
      );
      setRaw("");
      await qc.invalidateQueries({ queryKey: ["isrc-pool"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Deliveries</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Packaging and Apple Transporter uploads run on the delivery worker; progress lands here.
      </p>

      <div className="mt-8 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-3">
        <Stat label="ISRCs in pool" value={pool.data?.total ?? 0} />
        <Stat label="Free" value={pool.data?.free ?? 0} />
        <Stat label="Assigned" value={pool.data?.used ?? 0} />
      </div>

      <section className="mt-8 rounded-2xl border border-border bg-card p-6">
        <h2 className="text-sm font-semibold">Add ISRC codes</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Paste codes separated by spaces, commas or new lines. Duplicates and malformed codes are skipped.
        </p>
        <Textarea
          className="mt-3 h-32 font-mono text-xs"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="QZNWX2512345&#10;QZNWX2512346"
        />
        <Button className="mt-3" onClick={handleImport} disabled={busy}>
          {busy ? "Importing…" : "Import codes"}
        </Button>
      </section>

      <section className="mt-8 rounded-2xl border border-border bg-card">
        <h2 className="border-b border-border p-4 text-sm font-semibold">
          Delivery queue ({queue.data?.length ?? 0})
        </h2>
        <ul className="max-h-[32rem] divide-y divide-border overflow-y-auto">
          {(queue.data ?? []).length === 0 && (
            <li className="p-6 text-sm text-muted-foreground">Nothing queued.</li>
          )}
          {(queue.data ?? []).map((job) => {
            const upload = job.uploads as
              | { id: string; title: string; kind: string; sublabels: { name: string } | null }
              | null;
            return (
              <li key={job.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  {upload ? (
                    <Link
                      to="/uploads/$id"
                      params={{ id: upload.id }}
                      className="truncate text-sm font-medium hover:underline"
                    >
                      {upload.title}
                    </Link>
                  ) : (
                    <span className="text-sm font-medium">Upload removed</span>
                  )}
                  <p className="truncate text-xs text-muted-foreground">
                    {upload?.kind ?? "—"} · {upload?.sublabels?.name ?? "—"} · {job.state} · attempt{" "}
                    {job.attempts ?? 0}
                    {job.worker_id ? ` · ${job.worker_id}` : ""}
                    {job.error_message ? ` · ${job.error_message}` : ""}
                  </p>
                </div>
                {job.state === "failed" && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      await retryFn({ data: { jobId: job.id } });
                      toast.success("Requeued");
                      await qc.invalidateQueries({ queryKey: ["delivery-queue"] });
                    }}
                  >
                    Retry
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-card p-5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value.toLocaleString("en-US")}</p>
    </div>
  );
}
