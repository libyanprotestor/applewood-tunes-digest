import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { assignUnmatched, listItems, listUnmatched } from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/unmatched")({
  head: () => ({
    meta: [
      { title: "Unmatched sales | Apple Music Sales Dashboard" },
      { name: "description", content: "Review Apple report lines that did not match a catalog item." },
      { property: "og:title", content: "Unmatched sales | Apple Music Sales Dashboard" },
      { property: "og:description", content: "Review Apple report lines that did not match a catalog item." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: UnmatchedPage,
});

function UnmatchedPage() {
  const qc = useQueryClient();
  const [picked, setPicked] = useState<Record<string, string>>({});

  const rows = useQuery({ queryKey: ["unmatched"], queryFn: useServerFn(listUnmatched) });
  const listFn = useServerFn(listItems);
  const items = useQuery({ queryKey: ["items", "all"], queryFn: () => listFn({ data: {} }) });
  const assignFn = useServerFn(assignUnmatched);

  const assign = useMutation({
    mutationFn: (unmatchedId: string) =>
      assignFn({ data: { unmatchedId, itemId: picked[unmatchedId]! } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["unmatched"] });
      toast.success("Sales moved to the item");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Unmatched sales</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Report lines whose ISRC or UPC is not in the catalog. Assign one to an item to count its revenue.
      </p>

      <div className="mt-8 divide-y divide-border rounded-2xl border border-border bg-card">
        {(rows.data ?? []).length === 0 && (
          <p className="p-6 text-sm text-muted-foreground">Nothing waiting for review.</p>
        )}
        {(rows.data ?? []).map((row) => (
          <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{row.title ?? "Untitled"}</p>
              <p className="truncate text-xs text-muted-foreground">
                {row.sale_date} · {row.country_code} · {row.isrc ?? row.upc ?? "no code"} · {row.units} units ·{" "}
                ${Number(row.revenue_usd).toFixed(2)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Select
                value={picked[row.id] ?? ""}
                onValueChange={(value) => setPicked((p) => ({ ...p, [row.id]: value }))}
              >
                <SelectTrigger className="w-64">
                  <SelectValue placeholder="Assign to item" />
                </SelectTrigger>
                <SelectContent>
                  {(items.data ?? []).map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" disabled={!picked[row.id]} onClick={() => assign.mutate(row.id)}>
                Assign
              </Button>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
