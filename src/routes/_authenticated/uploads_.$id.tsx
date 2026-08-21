import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getUpload, deleteUpload, deleteUploadFile, uploadMediaUrls } from "@/lib/uploads.functions";
import {
  adminEditUpload,
  applyArtistToAll,
  assignCodesToUpload,
  deliveryLogs,
  queueDelivery,
  cancelDelivery,
  approvePackages,
  rejectPackages,
  finalizeDelivered,
  releaseIsrcsForUpload,
  retryDelivery,
  previewMetadata,
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

export const Route = createFileRoute("/_authenticated/uploads_/$id")({
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
  const detail = useQuery({
    queryKey: ["upload", id],
    queryFn: () => getFn({ data: { id } }),
    refetchInterval: (q) => {
      const state = q.state.data?.jobs?.[0]?.state;
      return state && ["queued", "claimed", "packaging", "uploading"].includes(String(state)) ? 5000 : false;
    },
  });

  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<"album" | "singles" | "ringtones">("album");
  const [artist, setArtist] = useState("");
  const [upc, setUpc] = useState("");
  const [releaseDate, setReleaseDate] = useState("");
  const [notes, setNotes] = useState("");
  const [genre, setGenre] = useState("");
  const [language, setLanguage] = useState("");
  const [labelName, setLabelName] = useState("");
  const [pline, setPline] = useState("");
  const [cline, setCline] = useState("");
  const [tracks, setTracks] = useState<TrackRow[]>([]);
  const [busy, setBusy] = useState(false);
  // Media is fetched from storage only when the admin asks for it.
  const [mediaUrls, setMediaUrls] = useState<Record<string, string> | null>(null);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(true);
  const [packagesOpen, setPackagesOpen] = useState(true);


  useEffect(() => {
    if (!detail.data) return;
    setTitle(detail.data.upload.title ?? "");
    setKind((detail.data.upload.kind as "album" | "singles" | "ringtones") ?? "album");
    setArtist(detail.data.upload.artist_name ?? "");
    setUpc(detail.data.upload.upc ?? "");
    setReleaseDate(detail.data.upload.release_date ?? "");
    setNotes(detail.data.upload.admin_notes ?? "");
    setGenre(
      detail.data.upload.genre_code ?? (detail.data.upload.kind === "ringtones" ? "RINGTONES-00" : "POP-00"),
    );
    setLanguage(detail.data.upload.language || "en");
    setLabelName(detail.data.upload.label_name ?? "");
    setPline(detail.data.upload.copyright_pline ?? "");
    setCline(detail.data.upload.copyright_cline ?? "");
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
  const cancelFn = useServerFn(cancelDelivery);
  const approveFn = useServerFn(approvePackages);
  const rejectFn = useServerFn(rejectPackages);

  const deleteFn = useServerFn(deleteUpload);
  const editFn = useServerFn(adminEditUpload);
  const deleteFileFn = useServerFn(deleteUploadFile);
  const logsFn = useServerFn(deliveryLogs);
  const previewFn = useServerFn(previewMetadata);
  const mediaFn = useServerFn(uploadMediaUrls);
  const finalizeFn = useServerFn(finalizeDelivered);

  const [preview, setPreview] = useState<
    | null
    | { total: number; packages: { vendorId: string; title: string; xml: string }[]; warnings: string[] }
  >(null);

  const activeJob = detail.data?.jobs[0];
  const logs = useQuery({
    queryKey: ["delivery-logs", activeJob?.id],
    queryFn: () => logsFn({ data: { jobId: activeJob!.id, afterId: 0 } }),
    enabled: Boolean(activeJob),
    refetchInterval: activeJob && ["queued", "claimed", "packaging", "uploading"].includes(activeJob.state)
      ? 4000
      : false,
  });

  const status = String(detail.data?.upload.status ?? "");
  const isLocked = !["draft", "uploaded", "in_review", "rejected"].includes(status);
  const delivered = status === "delivered";

  // Approving a release collapses the editing sections and stops media traffic.
  useEffect(() => {
    if (!isLocked) return;
    setDetailsOpen(false);
    setSheetOpen(false);
  }, [isLocked]);

  // A delivered release adds itself to the catalog and frees its storage once.
  const needsFinalize = delivered && !detail.data?.upload.catalog_synced_at;
  useEffect(() => {
    if (!needsFinalize || !isAdmin) return;
    void finalizeFn({ data: { uploadId: id } })
      .then(() => qc.invalidateQueries({ queryKey: ["upload", id] }))
      .catch(() => {
        /* the worker may have done it already */
      });
  }, [needsFinalize, isAdmin, id, finalizeFn, qc]);

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

  function hideMedia() {
    setMediaUrls(null);
  }

  async function loadMedia() {
    setMediaLoading(true);
    try {
      const result = await mediaFn({ data: { uploadId: id } });
      setMediaUrls(result.urls);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load the media links.");
    } finally {
      setMediaLoading(false);
    }
  }

  if (detail.isLoading) return <main className="mx-auto max-w-6xl px-6 py-10 text-sm">Loading…</main>;
  if (!detail.data) return <main className="mx-auto max-w-6xl px-6 py-10 text-sm">Upload not found.</main>;

  const { upload, files, jobs, packages } = detail.data;
  const locked = isLocked;
  const canDeleteFiles = !locked;
  const canDeleteUpload = ["draft", "rejected", "delivered"].includes(status);
  const builtPackages = packages.filter((p) => p.job_id === activeJob?.id);
  const artwork = files.filter((f) => f.role === "artwork");
  const audio = files.filter((f) => f.role === "audio");
  const docs = files.filter((f) => f.role !== "audio" && f.role !== "artwork");
  const mediaShown = mediaUrls !== null;
  const packagesReady = activeJob?.state === "awaiting_approval";


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
              disabled={busy || mediaLoading}
              onClick={() => (mediaShown ? hideMedia() : void loadMedia())}
            >
              {mediaLoading ? "Loading…" : mediaShown ? "Hide preview" : "Preview"}
            </Button>
            {!delivered && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    run("Marked in review", () => statusFn({ data: { uploadId: id, status: "in_review" } }))
                  }
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
                    hideMedia();
                    void run("Rejected", () => statusFn({ data: { uploadId: id, status: "rejected", reason } }));
                  }}
                >
                  Reject
                </Button>
                <Button
                  variant={upload.status === "ready" ? "outline" : "default"}
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    hideMedia();
                    void run("Approved for delivery", () =>
                      statusFn({ data: { uploadId: id, status: "ready" } }),
                    );
                  }}
                >
                  Approve
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || upload.status !== "ready"}
                  title={upload.status !== "ready" ? "Approve the release first" : undefined}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const result = await previewFn({ data: { uploadId: id } });
                      setPreview(result);
                      setTimeout(
                        () => document.getElementById("metadata-preview")?.scrollIntoView({ behavior: "smooth" }),
                        50,
                      );
                    } catch (error) {
                      toast.error(error instanceof Error ? error.message : "Could not build the metadata preview.");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Package
                </Button>
                <Button
                  size="sm"
                  disabled={busy || !packagesReady}
                  title={packagesReady ? undefined : "Package the release first, then review the packages"}
                  onClick={() => {
                    setPackagesOpen(false);
                    void run("Sent to Apple", () => approveFn({ data: { jobId: activeJob!.id } }));
                  }}
                >
                  Deliver
                </Button>
              </>
            )}
          </div>
        )}

      </div>

      {isAdmin && upload.status !== "ready" && (
        <p className="mt-4 rounded-xl border border-border bg-secondary/40 p-4 text-sm text-muted-foreground">
          This release is not approved yet. Review the files and the sheet, then press Approve to unlock delivery.
        </p>
      )}

      {isAdmin && locked && (
        <p className="mt-4 rounded-xl border border-border bg-secondary/40 p-4 text-sm text-muted-foreground">
          This release is approved and locked. Press <strong>In review</strong> to edit the details or the sheet again.
        </p>
      )}

      {upload.extract_error && (
        <p className="mt-4 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          Zip problem: {upload.extract_error}
        </p>
      )}

      {upload.rejection_reason && (
        <p className="mt-4 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          Rejected: {upload.rejection_reason}
        </p>
      )}

      <section className="mt-8 rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">
            Audio ({audio.length}) · Artwork ({artwork.length})
          </h2>
          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy || mediaLoading}
              onClick={() => (mediaShown ? hideMedia() : void loadMedia())}
            >
              {mediaLoading ? "Loading…" : mediaShown ? "Hide preview" : "Preview"}
            </Button>
          )}
        </div>

        {!mediaShown ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Media is not loaded. Press <strong>Preview</strong> to stream the audio and show the artwork.
          </p>
        ) : (
          <>
            <ul className="mt-4 max-h-72 space-y-3 overflow-y-auto pr-1">
              {audio.map((f) => (
                <li key={f.id}>
                  <div className="flex items-center justify-between gap-3">
                    <p className="truncate text-xs">
                      {f.filename} · {formatBytes(Number(f.bytes ?? 0))}
                    </p>
                    {isAdmin && canDeleteFiles && (
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
                  <audio controls preload="none" src={mediaUrls?.[f.id]} className="mt-1 w-full" />
                </li>
              ))}
              {audio.length === 0 && <li className="text-sm text-muted-foreground">No audio files.</li>}
            </ul>

            <h3 className="mt-6 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Artwork</h3>
            {artwork.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No artwork uploaded.</p>
            ) : (
              // Two rows of four tiles are visible; the rest scrolls.
              <div className="mt-2 max-h-[26rem] overflow-y-auto rounded-xl border border-border p-3">
                <div className="grid grid-cols-4 gap-3">
                  {artwork.map((f) => (
                    <div key={f.id}>
                      <a href={mediaUrls?.[f.id]} target="_blank" rel="noreferrer">
                        <img
                          src={mediaUrls?.[f.id]}
                          alt={f.filename}
                          loading="lazy"
                          className="aspect-square w-full rounded-lg border border-border object-cover"
                        />
                        <span className="mt-1 block truncate text-xs text-muted-foreground">{f.filename}</span>
                      </a>
                      {isAdmin && canDeleteFiles && (
                        <button
                          type="button"
                          disabled={busy}
                          className="text-xs text-destructive hover:underline"
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
              </div>
            )}

            {docs.length > 0 && (
              <>
                <h3 className="mt-6 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Other files
                </h3>
                <ul className="mt-2 space-y-1 text-xs">
                  {docs.map((f) => (
                    <li key={f.id}>
                      <a href={mediaUrls?.[f.id]} target="_blank" rel="noreferrer" className="hover:underline">
                        {f.filename}
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </section>


      {isAdmin && (
        <section className="mt-8 rounded-2xl border border-border bg-card p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">Release details</h2>
            <Button variant="ghost" size="sm" onClick={() => setDetailsOpen((v) => !v)}>
              {detailsOpen ? "Hide" : "Show"}
            </Button>
          </div>
          <fieldset disabled={locked} className={detailsOpen ? "disabled:opacity-70" : "hidden"}>
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
            <div>
              <Label className="text-xs">Genre code</Label>
              <Input className="mt-1" value={genre} onChange={(e) => setGenre(e.target.value)} placeholder="RINGTONES-00" />
            </div>
            <div>
              <Label className="text-xs">Language</Label>
              <Input className="mt-1" value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="en" />
            </div>
            <div>
              <Label className="text-xs">Label name</Label>
              <Input className="mt-1" value={labelName} onChange={(e) => setLabelName(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">℗ line</Label>
              <Input className="mt-1" value={pline} onChange={(e) => setPline(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">© line</Label>
              <Input className="mt-1" value={cline} onChange={(e) => setCline(e.target.value)} />
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
                        genreCode: genre || undefined,
                        language: language || undefined,
                        labelName: labelName || undefined,
                        copyrightPline: pline || undefined,
                        copyrightCline: cline || undefined,
                      },
                    }),
                  )
                }
              >
                Save details
              </Button>
            </div>
          </div>
          </fieldset>
        </section>
      )}


      {isAdmin && (
        <section className="mt-8 rounded-2xl border border-border bg-card p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">Metadata sheet</h2>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const csv = toCsv([
                    ["Folder", "Track", "Title", "Version", "Artist", "ISRC", "Explicit"],
                    ...tracks.map((t) => [
                      t.folderNumber ? String(t.folderNumber) : "",
                      String(t.trackNumber),
                      t.title,
                      t.version,
                      t.artistName || artist,
                      t.isrc,
                      t.explicit ? "yes" : "no",
                    ]),
                  ]);
                  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `${title || "release"}-sheet.csv`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                Download sheet
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSheetOpen((v) => !v)}>
                {sheetOpen ? "Hide" : "Show"}
              </Button>
            </div>
          </div>
          <fieldset disabled={locked} className={sheetOpen ? "disabled:opacity-70" : "hidden"}>
          <div className="mt-4 flex flex-wrap items-end justify-between gap-3">

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
                onClick={() => run("Codes assigned", () => assignFn({ data: { uploadId: id } }))}
              >
                Fill ISRCs
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
              <Label className="text-xs">Album ISRC (vendor id)</Label>
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
          </div>
          </fieldset>
          {canDeleteUpload && (
            <div className="mt-4">
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
          )}
        </section>
      )}


      {preview && (
        <section id="metadata-preview" className="mt-8 rounded-2xl border border-border bg-card p-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Metadata review</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {preview.total} package{preview.total === 1 ? "" : "s"} will be delivered
                {preview.total > preview.packages.length ? ` — showing the first ${preview.packages.length}` : ""}.
                Checksums are computed at packaging time.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setPreview(null)}>
                Close
              </Button>
              <Button
                size="sm"
                disabled={busy || preview.warnings.length > 0}
                title={preview.warnings.length > 0 ? "Fix the warnings first" : undefined}
                onClick={() =>
                  run("Queued for packaging and delivery", async () => {
                    const result = await queueFn({ data: { uploadId: id } });
                    if (result.ok !== false) setPreview(null);
                    return result;
                  })
                }
              >
                Deliver to Apple
              </Button>
            </div>
          </div>

          {preview.warnings.length > 0 && (
            <ul className="mt-4 list-disc space-y-1 rounded-xl border border-destructive/40 bg-destructive/5 p-4 pl-8 text-sm text-destructive">
              {preview.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}

          <div className="mt-4 space-y-4">
            {preview.packages.map((pkg) => (
              <div key={pkg.vendorId}>
                <p className="text-xs font-medium">
                  {pkg.vendorId}.itmsp / metadata.xml · {pkg.title}
                </p>
                <pre className="mt-1 max-h-96 overflow-auto rounded-xl bg-secondary p-4 text-xs leading-relaxed">
                  {pkg.xml}
                </pre>
              </div>
            ))}
          </div>
        </section>
      )}

      {isAdmin && activeJob?.state === "awaiting_approval" && (
        <section className="mt-8 rounded-2xl border border-primary/40 bg-card p-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Built packages — review before delivery</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                The worker built {builtPackages.length} package{builtPackages.length === 1 ? "" : "s"} and is waiting.
                Nothing has been sent to Apple yet.
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => {
                  const reason = window.prompt("Reject these packages? Optional reason:") ?? undefined;
                  void run("Rejected", () => rejectFn({ data: { jobId: activeJob.id, reason } }));
                }}
              >
                Reject packages
              </Button>
              <Button
                size="sm"
                disabled={busy}
                onClick={() => run("Approved", () => approveFn({ data: { jobId: activeJob.id } }))}
              >
                Approve & send to Apple
              </Button>
            </div>
          </div>

          <div className="mt-4 space-y-4">
            {builtPackages.map((p) => {
              const manifest = (p.manifest ?? null) as { files?: string[]; folder?: string } | null;
              return (
                <div key={p.id}>
                  <p className="text-xs font-medium">
                    {manifest?.folder ?? `${p.vendor_id}.itmsp`} · {p.title}
                  </p>
                  {manifest?.files?.length ? (
                    <ul className="mt-1 list-disc pl-6 text-xs text-muted-foreground">
                      {manifest.files.map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                      <li>metadata.xml</li>
                    </ul>
                  ) : null}
                  {p.metadata_xml && (
                    <pre className="mt-2 max-h-96 overflow-auto rounded-xl bg-secondary p-4 text-xs leading-relaxed">
                      {p.metadata_xml}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {packages.length > 0 && (
        <section className="mt-8 rounded-2xl border border-border bg-card p-6">
          <h2 className="text-sm font-semibold">Packages sent to Apple</h2>
          <ul className="mt-3 max-h-80 space-y-2 overflow-y-auto text-sm">
            {packages.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3">
                <span className="truncate">
                  {p.vendor_id}.itmsp · {p.title}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {p.state}
                  {p.apple_ticket ? ` · ticket ${p.apple_ticket}` : ""}
                  {p.error_message ? ` · ${p.error_message}` : ""}
                </span>
              </li>
            ))}
          </ul>
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
                  {j.worker_id ? ` · worker ${j.worker_id}` : ""}
                  {j.apple_ticket ? ` · ticket ${j.apple_ticket}` : ""}
                  {j.error_message ? ` · ${j.error_message}` : ""}
                </span>
                <span className="flex gap-2">
                  {isAdmin && j.state === "queued" && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => run("Cancelled", () => cancelFn({ data: { jobId: j.id } }))}
                    >
                      Cancel
                    </Button>
                  )}
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
                </span>
              </li>
            ))}
          </ul>
        )}
        {jobs.some((j) => j.state === "queued") && (

          <p className="mt-3 rounded-xl border border-border bg-secondary/60 p-3 text-xs text-muted-foreground">
            Queued and waiting for the delivery worker to pick it up. Packaging and the Apple upload happen on your
            Transporter machine — if no worker is running, the job stays queued. See worker/README.md for the setup
            steps, or cancel the job to unlock this release.
          </p>
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
