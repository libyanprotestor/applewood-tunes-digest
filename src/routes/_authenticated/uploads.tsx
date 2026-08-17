import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  createUpload,
  finishFileUpload,
  listUploads,
  startFileUpload,
  storageStatus,
  submitUpload,
} from "@/lib/uploads.functions";
import { getViewer } from "@/lib/analytics.functions";
import { listSublabels } from "@/lib/admin.functions";
import { formatBytes, pushFile } from "@/lib/upload-client";
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

export const Route = createFileRoute("/_authenticated/uploads")({
  head: () => ({
    meta: [
      { title: "Release uploads | Apple Music Delivery Console" },
      {
        name: "description",
        content: "Upload albums, singles and ringtone folders for review, packaging and delivery to Apple.",
      },
      { property: "og:title", content: "Release uploads | Apple Music Delivery Console" },
      {
        property: "og:description",
        content: "Upload albums, singles and ringtone folders for review, packaging and delivery to Apple.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: UploadsPage,
});

const kinds = [
  { id: "album", label: "Album" },
  { id: "singles", label: "Singles" },
  { id: "ringtones", label: "Ringtones" },
] as const;

const statuses = [
  "all",
  "draft",
  "uploaded",
  "in_review",
  "ready",
  "packaging",
  "delivering",
  "delivered",
  "rejected",
] as const;

const statusTone: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  uploaded: "bg-primary/10 text-primary",
  in_review: "bg-primary/10 text-primary",
  ready: "bg-primary/15 text-primary",
  packaging: "bg-primary/15 text-primary",
  delivering: "bg-primary/15 text-primary",
  delivered: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  rejected: "bg-destructive/10 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
};

function UploadsPage() {
  const qc = useQueryClient();
  const viewer = useQuery({ queryKey: ["viewer"], queryFn: useServerFn(getViewer) });
  const isAdmin = viewer.data?.isAdmin ?? false;
  const storage = useQuery({ queryKey: ["storage-status"], queryFn: useServerFn(storageStatus) });

  const [status, setStatus] = useState<string>("all");
  const listFn = useServerFn(listUploads);
  const uploads = useQuery({
    queryKey: ["uploads", status],
    queryFn: () => listFn({ data: { status } }),
  });

  const sublabels = useQuery({
    queryKey: ["sublabels"],
    queryFn: useServerFn(listSublabels),
    enabled: isAdmin,
  });

  const createFn = useServerFn(createUpload);
  const startFn = useServerFn(startFileUpload);
  const finishFn = useServerFn(finishFileUpload);
  const submitFn = useServerFn(submitUpload);

  const [kind, setKind] = useState<(typeof kinds)[number]["id"]>("album");
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [sublabelId, setSublabelId] = useState<string>("");
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);

  const totalBytes = files.reduce((a, f) => a + f.size, 0);

  async function handleUpload() {
    if (!title.trim()) return toast.error("Give the release a title.");
    if (files.length === 0) return toast.error("Pick the audio files and the cover artwork.");
    if (isAdmin && !sublabelId) return toast.error("Choose which sublabel this release belongs to.");

    setBusy(true);
    setProgress({});
    try {
      const { id } = await createFn({
        data: {
          kind,
          title: title.trim(),
          artistName: artist.trim() || undefined,
          ...(isAdmin && sublabelId ? { sublabelId } : {}),
        },
      });

      for (const file of files) {
        const start = await startFn({
          data: {
            uploadId: id,
            filename: file.name,
            contentType: file.type || "application/octet-stream",
            bytes: file.size,
          },
        });
        const { parts } = await pushFile(file, start, (fraction) =>
          setProgress((p) => ({ ...p, [file.name]: fraction })),
        );
        await finishFn({
          data: {
            uploadId: id,
            key: start.key,
            filename: start.filename,
            contentType: file.type || "application/octet-stream",
            bytes: file.size,
            role: start.role,
            multipartId: start.multipartId,
            parts,
          },
        });
        setProgress((p) => ({ ...p, [file.name]: 1 }));
      }

      const result = await submitFn({ data: { uploadId: id } });
      if (!result.ok) toast.warning(result.message);
      else toast.success("Upload sent for review.");

      setTitle("");
      setArtist("");
      setFiles([]);
      setProgress({});
      await qc.invalidateQueries({ queryKey: ["uploads"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Release uploads</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Files go straight from this browser to secure storage, then packaging and Apple delivery happen automatically.
      </p>

      {storage.data && !storage.data.configured && (
        <p className="mt-6 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          Storage is not configured yet, so uploads will fail. Add the storage keys and reload.
        </p>
      )}

      <section className="mt-8 rounded-2xl border border-border bg-card p-6">
        <h2 className="text-sm font-semibold">New release</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Label className="text-xs">Type</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {kinds.map((k) => (
                  <SelectItem key={k.id} value={k.id}>
                    {k.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Title</Label>
            <Input className="mt-1" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Artist (optional)</Label>
            <Input className="mt-1" value={artist} onChange={(e) => setArtist(e.target.value)} />
          </div>
          {isAdmin && (
            <div>
              <Label className="text-xs">Sublabel</Label>
              <Select value={sublabelId} onValueChange={setSublabelId}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Choose sublabel" />
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
          )}
        </div>

        <div className="mt-4">
          <Label className="text-xs">Audio, artwork and any sheet</Label>
          <Input
            type="file"
            multiple
            className="mt-1"
            onChange={(e) => setFiles([...(e.target.files ?? [])])}
            disabled={busy}
          />
          {files.length > 0 && (
            <ul className="mt-3 max-h-56 space-y-1 overflow-y-auto text-xs">
              {files.map((f) => (
                <li key={f.name} className="flex items-center justify-between gap-3">
                  <span className="truncate">{f.name}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {formatBytes(f.size)}
                    {progress[f.name] !== undefined
                      ? ` · ${Math.round((progress[f.name] ?? 0) * 100)}%`
                      : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-4 flex items-center gap-3">
          <Button onClick={handleUpload} disabled={busy}>
            {busy ? "Uploading…" : "Upload and submit"}
          </Button>
          {files.length > 0 && (
            <span className="text-xs text-muted-foreground">{formatBytes(totalBytes)} total</span>
          )}
        </div>
      </section>

      <section className="mt-8 rounded-2xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          <h2 className="text-sm font-semibold">
            {isAdmin ? "All uploads" : "Your uploads"} ({uploads.data?.length ?? 0})
          </h2>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statuses.map((s) => (
                <SelectItem key={s} value={s}>
                  {s === "all" ? "All statuses" : s.replace("_", " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <ul className="max-h-[32rem] divide-y divide-border overflow-y-auto">
          {(uploads.data ?? []).length === 0 && (
            <li className="p-6 text-sm text-muted-foreground">Nothing here yet.</li>
          )}
          {(uploads.data ?? []).map((u) => (
            <li key={u.id} className="flex items-center justify-between gap-4 p-4">
              <div className="min-w-0">
                <Link to="/uploads/$id" params={{ id: u.id }} className="truncate text-sm font-medium hover:underline">
                  {u.title}
                </Link>
                <p className="truncate text-xs text-muted-foreground">
                  {u.kind} · {u.artist_name || "—"}
                  {isAdmin && u.sublabels ? ` · ${(u.sublabels as { name: string }).name}` : ""} ·{" "}
                  {u.file_count ?? 0} files · {formatBytes(Number(u.total_bytes ?? 0))}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${statusTone[u.status] ?? "bg-muted"}`}
              >
                {String(u.status).replace("_", " ")}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
