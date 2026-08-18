import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/* --------------------------------- uploads -------------------------------- */

export const createUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        kind: z.enum(["album", "singles", "ringtones"]),
        title: z.string().trim().max(300).optional(),
        artistName: z.string().trim().max(300).optional(),
        upc: z.string().trim().max(40).optional(),
        releaseDate: z.string().trim().max(10).optional(),
        sublabelId: z.string().uuid().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { getViewerScope } = await import("./guards.server");
    const scope = await getViewerScope(context.supabase, context.userId);
    const sublabelId = scope.isAdmin ? (data.sublabelId ?? scope.sublabelId) : scope.sublabelId;
    if (!sublabelId) throw new Error("No sublabel is linked to this account.");

    const id = crypto.randomUUID();
    const { error } = await context.supabase.from("uploads").insert({
      id,
      sublabel_id: sublabelId,
      created_by: context.userId,
      kind: data.kind,
      title: data.title || "Untitled release",
      artist_name: data.artistName || null,
      upc: data.upc || null,
      release_date: data.releaseDate || null,
      storage_prefix: `sublabel/${sublabelId}/upload/${id}`,
      status: "draft",
    });
    if (error) throw new Error(error.message);
    return { id };
  });

/**
 * Records the structure the browser found inside the release zip: the album
 * title from the sheet, one track row per song / ringtone folder, and the
 * label defaults that pre-fill the Apple metadata.
 */
export const registerExtracted = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        uploadId: z.string().uuid(),
        albumTitle: z.string().trim().min(1).max(300),
        tracks: z
          .array(
            z.object({
              folderNumber: z.number().int().min(1).nullable(),
              title: z.string().trim().min(1).max(300),
              audioFileId: z.string().uuid(),
              artworkFileId: z.string().uuid().nullable(),
            }),
          )
          .min(1)
          .max(500),
        warnings: z.array(z.string().max(400)).max(50).default([]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: upload, error: loadError } = await context.supabase
      .from("uploads")
      .select("id, sublabel_id, sublabels(default_genre_code, default_language, default_label_name, default_copyright_owner, name)")
      .eq("id", data.uploadId)
      .maybeSingle();
    if (loadError) throw new Error(loadError.message);
    if (!upload) throw new Error("Upload not found");

    const defaults = (upload.sublabels ?? {}) as {
      default_genre_code?: string | null;
      default_language?: string | null;
      default_label_name?: string | null;
      default_copyright_owner?: string | null;
      name?: string;
    };
    const year = new Date().getFullYear();
    const owner = defaults.default_copyright_owner || defaults.default_label_name || defaults.name || "";

    await context.supabase.from("upload_tracks").delete().eq("upload_id", data.uploadId);
    const rows = data.tracks.map((t, i) => ({
      upload_id: data.uploadId,
      file_id: t.audioFileId,
      artwork_file_id: t.artworkFileId,
      folder_number: t.folderNumber,
      track_number: i + 1,
      title: t.title,
    }));
    const seeded = await context.supabase.from("upload_tracks").insert(rows);
    if (seeded.error) throw new Error(seeded.error.message);

    const { error } = await context.supabase
      .from("uploads")
      .update({
        title: data.albumTitle,
        status: "uploaded",
        extract_error: data.warnings.length ? data.warnings.join(" ") : null,
        genre_code: defaults.default_genre_code || null,
        language: defaults.default_language || "en",
        label_name: defaults.default_label_name || defaults.name || null,
        copyright_pline: owner ? `${year} ${owner}` : null,
        copyright_cline: owner ? `${year} ${owner}` : null,
      })
      .eq("id", data.uploadId);
    if (error) throw new Error(error.message);
    return { ok: true as const, message: "Upload sent for review." };
  });

/** Stores a plain-language reason why a zip could not be unpacked. */
export const setExtractError = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ uploadId: z.string().uuid(), message: z.string().trim().max(600) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await context.supabase
      .from("uploads")
      .update({ extract_error: data.message, status: "draft" })
      .eq("id", data.uploadId);
    return { ok: true as const };
  });


/** Mints the presigned URLs the browser uses to push a file straight to storage. */
export const startFileUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        uploadId: z.string().uuid(),
        filename: z.string().min(1).max(400),
        contentType: z.string().max(200).default("application/octet-stream"),
        bytes: z.number().int().min(0).max(20 * 1024 * 1024 * 1024),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { loadUpload, sanitizeFilename, guessRole, partCountFor, SINGLE_PUT_LIMIT, PART_SIZE } =
      await import("./uploads.server");
    const b2 = await import("./b2.server");

    const upload = await loadUpload(context.supabase, data.uploadId);
    const filename = sanitizeFilename(data.filename);
    const key = `${upload.storage_prefix}/${filename}`;
    const role = guessRole(filename, data.contentType);

    if (data.bytes <= SINGLE_PUT_LIMIT) {
      return {
        mode: "single" as const,
        key,
        role,
        filename,
        partSize: PART_SIZE,
        url: await b2.uploadUrl(key),
        multipartId: null as string | null,
        urls: [] as string[],
      };
    }

    const multipartId = await b2.createMultipartUpload(key, data.contentType);
    const urls = await b2.presignParts(key, multipartId, partCountFor(data.bytes));
    return { mode: "multipart" as const, key, role, filename, partSize: PART_SIZE, url: null, multipartId, urls };
  });

export const finishFileUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        uploadId: z.string().uuid(),
        key: z.string().min(1),
        filename: z.string().min(1),
        contentType: z.string().max(200).default("application/octet-stream"),
        bytes: z.number().int().min(0),
        role: z.enum(["audio", "artwork", "document", "other"]),
        multipartId: z.string().nullable().optional(),
        parts: z.array(z.object({ partNumber: z.number().int(), etag: z.string() })).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { loadUpload } = await import("./uploads.server");
    const b2 = await import("./b2.server");
    await loadUpload(context.supabase, data.uploadId);

    if (data.multipartId && data.parts?.length) {
      await b2.completeMultipartUpload(data.key, data.multipartId, data.parts);
    }

    const { data: row, error } = await context.supabase
      .from("upload_files")
      .insert({
        upload_id: data.uploadId,
        role: data.role,
        filename: data.filename,
        storage_key: data.key,
        content_type: data.contentType,
        bytes: data.bytes,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const { data: files } = await context.supabase
      .from("upload_files")
      .select("bytes")
      .eq("upload_id", data.uploadId);
    const totals = (files ?? []).reduce((acc, f) => acc + Number(f.bytes ?? 0), 0);
    await context.supabase
      .from("uploads")
      .update({ total_bytes: totals, file_count: (files ?? []).length })
      .eq("id", data.uploadId);

    return { id: row.id };
  });

export const abortFileUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ key: z.string().min(1), multipartId: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data }) => {
    const b2 = await import("./b2.server");
    await b2.abortMultipartUpload(data.key, data.multipartId);
    return { ok: true };
  });

/** Sublabel hands the upload over to the admin for review. */
export const submitUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ uploadId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: files, error: filesError } = await context.supabase
      .from("upload_files")
      .select("id, role, filename, storage_key")
      .eq("upload_id", data.uploadId);
    if (filesError) throw new Error(filesError.message);
    const audio = (files ?? []).filter((f) => f.role === "audio");
    if (audio.length === 0) return { ok: false as const, message: "Add at least one audio file first." };
    if (!(files ?? []).some((f) => f.role === "artwork"))
      return { ok: false as const, message: "Add the cover artwork before submitting." };

    const { error } = await context.supabase
      .from("uploads")
      .update({ status: "uploaded" })
      .eq("id", data.uploadId);
    if (error) throw new Error(error.message);

    // seed the metadata sheet from the audio files, in filename order
    const { data: existing } = await context.supabase
      .from("upload_tracks")
      .select("id")
      .eq("upload_id", data.uploadId)
      .limit(1);
    if (!existing?.length) {
      const { data: upload } = await context.supabase
        .from("uploads")
        .select("artist_name")
        .eq("id", data.uploadId)
        .maybeSingle();
      const rows = audio
        .slice()
        .sort((a, b) => a.filename.localeCompare(b.filename, undefined, { numeric: true }))
        .map((f, i) => ({
          upload_id: data.uploadId,
          file_id: f.id,
          track_number: i + 1,
          title: f.filename.replace(/\.[^.]+$/, "").replace(/^\d+[\s._-]*/, ""),
          artist_name: upload?.artist_name ?? null,
        }));
      const seeded = await context.supabase.from("upload_tracks").insert(rows);
      if (seeded.error && !seeded.error.message.includes("row-level security"))
        throw new Error(seeded.error.message);
    }
    return { ok: true as const, message: "" };
  });

export const listUploads = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        status: z.string().optional(),
        sublabelId: z.string().uuid().nullable().optional(),
        kind: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    let query = context.supabase
      .from("uploads")
      .select(
        "id, kind, title, artist_name, status, total_bytes, file_count, created_at, sublabel_id, sublabels(name)",
      )
      .order("created_at", { ascending: false })
      .limit(300);
    if (data.status && data.status !== "all")
      query = query.eq("status", data.status as "draft");
    if (data.kind && data.kind !== "all") query = query.eq("kind", data.kind as "album");
    if (data.sublabelId) query = query.eq("sublabel_id", data.sublabelId);
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const getUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const b2 = await import("./b2.server");
    const { data: upload, error } = await context.supabase
      .from("uploads")
      .select(
        "id, kind, title, artist_name, upc, release_date, status, total_bytes, file_count, admin_notes, rejection_reason, extract_error, genre_code, language, label_name, copyright_pline, copyright_cline, created_at, sublabel_id, sublabels(name)",
      )
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!upload) throw new Error("Upload not found");

    const [{ data: files }, { data: tracks }, { data: jobs }] = await Promise.all([
      context.supabase
        .from("upload_files")
        .select("id, role, filename, storage_key, content_type, bytes")
        .eq("upload_id", data.id)
        .order("filename"),
      context.supabase
        .from("upload_tracks")
        .select("id, file_id, track_number, title, version, artist_name, isrc, explicit")
        .eq("upload_id", data.id)
        .order("track_number"),
      context.supabase
        .from("delivery_jobs")
        .select("id, state, attempts, error_message, apple_ticket, created_at, finished_at")
        .eq("upload_id", data.id)
        .order("created_at", { ascending: false }),
    ]);

    const withUrls = await Promise.all(
      (files ?? []).map(async (f) => ({ ...f, url: await b2.previewUrl(f.storage_key) })),
    );

    return { upload, files: withUrls, tracks: tracks ?? [], jobs: jobs ?? [] };
  });

export const deleteUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { assertAdmin } = await import("./guards.server");
    await assertAdmin(context.supabase, context.userId);
    const b2 = await import("./b2.server");

    const { data: files } = await context.supabase
      .from("upload_files")
      .select("storage_key")
      .eq("upload_id", data.id);
    for (const f of files ?? []) {
      try {
        await b2.deleteObject(f.storage_key);
      } catch {
        /* object may already be gone; the row goes away regardless */
      }
    }
    const { error } = await context.supabase.from("uploads").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const storageStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const b2 = await import("./b2.server");
    return { configured: b2.storageConfigured() };
  });

/** Admin removes a single file from an upload (storage object plus row). */
export const deleteUploadFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ uploadId: z.string().uuid(), fileId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertAdmin } = await import("./guards.server");
    await assertAdmin(context.supabase, context.userId);
    const b2 = await import("./b2.server");

    const { data: file } = await context.supabase
      .from("upload_files")
      .select("storage_key")
      .eq("id", data.fileId)
      .eq("upload_id", data.uploadId)
      .maybeSingle();
    if (!file) return { ok: false as const, message: "That file is already gone." };

    try {
      await b2.deleteObject(file.storage_key);
    } catch {
      /* the row goes away even when the object is missing */
    }
    await context.supabase.from("upload_tracks").update({ file_id: null }).eq("file_id", data.fileId);
    const { error } = await context.supabase.from("upload_files").delete().eq("id", data.fileId);
    if (error) throw new Error(error.message);

    const { data: files } = await context.supabase
      .from("upload_files")
      .select("bytes")
      .eq("upload_id", data.uploadId);
    await context.supabase
      .from("uploads")
      .update({
        total_bytes: (files ?? []).reduce((a, f) => a + Number(f.bytes ?? 0), 0),
        file_count: (files ?? []).length,
      })
      .eq("id", data.uploadId);
    return { ok: true as const, message: "File deleted." };
  });
