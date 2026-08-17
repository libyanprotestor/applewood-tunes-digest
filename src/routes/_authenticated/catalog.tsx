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
    if (!title) continue;
    const raw = (iType >= 0 ? cells[iType] : "")?.toLowerCase() ?? "";
    const itemType: Row["itemType"] =
      raw === "ringtone" || raw === "album" || raw === "other" ? raw : "single";
    rows.push({
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

function CatalogPage() {
  const qc = useQueryClient();
  const [sublabelId, setSublabelId] = useState<string>("");
  const [rows, setRows] = useState<Row[]>([]);

  const sublabels = useQuery({ queryKey: ["sublabels"], queryFn: useServerFn(listSublabels) });
  const listFn = useServerFn(listItems);
  const importFn = useServerFn(importItems);
  const deleteFn = useServerFn(deleteItem);

  const items = useQuery({
    queryKey: ["items", sublabelId],
    queryFn: () => listFn({ data: { sublabelId: sublabelId || null } }),
  });

  const upload = useMutation({
    mutationFn: () => importFn({ data: { sublabelId, rows } }),
    onSuccess: (res) => {
      setRows([]);
      void qc.invalidateQueries({ queryKey: ["items"] });
      toast.success(`Imported ${res.inserted} items${res.skipped ? `, ${res.skipped} skipped` : ""}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["items"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Catalog</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Upload a CSV with columns: title, artist, isrc, upc, apple_id, type (ringtone / single / album).
        Apple ID is Apple&apos;s numeric identifier used in streaming reports.
      </p>

      <div className="mt-8 flex flex-wrap items-end gap-3 rounded-2xl border border-border bg-card p-6">
        <div className="min-w-56 space-y-2">
          <Label>Sublabel</Label>
          <Select value={sublabelId} onValueChange={setSublabelId}>
            <SelectTrigger>
              <SelectValue placeholder="Choose a sublabel" />
            </SelectTrigger>
            <SelectContent>
              {(sublabels.data ?? []).map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
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
        <Button
          onClick={() => upload.mutate()}
          disabled={!sublabelId || rows.length === 0 || upload.isPending}
        >
          Import {rows.length > 0 ? `${rows.length} rows` : ""}
        </Button>
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
