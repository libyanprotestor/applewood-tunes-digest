import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  createUpload,
  finishFileUpload,
  listUploads,
  registerExtracted,
  setExtractError,
  startFileUpload,
  storageStatus,
} from "@/lib/uploads.functions";
import { getViewer } from "@/lib/analytics.functions";
import { listSublabels } from "@/lib/admin.functions";
import { formatBytes, pushFile } from "@/lib/upload-client";
import { parseReleaseZip, readZip, type Extracted } from "@/lib/zip-parse";
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
  const registerFn = useServerFn(registerExtracted);
  const extractErrorFn = useServerFn(setExtractError);

  const [kind, setKind] = useState<(typeof kinds)[number]["id"]>("album");
  const [sublabelId, setSublabelId] = useState<string>("");
  const [zip, setZip] = useState<File | null>(null);
  const [parsed, setParsed] = useState<Extracted | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);

  async function handlePick(file: File | null) {
    setZip(file);
    setParsed(null);
    setParseError(null);
    setProgress({});
    if (!file) return;
    if (!/\.zip$/i.test(file.name)) {
      setParseError("Please pick a .zip file.");
      return;
    }
    setBusy(true);
    try {
      const result = parseReleaseZip(file, await readZip(file), kind);
      setParsed(result);
      result.warnings.forEach((w) => toast.warning(w));
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "That zip could not be read.");
    } finally {
      setBusy(false);
    }
  }

  async function handleUpload() {
    if (!zip || !parsed) {
      toast.error("Pick a zip file first.");
      return;
    }
    if (isAdmin && !sublabelId) {
      toast.error("Choose which sublabel this release belongs to.");
      return;
    }

    setBusy(true);
    setProgress({});
    let uploadId: string | null = null;
    try {
      const { id } = await createFn({
        data: { kind, title: parsed.albumTitle, ...(isAdmin && sublabelId ? { sublabelId } : {}) },
      });
      uploadId = id;

      const fileIds = new Map<string, string>();
      for (const item of parsed.files) {
        const start = await startFn({
          data: {
            uploadId: id,
            filename: item.name,
            contentType: item.blob.type || "application/octet-stream",
            bytes: item.blob.size,
          },
        });
        const { parts } = await pushFile(item.blob, start, (fraction) =>
          setProgress((p) => ({ ...p, [item.name]: fraction })),
        );
        const saved = await finishFn({
          data: {
            uploadId: id,
            key: start.key,
            filename: start.filename,
            contentType: item.blob.type || "application/octet-stream",
            bytes: item.blob.size,
            role: item.role,
            multipartId: start.multipartId,
            parts,
          },
        });
        fileIds.set(item.path, saved.id);
        setProgress((p) => ({ ...p, [item.name]: 1 }));
      }

      const result = await registerFn({
        data: {
          uploadId: id,
          albumTitle: parsed.albumTitle,
          warnings: parsed.warnings,
          tracks: parsed.tracks.map((t) => ({
            folderNumber: t.folder,
            title: t.title,
            audioFileId: fileIds.get(t.audioPath)!,
            artworkFileId: t.artworkPath ? (fileIds.get(t.artworkPath) ?? null) : null,
          })),
        },
      });
      toast.success(result.message);

      setZip(null);
      setParsed(null);
      setProgress({});
      await qc.invalidateQueries({ queryKey: ["uploads"] });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upload failed.";
      toast.error(message);
      if (uploadId) await extractErrorFn({ data: { uploadId, message } }).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }


  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Release uploads</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Drop one zip per release. It is unpacked here, checked against the sheet inside it, and sent straight to
        secure storage for the label to review.
      </p>

      {storage.data && !storage.data.configured && (
        <p className="mt-6 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          Storage is not configured yet, so uploads will fail. Add the storage keys and reload.
        </p>
      )}

      <section className="mt-8 rounded-2xl border border-border bg-card p-6">
        <h2 className="text-sm font-semibold">New release</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <Label className="text-xs">Type</Label>
            <Select
              value={kind}
              onValueChange={(v) => {
                setKind(v as typeof kind);
                setParsed(null);
                setParseError(null);
                setZip(null);
              }}
            >
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
          <Label className="text-xs">Release zip</Label>
          <Input
            type="file"
            accept=".zip,application/zip"
            className="mt-1"
            onChange={(e) => void handlePick(e.target.files?.[0] ?? null)}
            disabled={busy}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            {kind === "album"
              ? "Album zip: a folder with the songs and the cover, plus a sheet whose first row is the album title and the rows below are the song titles."
              : "Ringtone zip: a folder holding the sheet and folders numbered 1…n, each with one ringtone and one picture."}
          </p>
        </div>

        {parseError && (
          <p className="mt-4 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
            {parseError}
          </p>
        )}

        {parsed && (
          <div className="mt-4 rounded-xl border border-border bg-secondary/40 p-4">
            <p className="text-sm font-medium">{parsed.albumTitle}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {parsed.tracks.length} {kind === "album" ? "songs" : "ringtones"} ·{" "}
              {parsed.files.filter((f) => f.role === "artwork").length} images ·{" "}
              {formatBytes(parsed.files.reduce((a, f) => a + f.blob.size, 0))}
            </p>
            {parsed.warnings.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-xs text-muted-foreground">
                {parsed.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
            <ul className="mt-3 max-h-56 space-y-1 overflow-y-auto text-xs">
              {parsed.files.map((f) => (
                <li key={f.name} className="flex items-center justify-between gap-3">
                  <span className="truncate">
                    {f.folder ? `${f.folder} · ` : ""}
                    {f.name}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {formatBytes(f.blob.size)}
                    {progress[f.name] !== undefined ? ` · ${Math.round((progress[f.name] ?? 0) * 100)}%` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-4 flex items-center gap-3">
          <Button onClick={handleUpload} disabled={busy || !parsed}>
            {busy ? "Working…" : "Upload and submit"}
          </Button>
          {zip && <span className="text-xs text-muted-foreground">{zip.name}</span>}
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
