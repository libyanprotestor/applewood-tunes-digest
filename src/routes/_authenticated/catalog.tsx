import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { deleteItem, importItems, listItems, listSublabels } from "@/lib/admin.functions";
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

export const Route = createFileRoute("/_authenticated/catalog")({
  head: () => ({
    meta: [
      { title: "Catalog | Apple Music Sales Dashboard" },
      { name: "description", content: "Import ringtones, singles and albums per sublabel from CSV." },
      { property: "og:title", content: "Catalog | Apple Music Sales Dashboard" },
      { property: "og:description", content: "Import ringtones, singles and albums per sublabel from CSV." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CatalogPage,
});

type Row = {
  sublabel: string;
  title: string;
  artistName?: string;
  isrc?: string;
  upc?: string;
  appleId?: string;
  itemType: "ringtone" | "single" | "album" | "other";
};

function parseCsv(text: string): Row[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const header = lines[0]!.split(",").map((h) => h.trim().toLowerCase());
  const idx = (names: string[]) => header.findIndex((h) => names.includes(h));
  const iSublabel = idx(["sublabel", "sub label", "sub-label", "label"]);
  const iTitle = idx(["title", "name", "track"]);
  const iArtist = idx(["artist", "artist_name", "artistname"]);
  const iIsrc = idx(["isrc"]);
  const iUpc = idx(["upc", "ean", "barcode"]);
  const iApple = idx(["apple_id", "appleid", "apple identifier", "apple_identifier", "adam id", "adam_id"]);
  const iType = idx(["type", "item_type", "itemtype"]);

  const rows: Row[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const title = iTitle >= 0 ? cells[iTitle] : undefined;
    const sublabel = iSublabel >= 0 ? cells[iSublabel] : undefined;
    if (!title || !sublabel) continue;
    const raw = (iType >= 0 ? cells[iType] : "")?.toLowerCase() ?? "";
    const itemType: Row["itemType"] =
      raw === "ringtone" || raw === "album" || raw === "other" ? raw : "single";
    rows.push({
      sublabel,
      title,
      ...(iArtist >= 0 && cells[iArtist] ? { artistName: cells[iArtist] } : {}),
      ...(iIsrc >= 0 && cells[iIsrc] ? { isrc: cells[iIsrc] } : {}),
      ...(iUpc >= 0 && cells[iUpc] ? { upc: cells[iUpc] } : {}),
      ...(iApple >= 0 && cells[iApple] ? { appleId: cells[iApple] } : {}),
      itemType,
    });
  }
  return rows;
}

type ImportReport = Awaited<ReturnType<typeof importItems>>;

function CatalogPage() {
  const qc = useQueryClient();
  const [sublabelId, setSublabelId] = useState<string>("");
  const [rows, setRows] = useState<Row[]>([]);
  const [report, setReport] = useState<ImportReport | null>(null);

  const sublabels = useQuery({ queryKey: ["sublabels"], queryFn: useServerFn(listSublabels) });
  const listFn = useServerFn(listItems);
  const importFn = useServerFn(importItems);
  const deleteFn = useServerFn(deleteItem);

  const items = useQuery({
    queryKey: ["items", sublabelId],
    queryFn: () => listFn({ data: { sublabelId: sublabelId || null } }),
  });

  const upload = useMutation({
    mutationFn: () => importFn({ data: { rows } }),
    onSuccess: (res) => {
      setRows([]);
      setReport(res);
      void qc.invalidateQueries({ queryKey: ["items"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });


  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      void qc.invalidateQueries({ queryKey: ["items"] });
      toast.success("Item deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sublabelCount = new Set(rows.map((r) => r.sublabel.toLowerCase())).size;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Catalog</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Upload a CSV with columns: sublabel, title, artist, isrc, upc, apple_id, type (ringtone / single / album).
        Each row&apos;s sublabel column decides where the item lands, so one sheet can cover many sublabels.
        Sublabel names must match existing sublabels.
      </p>

      <div className="mt-8 flex flex-wrap items-end gap-3 rounded-2xl border border-border bg-card p-6">
        <div className="min-w-56 flex-1 space-y-2">
          <Label htmlFor="csv">CSV file</Label>
          <Input
            id="csv"
            type="file"
            accept=".csv,text/csv"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setRows(parseCsv(await file.text()));
            }}
          />
        </div>
        <Button onClick={() => upload.mutate()} disabled={rows.length === 0 || upload.isPending}>
          Import {rows.length > 0 ? `${rows.length} rows · ${sublabelCount} sublabels` : ""}
        </Button>
      </div>

      {report && (
        <section className="mt-8 space-y-6 rounded-2xl border border-border bg-card p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Import report</h2>
              <p className="text-sm text-muted-foreground">
                {report.totalRows} rows read · {report.inserted} items added ·{" "}
                {report.skippedUnknownSublabel} skipped (unknown sublabel) · {report.duplicateCount} duplicates
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setReport(null)}>
              Dismiss
            </Button>
          </div>

          <div>
            <h3 className="text-sm font-medium">Added per sublabel</h3>
            {report.perSublabel.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">No items were added.</p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm">
                {report.perSublabel.map((s) => (
                  <li key={s.name} className="flex justify-between border-b border-border/60 py-1">
                    <span>{s.name}</span>
                    <span className="tabular-nums text-muted-foreground">{s.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {report.unknownSublabels.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-destructive">
                Sublabels not found in the database
              </h3>
              <ul className="mt-2 space-y-1 text-sm">
                {report.unknownSublabels.map((s) => (
                  <li key={s.name} className="flex justify-between border-b border-border/60 py-1">
                    <span>{s.name || "(empty)"}</span>
                    <span className="tabular-nums text-muted-foreground">{s.count} not added</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {report.duplicates.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-destructive">
                Duplicated ISRC / Apple ID ({report.duplicateCount})
              </h3>
              <div className="mt-2 max-h-72 overflow-y-auto rounded-xl border border-border">
                {report.duplicates.map((d, i) => (
                  <div key={`${d.title}-${i}`} className="border-b border-border/60 p-3 last:border-0">
                    <p className="text-sm font-medium">{d.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {d.sublabel} · ISRC {d.isrc ?? "—"} · Apple ID {d.appleId ?? "—"} · duplicate {d.reason}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {report.errors.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-destructive">Other errors</h3>
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                {report.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}



      <div className="mt-8 min-w-56 space-y-2">
        <Label>Filter by sublabel</Label>
        <Select value={sublabelId || "all"} onValueChange={(v) => setSublabelId(v === "all" ? "" : v)}>
          <SelectTrigger>
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
      </div>


      <div className="mt-8 divide-y divide-border rounded-2xl border border-border bg-card">
        {(items.data ?? []).length === 0 && (
          <p className="p-6 text-sm text-muted-foreground">No items yet.</p>
        )}
        {(items.data ?? []).map((item) => (
          <div key={item.id} className="flex items-center justify-between gap-4 p-4">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{item.title}</p>
              <p className="truncate text-xs text-muted-foreground">
                {item.artist_name ?? "—"} · {item.item_type} ·{" "}
                {item.isrc ?? item.upc ?? "no code"}
                {item.apple_id ? ` · Apple ID ${item.apple_id}` : ""}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => remove.mutate(item.id)}>
              Delete
            </Button>
          </div>
        ))}
      </div>
    </main>
  );
}
