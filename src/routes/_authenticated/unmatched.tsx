import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  assignUnmatched,
  assignUnmatchedStream,
  createItemFromUnmatched,
  listItems,
  listSublabels,
  listUnmatched,
  listUnmatchedStreams,
} from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

type ItemType = "ringtone" | "single" | "album" | "other";

type NewItemDraft = {
  kind: "sale" | "stream";
  unmatchedId: string;
  title: string;
  artistName: string;
  isrc?: string;
  upc?: string;
  appleId?: string;
};

type SaleGroup = {
  key: string;
  seedId: string;
  title: string;
  artistName: string | null;
  isrc: string | null;
  upc: string | null;
  lines: number;
  units: number;
  revenue: number;
  dates: string[];
};

type StreamGroup = {
  key: string;
  seedId: string;
  name: string;
  appleIdentifier: string | null;
  lines: number;
  streams: number;
  dates: string[];
};

function UnmatchedPage() {
  const qc = useQueryClient();
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [pickedStream, setPickedStream] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<NewItemDraft | null>(null);
  const [sublabelId, setSublabelId] = useState("");
  const [itemType, setItemType] = useState<ItemType>("single");

  const rows = useQuery({ queryKey: ["unmatched"], queryFn: useServerFn(listUnmatched) });
  const listFn = useServerFn(listItems);
  const items = useQuery({ queryKey: ["items", "all"], queryFn: () => listFn({ data: {} }) });
  const sublabels = useQuery({ queryKey: ["sublabels"], queryFn: useServerFn(listSublabels) });
  const streamRows = useQuery({
    queryKey: ["unmatched-streams"],
    queryFn: useServerFn(listUnmatchedStreams),
  });

  const assignFn = useServerFn(assignUnmatched);
  const assignStreamFn = useServerFn(assignUnmatchedStream);
  const createItemFn = useServerFn(createItemFromUnmatched);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["unmatched"] });
    void qc.invalidateQueries({ queryKey: ["unmatched-streams"] });
    void qc.invalidateQueries({ queryKey: ["items"] });
  };

  const saleGroups = useMemo<SaleGroup[]>(() => {
    const map = new Map<string, SaleGroup>();
    for (const row of rows.data ?? []) {
      const key = row.isrc ?? row.upc ?? `id:${row.id}`;
      const group = map.get(key);
      if (group) {
        group.lines += 1;
        group.units += row.units ?? 0;
        group.revenue += Number(row.revenue_usd ?? 0);
        if (!group.dates.includes(row.sale_date)) group.dates.push(row.sale_date);
      } else {
        map.set(key, {
          key,
          seedId: row.id,
          title: row.title ?? "Untitled",
          artistName: row.artist_name,
          isrc: row.isrc,
          upc: row.upc,
          lines: 1,
          units: row.units ?? 0,
          revenue: Number(row.revenue_usd ?? 0),
          dates: [row.sale_date],
        });
      }
    }
    return [...map.values()].sort((a, b) => b.revenue - a.revenue);
  }, [rows.data]);

  const streamGroups = useMemo<StreamGroup[]>(() => {
    const map = new Map<string, StreamGroup>();
    for (const row of streamRows.data ?? []) {
      const key = row.apple_identifier ?? `id:${row.id}`;
      const group = map.get(key);
      if (group) {
        group.lines += 1;
        group.streams += row.streams ?? 0;
        if (!group.dates.includes(row.stream_date)) group.dates.push(row.stream_date);
      } else {
        map.set(key, {
          key,
          seedId: row.id,
          name: row.container_name ?? "Unknown",
          appleIdentifier: row.apple_identifier,
          lines: 1,
          streams: row.streams ?? 0,
          dates: [row.stream_date],
        });
      }
    }
    return [...map.values()].sort((a, b) => b.streams - a.streams);
  }, [streamRows.data]);

  const assign = useMutation({
    mutationFn: (group: SaleGroup) =>
      assignFn({ data: { unmatchedId: group.seedId, itemId: picked[group.key]!, applyToAll: true } }),
    onSuccess: (res) => {
      refresh();
      toast.success(`${res.count} sale line${res.count === 1 ? "" : "s"} moved to the item`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const assignStream = useMutation({
    mutationFn: (group: StreamGroup) =>
      assignStreamFn({
        data: { unmatchedId: group.seedId, itemId: pickedStream[group.key]!, applyToAll: true },
      }),
    onSuccess: (res) => {
      refresh();
      toast.success(`${res.count} stream line${res.count === 1 ? "" : "s"} moved to the item`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createAndAssign = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error("Nothing to create");
      if (!sublabelId) throw new Error("Pick a sublabel");
      if (!draft.title.trim()) throw new Error("Title is required");
      if (draft.isrc && !/^[A-Za-z0-9]{12}$/.test(draft.isrc.trim()))
        throw new Error("ISRC must be 12 letters or digits");
      if (draft.upc && !/^\d{8,14}$/.test(draft.upc.trim()))
        throw new Error("UPC must be 8-14 digits");

      const created = await createItemFn({
        data: {
          kind: draft.kind,
          unmatchedId: draft.unmatchedId,
          sublabelId,
          title: draft.title.trim(),
          artistName: draft.artistName.trim() || undefined,
          itemType,
          isrc: draft.isrc?.trim() || undefined,
          upc: draft.upc?.trim() || undefined,
          appleId: draft.appleId?.trim() || undefined,
        },
      });
      return draft.kind === "sale"
        ? assignFn({ data: { unmatchedId: draft.unmatchedId, itemId: created.itemId, applyToAll: true } })
        : assignStreamFn({
            data: { unmatchedId: draft.unmatchedId, itemId: created.itemId, applyToAll: true },
          });
    },
    onSuccess: (res) => {
      setDraft(null);
      setSublabelId("");
      setItemType("single");
      refresh();
      toast.success(`Item created and ${res.count} line${res.count === 1 ? "" : "s"} assigned`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const itemOptions = items.data ?? [];

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Unmatched sales</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Report lines whose ISRC or UPC is not in the catalog, grouped by identifier. Assigning moves every
        line in the group.
      </p>

      <div className="mt-8 divide-y divide-border rounded-2xl border border-border bg-card">
        {saleGroups.length === 0 && (
          <p className="p-6 text-sm text-muted-foreground">Nothing waiting for review.</p>
        )}
        {saleGroups.map((group) => (
          <div key={group.key} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{group.title}</p>
              <p className="truncate text-xs text-muted-foreground">
                {group.isrc ?? group.upc ?? "no code"} · {group.lines} line{group.lines === 1 ? "" : "s"} ·{" "}
                {group.units} units · ${group.revenue.toFixed(2)} · {group.dates.length} day
                {group.dates.length === 1 ? "" : "s"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Select
                value={picked[group.key] ?? ""}
                onValueChange={(value) => setPicked((p) => ({ ...p, [group.key]: value }))}
              >
                <SelectTrigger className="w-56">
                  <SelectValue placeholder="Assign to item" />
                </SelectTrigger>
                <SelectContent>
                  {itemOptions.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                disabled={!picked[group.key] || assign.isPending}
                onClick={() => assign.mutate(group)}
              >
                Assign all
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setDraft({
                    kind: "sale",
                    unmatchedId: group.seedId,
                    title: group.title,
                    artistName: group.artistName ?? "",
                    isrc: group.isrc ?? "",
                    upc: group.upc ?? "",
                  })
                }
              >
                New item
              </Button>
            </div>
          </div>
        ))}
      </div>

      <h2 className="mt-12 text-2xl font-semibold tracking-tight">Unmatched streams</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Apple Music streaming lines grouped by Apple Identifier.
      </p>

      <div className="mt-6 divide-y divide-border rounded-2xl border border-border bg-card">
        {streamGroups.length === 0 && (
          <p className="p-6 text-sm text-muted-foreground">Nothing waiting for review.</p>
        )}
        {streamGroups.map((group) => (
          <div key={group.key} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{group.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {group.appleIdentifier ?? "no code"} · {group.lines} line{group.lines === 1 ? "" : "s"} ·{" "}
                {group.streams} streams · {group.dates.length} day{group.dates.length === 1 ? "" : "s"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Select
                value={pickedStream[group.key] ?? ""}
                onValueChange={(value) => setPickedStream((p) => ({ ...p, [group.key]: value }))}
              >
                <SelectTrigger className="w-56">
                  <SelectValue placeholder="Assign to item" />
                </SelectTrigger>
                <SelectContent>
                  {itemOptions.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                disabled={!pickedStream[group.key] || assignStream.isPending}
                onClick={() => assignStream.mutate(group)}
              >
                Assign all
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setDraft({
                    kind: "stream",
                    unmatchedId: group.seedId,
                    title: group.name === "Unknown" ? "" : group.name,
                    artistName: "",
                    appleId: group.appleIdentifier ?? "",
                  })
                }
              >
                New item
              </Button>
            </div>
          </div>
        ))}
      </div>

      <Dialog open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create catalog item</DialogTitle>
          </DialogHeader>
          {draft && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Sublabel</Label>
                <Select value={sublabelId} onValueChange={setSublabelId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pick a sublabel" />
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
              <div className="space-y-2">
                <Label htmlFor="new-title">Title</Label>
                <Input
                  id="new-title"
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-artist">Artist</Label>
                <Input
                  id="new-artist"
                  value={draft.artistName}
                  onChange={(e) => setDraft({ ...draft, artistName: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={itemType} onValueChange={(v) => setItemType(v as ItemType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="single">Single</SelectItem>
                    <SelectItem value="album">Album</SelectItem>
                    <SelectItem value="ringtone">Ringtone</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="new-isrc">ISRC</Label>
                  <Input
                    id="new-isrc"
                    value={draft.isrc ?? ""}
                    onChange={(e) => setDraft({ ...draft, isrc: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-upc">UPC</Label>
                  <Input
                    id="new-upc"
                    value={draft.upc ?? ""}
                    onChange={(e) => setDraft({ ...draft, upc: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-apple">Apple ID</Label>
                  <Input
                    id="new-apple"
                    value={draft.appleId ?? ""}
                    onChange={(e) => setDraft({ ...draft, appleId: e.target.value })}
                  />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button disabled={createAndAssign.isPending} onClick={() => createAndAssign.mutate()}>
              Create and assign all
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
