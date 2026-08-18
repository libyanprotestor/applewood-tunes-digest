import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getUpload, deleteUpload, deleteUploadFile } from "@/lib/uploads.functions";
import {
  adminEditUpload,
  applyArtistToAll,
  assignCodesToUpload,
  deliveryLogs,
  queueDelivery,
  releaseIsrcsForUpload,
  retryDelivery,
  saveSheet,
  setUploadStatus,
} from "@/lib/delivery.functions";

import { getViewer } from "@/lib/analytics.functions";
import { formatBytes } from "@/lib/upload-client";
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

export const Route = createFileRoute("/_authenticated/uploads/$id")({
  head: () => ({
    meta: [
      { title: "Review release | Apple Music Delivery Console" },
      {
        name: "description",
        content: "Preview uploaded audio and artwork, complete the metadata sheet and deliver the package to Apple.",
      },
      { property: "og:title", content: "Review release | Apple Music Delivery Console" },
      {
        property: "og:description",
        content: "Preview uploaded audio and artwork, complete the metadata sheet and deliver the package to Apple.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: UploadDetail,
});

type TrackRow = {
  id: string;
  folderNumber: number | null;
  trackNumber: number;
  title: string;
  version: string;
  artistName: string;
  isrc: string;
  explicit: boolean;
};

function toCsv(rows: string[][]) {
  return rows
    .map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(","))
    .join("\n");
}


function UploadDetail() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const viewer = useQuery({ queryKey: ["viewer"], queryFn: useServerFn(getViewer) });
  const isAdmin = viewer.data?.isAdmin ?? false;

  const getFn = useServerFn(getUpload);
  const detail = useQuery({ queryKey: ["upload", id], queryFn: () => getFn({ data: { id } }) });

  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<"album" | "singles" | "ringtones">("album");
  const [artist, setArtist] = useState("");
  const [upc, setUpc] = useState("");
  const [releaseDate, setReleaseDate] = useState("");
  const [notes, setNotes] = useState("");
  const [genre, setGenre] = useState("");
  const [language, setLanguage] = useState("");
  const [labelName, setLabelName] = useState("");
  const [copyrightLine, setCopyrightLine] = useState("");
  const [tracks, setTracks] = useState<TrackRow[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!detail.data) return;
    setTitle(detail.data.upload.title ?? "");
    setKind((detail.data.upload.kind as "album" | "singles" | "ringtones") ?? "album");
    setArtist(detail.data.upload.artist_name ?? "");
    setUpc(detail.data.upload.upc ?? "");
    setReleaseDate(detail.data.upload.release_date ?? "");
    setNotes(detail.data.upload.admin_notes ?? "");
    setGenre(detail.data.upload.genre_code ?? "");
    setLanguage(detail.data.upload.language ?? "");
    setLabelName(detail.data.upload.label_name ?? "");
    setCopyrightLine(detail.data.upload.copyright_line ?? "");
    setTracks(
      detail.data.tracks.map((t) => ({
        id: t.id,
        folderNumber: t.folder_number ?? null,
        trackNumber: t.track_number ?? 1,
        title: t.title ?? "",
        version: t.version ?? "",
        artistName: t.artist_name ?? "",
        isrc: t.isrc ?? "",
        explicit: Boolean(t.explicit),
      })),
    );
  }, [detail.data]);

  const saveFn = useServerFn(saveSheet);
  const artistFn = useServerFn(applyArtistToAll);
  const assignFn = useServerFn(assignCodesToUpload);

  const releaseFn = useServerFn(releaseIsrcsForUpload);
  const queueFn = useServerFn(queueDelivery);
  const statusFn = useServerFn(setUploadStatus);
  const retryFn = useServerFn(retryDelivery);
  const deleteFn = useServerFn(deleteUpload);
  const editFn = useServerFn(adminEditUpload);
  const deleteFileFn = useServerFn(deleteUploadFile);
  const logsFn = useServerFn(deliveryLogs);

  const activeJob = detail.data?.jobs[0];
  const logs = useQuery({
    queryKey: ["delivery-logs", activeJob?.id],
    queryFn: () => logsFn({ data: { jobId: activeJob!.id, afterId: 0 } }),
    enabled: Boolean(activeJob),
    refetchInterval: activeJob && ["queued", "claimed", "packaging", "uploading"].includes(activeJob.state)
      ? 4000
      : false,
  });

  async function run(label: string, fn: () => Promise<{ ok?: boolean; message?: string }>) {
    setBusy(true);
    try {
      const result = await fn();
      if (result.ok === false) toast.error(result.message ?? "That didn't work.");
      else toast.success(result.message || label);
      await qc.invalidateQueries({ queryKey: ["upload", id] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (detail.isLoading) return <main className="mx-auto max-w-6xl px-6 py-10 text-sm">Loading…</main>;
  if (!detail.data) return <main className="mx-auto max-w-6xl px-6 py-10 text-sm">Upload not found.</main>;

  const { upload, files, jobs } = detail.data;
  const artwork = files.filter((f) => f.role === "artwork");
  const audio = files.filter((f) => f.role === "audio");
  const docs = files.filter((f) => f.role !== "audio" && f.role !== "artwork");

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <Link to="/uploads" className="text-xs text-muted-foreground hover:underline">
        ← Back to uploads
      </Link>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{upload.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {upload.kind} · {(upload.sublabels as { name: string } | null)?.name ?? "—"} · {files.length} files ·{" "}
            {formatBytes(Number(upload.total_bytes ?? 0))} · {String(upload.status).replace("_", " ")}
          </p>
        </div>
        {isAdmin && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => run("Marked in review", () => statusFn({ data: { uploadId: id, status: "in_review" } }))}
            >
              In review
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => {
                const reason = window.prompt("Why is this rejected?") ?? "";
                if (!reason) return;
                void run("Rejected", () => statusFn({ data: { uploadId: id, status: "rejected", reason } }));
              }}
            >
              Reject
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() =>
                run("Cancelled", () => statusFn({ data: { uploadId: id, status: "cancelled" } }))
              }
            >
              Cancel
            </Button>
            <Button
              variant={upload.status === "ready" ? "outline" : "default"}
              size="sm"
              disabled={busy}
              onClick={() => run("Approved for delivery", () => statusFn({ data: { uploadId: id, status: "ready" } }))}
            >
              Approve
            </Button>
            <Button
              size="sm"
              disabled={busy || upload.status !== "ready"}
              title={upload.status !== "ready" ? "Approve the release first" : undefined}
              onClick={() => run("Queued", () => queueFn({ data: { uploadId: id } }))}
            >
              Package &amp; deliver
            </Button>
          </div>
        )}
      </div>

      {isAdmin && upload.status !== "ready" && (
        <p className="mt-4 rounded-xl border border-border bg-secondary/40 p-4 text-sm text-muted-foreground">
          This release is not approved yet. Review the files and the sheet, then press Approve to unlock delivery.
        </p>
      )}

      {upload.rejection_reason && (
        <p className="mt-4 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          Rejected: {upload.rejection_reason}
        </p>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <section className="rounded-2xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold">Artwork</h2>
          {artwork.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">No artwork uploaded.</p>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-3">
              {artwork.map((f) => (
                <div key={f.id}>
                  <a href={f.url} target="_blank" rel="noreferrer">
                    <img
                      src={f.url}
                      alt={f.filename}
                      loading="lazy"
                      className="aspect-square w-full rounded-lg border border-border object-cover"
                    />
                    <span className="mt-1 block truncate text-xs text-muted-foreground">{f.filename}</span>
                  </a>
                  {isAdmin && (
                    <button
                      type="button"
                      disabled={busy}
                      className="mt-1 text-xs text-destructive hover:underline"
                      onClick={() => {
                        if (!window.confirm(`Delete ${f.filename}?`)) return;
                        void run("File deleted", () => deleteFileFn({ data: { uploadId: id, fileId: f.id } }));
                      }}
                    >
                      Delete
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {docs.length > 0 && (
            <>
              <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Other files
              </h3>
              <ul className="mt-2 space-y-1 text-xs">
                {docs.map((f) => (
                  <li key={f.id}>
                    <a href={f.url} target="_blank" rel="noreferrer" className="hover:underline">
                      {f.filename}
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="rounded-2xl border border-border bg-card p-5 lg:col-span-2">
          <h2 className="text-sm font-semibold">Audio ({audio.length})</h2>
          <ul className="mt-3 max-h-72 space-y-3 overflow-y-auto pr-1">
            {audio.map((f) => (
              <li key={f.id}>
                <div className="flex items-center justify-between gap-3">
                  <p className="truncate text-xs">
                    {f.filename} · {formatBytes(Number(f.bytes ?? 0))}
                  </p>
                  {isAdmin && (
                    <button
                      type="button"
                      disabled={busy}
                      className="shrink-0 text-xs text-destructive hover:underline"
                      onClick={() => {
                        if (!window.confirm(`Delete ${f.filename}?`)) return;
                        void run("File deleted", () => deleteFileFn({ data: { uploadId: id, fileId: f.id } }));
                      }}
                    >
                      Delete
                    </button>
                  )}
                </div>
                <audio controls preload="none" src={f.url} className="mt-1 w-full" />
              </li>
            ))}
          </ul>
        </section>
      </div>

      {isAdmin && (
        <section className="mt-8 rounded-2xl border border-border bg-card p-6">
          <h2 className="text-sm font-semibold">Release details</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <div>
              <Label className="text-xs">Title</Label>
              <Input className="mt-1" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Type</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="album">Album</SelectItem>
                  <SelectItem value="singles">Singles</SelectItem>
                  <SelectItem value="ringtones">Ringtones</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button
                disabled={busy || !title.trim()}
                onClick={() =>
                  run("Release details saved", () =>
                    editFn({
                      data: {
                        uploadId: id,
                        title: title.trim(),
                        kind,
                        artistName: artist || undefined,
                        upc: upc || undefined,
                        releaseDate: releaseDate || undefined,
                      },
                    }),
                  )
                }
              >
                Save details
              </Button>
            </div>
          </div>
        </section>
      )}


      {isAdmin && (
        <section className="mt-8 rounded-2xl border border-border bg-card p-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-sm font-semibold">Metadata sheet</h2>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={busy || !artist.trim()}
                onClick={() =>
                  run("Artist applied to every row", () =>
                    artistFn({ data: { uploadId: id, artistName: artist.trim() } }),
                  )
                }
              >
                Apply artist to all
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => run("ISRCs assigned", () => assignFn({ data: { uploadId: id } }))}
              >
                Assign ISRCs
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => run("ISRCs returned to the pool", () => releaseFn({ data: { uploadId: id } }))}
              >
                Release ISRCs
              </Button>
            </div>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-4">
            <div>
              <Label className="text-xs">Artist name</Label>
              <Input className="mt-1" value={artist} onChange={(e) => setArtist(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">UPC</Label>
              <Input className="mt-1" value={upc} onChange={(e) => setUpc(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Release date</Label>
              <Input
                type="date"
                className="mt-1"
                value={releaseDate}
                onChange={(e) => setReleaseDate(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Notes</Label>
              <Input className="mt-1" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>

          <div className="mt-5 max-h-96 overflow-y-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-secondary text-xs text-secondary-foreground">
                <tr>
                  <th className="p-2 text-left font-medium">#</th>
                  <th className="p-2 text-left font-medium">Title</th>
                  <th className="p-2 text-left font-medium">Version</th>
                  <th className="p-2 text-left font-medium">Artist</th>
                  <th className="p-2 text-left font-medium">ISRC</th>
                  <th className="p-2 text-left font-medium">Explicit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {tracks.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-4 text-sm text-muted-foreground">
                      No tracks yet.
                    </td>
                  </tr>
                )}
                {tracks.map((t, i) => (
                  <tr key={t.id}>
                    <td className="w-14 p-1">
                      <Input
                        className="h-8"
                        type="number"
                        value={t.trackNumber}
                        onChange={(e) =>
                          setTracks((rows) =>
                            rows.map((r, ri) =>
                              ri === i ? { ...r, trackNumber: Number(e.target.value) || 1 } : r,
                            ),
                          )
                        }
                      />
                    </td>
                    <td className="p-1">
                      <Input
                        className="h-8"
                        value={t.title}
                        onChange={(e) =>
                          setTracks((rows) => rows.map((r, ri) => (ri === i ? { ...r, title: e.target.value } : r)))
                        }
                      />
                    </td>
                    <td className="p-1">
                      <Input
                        className="h-8"
                        value={t.version}
                        onChange={(e) =>
                          setTracks((rows) => rows.map((r, ri) => (ri === i ? { ...r, version: e.target.value } : r)))
                        }
                      />
                    </td>
                    <td className="p-1">
                      <Input
                        className="h-8"
                        value={t.artistName}
                        onChange={(e) =>
                          setTracks((rows) =>
                            rows.map((r, ri) => (ri === i ? { ...r, artistName: e.target.value } : r)),
                          )
                        }
                      />
                    </td>
                    <td className="p-1">
                      <Input
                        className="h-8 font-mono"
                        value={t.isrc}
                        onChange={(e) =>
                          setTracks((rows) => rows.map((r, ri) => (ri === i ? { ...r, isrc: e.target.value } : r)))
                        }
                      />
                    </td>
                    <td className="p-1 text-center">
                      <input
                        type="checkbox"
                        checked={t.explicit}
                        onChange={(e) =>
                          setTracks((rows) =>
                            rows.map((r, ri) => (ri === i ? { ...r, explicit: e.target.checked } : r)),
                          )
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              disabled={busy}
              onClick={() =>
                run("Sheet saved", () =>
                  saveFn({
                    data: {
                      uploadId: id,
                      artistName: artist,
                      upc,
                      releaseDate: releaseDate || undefined,
                      adminNotes: notes,
                      tracks: tracks.map((t) => ({
                        id: t.id,
                        trackNumber: t.trackNumber,
                        title: t.title,
                        version: t.version || undefined,
                        artistName: t.artistName || undefined,
                        isrc: t.isrc || undefined,
                        explicit: t.explicit,
                      })),
                    },
                  }),
                )
              }
            >
              Save sheet
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                if (!window.confirm("Delete this upload and its files permanently?")) return;
                void run("Upload deleted", () => deleteFn({ data: { id } }));
              }}
            >
              Delete upload
            </Button>
          </div>
        </section>
      )}

      <section className="mt-8 rounded-2xl border border-border bg-card p-6">
        <h2 className="text-sm font-semibold">Delivery</h2>
        {jobs.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No delivery has been started yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {jobs.map((j) => (
              <li key={j.id} className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <span>
                  {j.state} · attempt {j.attempts ?? 0}
                  {j.apple_ticket ? ` · ticket ${j.apple_ticket}` : ""}
                  {j.error_message ? ` · ${j.error_message}` : ""}
                </span>
                {isAdmin && j.state === "failed" && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => run("Requeued", () => retryFn({ data: { jobId: j.id } }))}
                  >
                    Retry
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {(logs.data ?? []).length > 0 && (
          <pre className="mt-4 max-h-72 overflow-auto rounded-xl bg-secondary p-4 text-xs leading-relaxed">
            {(logs.data ?? []).map((l) => `${l.created_at.slice(11, 19)}  ${l.line}`).join("\n")}
          </pre>
        )}
      </section>
    </main>
  );
}
