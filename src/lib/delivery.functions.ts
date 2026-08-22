import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/* -------------------------------- ISRC pool ------------------------------- */

export const importIsrcCodes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ raw: z.string().min(1).max(500_000) }).parse(input))
  .handler(async ({ data, context }) => {
    const { assertAdmin } = await import("./guards.server");
    const { normalizeIsrc, isrcValid } = await import("./uploads.server");
    await assertAdmin(context.supabase, context.userId);

    const tokens = data.raw
      .split(/[\s,;]+/)
      .map((t) => normalizeIsrc(t))
      .filter(Boolean);
    const valid: string[] = [];
    const invalid: string[] = [];
    for (const t of tokens) (isrcValid(t) ? valid : invalid).push(t);

    const unique = [...new Set(valid)];
    let added = 0;
    for (let i = 0; i < unique.length; i += 500) {
      const chunk = unique.slice(i, i + 500).map((code) => ({ code }));
      const { data: rows, error } = await context.supabase
        .from("isrc_pool")
        .upsert(chunk, { onConflict: "code", ignoreDuplicates: true })
        .select("id");
      if (error) throw new Error(error.message);
      added += rows?.length ?? 0;
    }
    return { parsed: tokens.length, added, duplicates: unique.length - added, invalid: invalid.slice(0, 50) };
  });

export const isrcPoolStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { assertAdmin } = await import("./guards.server");
    await assertAdmin(context.supabase, context.userId);
    const [total, used, sample] = await Promise.all([
      context.supabase.from("isrc_pool").select("id", { count: "exact", head: true }),
      context.supabase
        .from("isrc_pool")
        .select("id", { count: "exact", head: true })
        .or("used_by_track_id.not.is.null,assigned_at.not.is.null"),
      context.supabase
        .from("isrc_pool")
        .select("code, used_by_track_id, assigned_at")
        .order("code")
        .limit(200),
    ]);
    return {
      total: total.count ?? 0,
      used: used.count ?? 0,
      free: (total.count ?? 0) - (used.count ?? 0),
      sample: sample.data ?? [],
    };
  });

/** Stamps the next free pool codes onto every track that still has none. */
export const assignIsrcsToUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ uploadId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { assertAdmin } = await import("./guards.server");
    await assertAdmin(context.supabase, context.userId);
    const { assertUploadEditable } = await import("./guards.server");
    await assertUploadEditable(context.supabase, data.uploadId);

    const { data: tracks, error } = await context.supabase
      .from("upload_tracks")
      .select("id, isrc, track_number")
      .eq("upload_id", data.uploadId)
      .order("track_number");
    if (error) throw new Error(error.message);
    const needy = (tracks ?? []).filter((t) => !t.isrc);
    if (needy.length === 0) return { ok: true as const, assigned: 0, message: "Every track already has an ISRC." };

    const { data: free, error: freeError } = await context.supabase
      .from("isrc_pool")
      .select("id, code")
      .is("used_by_track_id", null)
      .is("assigned_at", null)
      .order("code")
      .limit(needy.length);
    if (freeError) throw new Error(freeError.message);
    if ((free ?? []).length < needy.length)
      return {
        ok: false as const,
        assigned: 0,
        message: `Only ${free?.length ?? 0} free ISRC${free?.length === 1 ? "" : "s"} left in the pool but ${needy.length} needed. Import more codes first.`,
      };

    let assigned = 0;
    for (let i = 0; i < needy.length; i++) {
      const code = free![i]!;
      const track = needy[i]!;
      const claim = await context.supabase
        .from("isrc_pool")
        .update({ used_by_track_id: track.id, assigned_at: new Date().toISOString() })
        .eq("id", code.id)
        .is("used_by_track_id", null)
        .select("id");
      if (claim.error) throw new Error(claim.error.message);
      if (!claim.data?.length) continue; // someone else took it
      const upd = await context.supabase
        .from("upload_tracks")
        .update({ isrc: code.code })
        .eq("id", track.id);
      if (upd.error) throw new Error(upd.error.message);
      assigned += 1;
    }
    return { ok: true as const, assigned, message: `Assigned ${assigned} ISRC${assigned === 1 ? "" : "s"}.` };
  });

export const releaseIsrcsForUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ uploadId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { assertAdmin } = await import("./guards.server");
    await assertAdmin(context.supabase, context.userId);
    const { assertUploadEditable } = await import("./guards.server");
    await assertUploadEditable(context.supabase, data.uploadId);
    const { data: tracks } = await context.supabase
      .from("upload_tracks")
      .select("id")
      .eq("upload_id", data.uploadId);
    const { data: uploadRow } = await context.supabase
      .from("uploads")
      .select("upc")
      .eq("id", data.uploadId)
      .maybeSingle();
    if (uploadRow?.upc) {
      await context.supabase
        .from("isrc_pool")
        .update({ assigned_at: null })
        .eq("code", uploadRow.upc)
        .is("used_by_track_id", null);
      await context.supabase.from("uploads").update({ upc: null }).eq("id", data.uploadId);
    }
    const ids = (tracks ?? []).map((t) => t.id);
    if (ids.length) {
      await context.supabase
        .from("isrc_pool")
        .update({ used_by_track_id: null, assigned_at: null })
        .in("used_by_track_id", ids);
      await context.supabase.from("upload_tracks").update({ isrc: null }).in("id", ids);
    }
    return { ok: true as const };
  });

/* ------------------------------ metadata sheet ----------------------------- */

export const saveSheet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        uploadId: z.string().uuid(),
        artistName: z.string().trim().max(300).optional(),
        upc: z.string().trim().max(40).optional(),
        releaseDate: z.string().trim().max(10).optional(),
        adminNotes: z.string().trim().max(2000).optional(),
        tracks: z
          .array(
            z.object({
              id: z.string().uuid(),
              trackNumber: z.number().int().min(1).max(999),
              title: z.string().trim().min(1).max(300),
              version: z.string().trim().max(120).optional(),
              artistName: z.string().trim().max(300).optional(),
              isrc: z.string().trim().max(20).optional(),
              explicit: z.boolean().default(false),
            }),
          )
          .max(500),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertAdmin } = await import("./guards.server");
    const { normalizeIsrc, isrcValid } = await import("./uploads.server");
    await assertAdmin(context.supabase, context.userId);
    const { assertUploadEditable } = await import("./guards.server");
    await assertUploadEditable(context.supabase, data.uploadId);

    const seen = new Set<string>();
    for (const t of data.tracks) {
      if (!t.isrc) continue;
      const code = normalizeIsrc(t.isrc);
      if (!isrcValid(code)) return { ok: false as const, message: `"${t.isrc}" is not a valid ISRC.` };
      if (seen.has(code)) return { ok: false as const, message: `ISRC ${code} is used twice in this sheet.` };
      seen.add(code);
    }

    const { error: upErr } = await context.supabase
      .from("uploads")
      .update({
        artist_name: data.artistName || null,
        upc: data.upc || null,
        release_date: data.releaseDate || null,
        admin_notes: data.adminNotes || null,
      })
      .eq("id", data.uploadId);
    if (upErr) throw new Error(upErr.message);

    for (const t of data.tracks) {
      const { error } = await context.supabase
        .from("upload_tracks")
        .update({
          track_number: t.trackNumber,
          title: t.title,
          version: t.version || null,
          artist_name: t.artistName || data.artistName || null,
          isrc: t.isrc ? normalizeIsrc(t.isrc) : null,
          explicit: t.explicit,
        })
        .eq("id", t.id)
        .eq("upload_id", data.uploadId);
      if (error) throw new Error(error.message);
    }
    return { ok: true as const, message: "Sheet saved." };
  });

/** Types the artist name once and applies it to every row. */
export const applyArtistToAll = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ uploadId: z.string().uuid(), artistName: z.string().trim().min(1).max(300) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertAdmin } = await import("./guards.server");
    await assertAdmin(context.supabase, context.userId);
    const { assertUploadEditable } = await import("./guards.server");
    await assertUploadEditable(context.supabase, data.uploadId);
    await context.supabase.from("uploads").update({ artist_name: data.artistName }).eq("id", data.uploadId);
    const { error } = await context.supabase
      .from("upload_tracks")
      .update({ artist_name: data.artistName })
      .eq("upload_id", data.uploadId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const setUploadStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        uploadId: z.string().uuid(),
        status: z.enum(["in_review", "ready", "rejected", "cancelled", "uploaded"]),
        reason: z.string().trim().max(1000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertAdmin } = await import("./guards.server");
    await assertAdmin(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("uploads")
      .update({ status: data.status, rejection_reason: data.reason || null })
      .eq("id", data.uploadId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/* -------------------------------- delivery -------------------------------- */

export const queueDelivery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ uploadId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { assertAdmin } = await import("./guards.server");
    await assertAdmin(context.supabase, context.userId);

    const { data: upload, error: uploadError } = await context.supabase
      .from("uploads")
      .select("id, kind, title, artist_name, upc, status")
      .eq("id", data.uploadId)
      .maybeSingle();
    if (uploadError) throw new Error(uploadError.message);
    if (!upload) throw new Error("Upload not found");
    if (upload.status !== "ready")
      return {
        ok: false as const,
        message: "Approve this release first — mark it Ready, then deliver.",
      };

    const { data: tracks } = await context.supabase
      .from("upload_tracks")
      .select("id, title, isrc, file_id")
      .eq("upload_id", data.uploadId);
    if (!tracks?.length) return { ok: false as const, message: "The metadata sheet is empty." };
    const missing = tracks.filter((t) => !t.isrc || !t.file_id);
    if (missing.length)
      return {
        ok: false as const,
        message: `${missing.length} track${missing.length === 1 ? " is" : "s are"} missing an ISRC or an audio file.`,
      };
    if (!upload.artist_name) return { ok: false as const, message: "Set the artist name first." };
    if (upload.kind === "album" && !upload.upc)
      return { ok: false as const, message: "Albums need a UPC before delivery." };

    const { data: active } = await context.supabase
      .from("delivery_jobs")
      .select("id")
      .eq("upload_id", data.uploadId)
      .in("state", ["queued", "claimed", "packaging", "uploading", "awaiting_approval"])
      .limit(1);
    if (active?.length) return { ok: false as const, message: "A delivery is already running for this upload." };

    const { error } = await context.supabase
      .from("delivery_jobs")
      .insert({ upload_id: data.uploadId, state: "queued" });
    if (error) throw new Error(error.message);
    await context.supabase.from("uploads").update({ status: "packaging" }).eq("id", data.uploadId);
    return { ok: true as const, message: "Queued for packaging and delivery." };
  });

/** Admin reviewed the built packages and lets the worker upload them to Apple. */
export const approvePackages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ jobId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { assertAdmin } = await import("./guards.server");
    await assertAdmin(context.supabase, context.userId);

    const { data: job, error: jobError } = await context.supabase
      .from("delivery_jobs")
      .select("id, upload_id, state")
      .eq("id", data.jobId)
      .maybeSingle();
    if (jobError) throw new Error(jobError.message);
    if (!job) throw new Error("Job not found");
    if (job.state !== "awaiting_approval")
      return { ok: false as const, message: "This job is not waiting for approval." };

    const { error } = await context.supabase
      .from("delivery_jobs")
      .update({ approved_for_delivery: true, state: "queued", error_message: null, lease_until: null })
      .eq("id", data.jobId);
    if (error) throw new Error(error.message);
    await context.supabase.from("uploads").update({ status: "packaging" }).eq("id", job.upload_id);
    return { ok: true as const, message: "Approved — the worker will upload to Apple." };
  });

/** Admin rejects the built packages; nothing is sent to Apple. */
export const rejectPackages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ jobId: z.string().uuid(), reason: z.string().trim().max(500).optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertAdmin } = await import("./guards.server");
    await assertAdmin(context.supabase, context.userId);

    const { data: job, error: jobError } = await context.supabase
      .from("delivery_jobs")
      .select("id, upload_id, state")
      .eq("id", data.jobId)
      .maybeSingle();
    if (jobError) throw new Error(jobError.message);
    if (!job) throw new Error("Job not found");
    if (job.state !== "awaiting_approval")
      return { ok: false as const, message: "This job is not waiting for approval." };

    const { error } = await context.supabase
      .from("delivery_jobs")
      .update({
        state: "failed",
        error_message: data.reason || "Packages rejected by admin",
        finished_at: new Date().toISOString(),
      })
      .eq("id", data.jobId);
    if (error) throw new Error(error.message);
    await context.supabase.from("uploads").update({ status: "ready" }).eq("id", job.upload_id);
    return { ok: true as const, message: "Packages rejected — nothing was sent to Apple." };
  });

/** Clears a job that no worker has picked up, so the release can be re-queued. */
export const cancelDelivery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ jobId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { assertAdmin } = await import("./guards.server");
    await assertAdmin(context.supabase, context.userId);

    const { data: job, error: jobError } = await context.supabase
      .from("delivery_jobs")
      .select("id, upload_id, state, worker_id")
      .eq("id", data.jobId)
      .maybeSingle();
    if (jobError) throw new Error(jobError.message);
    if (!job) throw new Error("Job not found");
    if (job.state !== "queued")
      return { ok: false as const, message: "A worker is already processing this job." };

    const { error } = await context.supabase
      .from("delivery_jobs")
      .update({ state: "failed", error_message: "Cancelled by admin", finished_at: new Date().toISOString() })
      .eq("id", data.jobId);
    if (error) throw new Error(error.message);
    await context.supabase.from("uploads").update({ status: "ready" }).eq("id", job.upload_id);
    return { ok: true as const, message: "Delivery cancelled." };
  });

export const retryDelivery = createServerFn({ method: "POST" })

  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ jobId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { assertAdmin } = await import("./guards.server");
    await assertAdmin(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("delivery_jobs")
      .update({ state: "queued", error_message: null, lease_until: null, finished_at: null })
      .eq("id", data.jobId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/**
 * Log tail for one job. With `afterId` it returns the lines written since then;
 * without it, the newest 300 lines (so long jobs show their live tail, not their
 * first 500 lines).
 */
export const deliveryLogs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ jobId: z.string().uuid(), afterId: z.number().int().default(0) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    if (data.afterId > 0) {
      const { data: rows, error } = await context.supabase
        .from("delivery_logs")
        .select("id, line, level, created_at")
        .eq("job_id", data.jobId)
        .gt("id", data.afterId)
        .order("id")
        .limit(500);
      if (error) throw new Error(error.message);
      return rows ?? [];
    }
    const { data: rows, error } = await context.supabase
      .from("delivery_logs")
      .select("id, line, level, created_at")
      .eq("job_id", data.jobId)
      .order("id", { ascending: false })
      .limit(300);
    if (error) throw new Error(error.message);
    return (rows ?? []).slice().reverse();
  });

/**
 * Reconciles a job whose worker lost its database session mid-upload: the
 * packages went to Apple but their rows were never updated. Marks the leftover
 * packages and the job as delivered. Nothing is sent to Apple from here.
 */
export const resyncJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ jobId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { assertAdmin } = await import("./guards.server");
    await assertAdmin(context.supabase, context.userId);

    const { data: job, error: jobError } = await context.supabase
      .from("delivery_jobs")
      .select("id, upload_id, state")
      .eq("id", data.jobId)
      .maybeSingle();
    if (jobError) throw new Error(jobError.message);
    if (!job) throw new Error("Job not found");

    const { data: stale, error: staleError } = await context.supabase
      .from("delivery_packages")
      .update({ state: "succeeded", error_message: null })
      .eq("job_id", data.jobId)
      .in("state", ["queued", "claimed", "packaging", "uploading", "awaiting_approval"])
      .select("id");
    if (staleError) throw new Error(staleError.message);

    const { error } = await context.supabase
      .from("delivery_jobs")
      .update({
        state: "succeeded",
        error_message: null,
        approved_for_delivery: true,
        finished_at: new Date().toISOString(),
      })
      .eq("id", data.jobId);
    if (error) throw new Error(error.message);
    await context.supabase.from("uploads").update({ status: "delivered" }).eq("id", job.upload_id);

    return {
      ok: true as const,
      message: `Marked ${stale?.length ?? 0} package${(stale?.length ?? 0) === 1 ? "" : "s"} and the job as delivered.`,
    };
  });

export const deliveryQueue = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { assertAdmin } = await import("./guards.server");
    await assertAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("delivery_jobs")
      .select(
        "id, state, attempts, error_message, apple_ticket, created_at, finished_at, worker_id, uploads(id, title, kind, sublabels(name))",
      )
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/** Admin edits the release header (title, type, artist, UPC, release date). */
export const adminEditUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        uploadId: z.string().uuid(),
        title: z.string().trim().min(1).max(300),
        kind: z.enum(["album", "singles", "ringtones"]),
        artistName: z.string().trim().max(300).optional(),
        upc: z.string().trim().max(40).optional(),
        releaseDate: z.string().trim().max(10).optional(),
        genreCode: z.string().trim().max(40).optional(),
        language: z.string().trim().max(10).optional(),
        labelName: z.string().trim().max(200).optional(),
        copyrightPline: z.string().trim().max(300).optional(),
        copyrightCline: z.string().trim().max(300).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertAdmin } = await import("./guards.server");
    await assertAdmin(context.supabase, context.userId);
    const { assertUploadEditable } = await import("./guards.server");
    await assertUploadEditable(context.supabase, data.uploadId);
    const { error } = await context.supabase
      .from("uploads")
      .update({
        title: data.title,
        kind: data.kind,
        artist_name: data.artistName || null,
        upc: data.upc || null,
        release_date: data.releaseDate || null,
        genre_code: data.genreCode || null,
        language: data.language || null,
        label_name: data.labelName || null,
        copyright_pline: data.copyrightPline || null,
        copyright_cline: data.copyrightCline || null,
      })
      .eq("id", data.uploadId);
    if (error) throw new Error(error.message);
    return { ok: true as const, message: "Release details saved." };
  });

/**
 * Fills every missing code from the pool in one click: albums take the first
 * free code as the album vendor id / UPC and each track the next code;
 * ringtone releases give every folder its own code.
 */
export const assignCodesToUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ uploadId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { assertAdmin } = await import("./guards.server");
    await assertAdmin(context.supabase, context.userId);
    const { assertUploadEditable } = await import("./guards.server");
    await assertUploadEditable(context.supabase, data.uploadId);

    const { data: upload, error: upErr } = await context.supabase
      .from("uploads")
      .select("id, kind, upc")
      .eq("id", data.uploadId)
      .maybeSingle();
    if (upErr) throw new Error(upErr.message);
    if (!upload) throw new Error("Upload not found");

    const { data: tracks, error } = await context.supabase
      .from("upload_tracks")
      .select("id, isrc, track_number")
      .eq("upload_id", data.uploadId)
      .order("track_number");
    if (error) throw new Error(error.message);

    const needsAlbumCode = upload.kind !== "ringtones" && !upload.upc;
    const needy = (tracks ?? []).filter((t) => !t.isrc);
    const wanted = needy.length + (needsAlbumCode ? 1 : 0);
    if (wanted === 0) return { ok: true as const, message: "Every code is already filled in." };

    const { data: pool, error: freeError } = await context.supabase
      .from("isrc_pool")
      .select("id, code")
      .is("used_by_track_id", null)
      .is("assigned_at", null)
      .order("code")
      .limit(wanted + 200);
    if (freeError) throw new Error(freeError.message);
    // Album-level codes live on uploads.upc, so they are not linked to a track — exclude them.
    const { data: takenAlbums, error: takenErr } = await context.supabase
      .from("uploads")
      .select("upc")
      .not("upc", "is", null);
    if (takenErr) throw new Error(takenErr.message);
    const taken = new Set((takenAlbums ?? []).map((u) => (u.upc ?? "").toUpperCase()));
    const free = (pool ?? []).filter((c) => !taken.has(c.code.toUpperCase())).slice(0, wanted);
    if (free.length < wanted)
      return {
        ok: false as const,
        message: `Only ${free.length} free code${free.length === 1 ? "" : "s"} left in the pool but ${wanted} are needed. Import more codes first.`,
      };

    let cursor = 0;
    let assigned = 0;
    if (needsAlbumCode) {
      const albumCode = free[cursor++]!;
      const { error: albumErr } = await context.supabase
        .from("uploads")
        .update({ upc: albumCode.code })
        .eq("id", data.uploadId);
      if (albumErr) throw new Error(albumErr.message);
      await context.supabase
        .from("isrc_pool")
        .update({ assigned_at: new Date().toISOString() })
        .eq("id", albumCode.id);
      assigned += 1;
    }

    for (const track of needy) {
      const code = free[cursor++]!;
      const claim = await context.supabase
        .from("isrc_pool")
        .update({ used_by_track_id: track.id, assigned_at: new Date().toISOString() })
        .eq("id", code.id)
        .is("used_by_track_id", null)
        .select("id");
      if (claim.error) throw new Error(claim.error.message);
      if (!claim.data?.length) continue;
      const upd = await context.supabase.from("upload_tracks").update({ isrc: code.code }).eq("id", track.id);
      if (upd.error) throw new Error(upd.error.message);
      assigned += 1;
    }
    return { ok: true as const, message: `Filled ${assigned} code${assigned === 1 ? "" : "s"}.` };
  });


/** Builds the metadata.xml documents the worker will deliver, for admin review. */
export const previewMetadata = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ uploadId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { assertAdmin } = await import("./guards.server");
    const { buildMetadataPreview } = await import("./metadata-xml");
    await assertAdmin(context.supabase, context.userId);

    const { data: upload, error: upErr } = await context.supabase
      .from("uploads")
      .select(
        "id, kind, title, artist_name, upc, release_date, genre_code, language, label_name, copyright_pline, copyright_cline, sublabels(name)",
      )
      .eq("id", data.uploadId)
      .maybeSingle();
    if (upErr) throw new Error(upErr.message);
    if (!upload) throw new Error("Upload not found");

    const [{ data: tracks }, { data: files }] = await Promise.all([
      context.supabase
        .from("upload_tracks")
        .select("id, title, isrc, artist_name, file_id, artwork_file_id, track_number")
        .eq("upload_id", data.uploadId)
        .order("track_number"),
      context.supabase
        .from("upload_files")
        .select("id, filename, bytes, role")
        .eq("upload_id", data.uploadId),
    ]);

    const byId = new Map((files ?? []).map((f) => [f.id, f]));
    const fallbackArtwork = (files ?? []).find((f) => f.role === "artwork") ?? null;
    const provider = process.env["APPLE_PROVIDER_SHORTNAME"] || "provider";

    const previewTracks = (tracks ?? []).map((t) => {
      const audio = t.file_id ? byId.get(t.file_id) : null;
      const art = t.artwork_file_id ? byId.get(t.artwork_file_id) : fallbackArtwork;
      return {
        title: t.title ?? "",
        isrc: t.isrc ?? "",
        artist_name: t.artist_name ?? upload.artist_name ?? "",
        audio: audio ? { file_name: audio.filename, size: Number(audio.bytes ?? 0) } : null,
        artwork: art ? { file_name: art.filename, size: Number(art.bytes ?? 0) } : null,
      };
    });

    const packages = buildMetadataPreview(
      {
        kind: upload.kind,
        title: upload.title,
        vendor_id: upload.upc ?? previewTracks[0]?.isrc ?? "",
        artist_name: upload.artist_name ?? "",
        genre_code: upload.genre_code || (upload.kind === "ringtones" ? "RINGTONES-00" : "POP-00"),
        language: upload.language || "en",
        label_name: upload.label_name || (upload.sublabels as { name: string } | null)?.name || provider,
        copyright_pline: upload.copyright_pline ?? "",
        copyright_cline: upload.copyright_cline ?? "",
        release_date: upload.release_date ?? null,
        provider,
      },
      previewTracks,
    );

    const warnings: string[] = [];
    if (!upload.artist_name) warnings.push("Artist name is empty.");
    previewTracks.forEach((t, i) => {
      if (!t.isrc) warnings.push(`Track ${i + 1} ("${t.title}") has no ISRC.`);
      if (!t.audio) warnings.push(`Track ${i + 1} ("${t.title}") has no audio file.`);
    });
    if (upload.kind !== "ringtones" && !upload.upc) warnings.push("Album ISRC (vendor id) is empty.");

    return { total: packages.length, packages: packages.slice(0, 5), warnings: warnings.slice(0, 20) };
  });

/**
 * Runs once after Apple accepted a release: adds the delivered items to the
 * sublabel catalogue and frees the original files from object storage.
 * Safe to call again — the catalog stamp makes it a no-op.
 */
export const finalizeDelivered = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ uploadId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { assertAdmin } = await import("./guards.server");
    await assertAdmin(context.supabase, context.userId);

    const { data: upload, error: upErr } = await context.supabase
      .from("uploads")
      .select("id, kind, title, artist_name, upc, status, sublabel_id, catalog_synced_at")
      .eq("id", data.uploadId)
      .maybeSingle();
    if (upErr) throw new Error(upErr.message);
    if (!upload) throw new Error("Upload not found");
    if (upload.status !== "delivered")
      return { ok: false as const, message: "This release has not been delivered yet." };
    if (upload.catalog_synced_at) return { ok: true as const, message: "Already added to the catalog." };

    const { data: tracks } = await context.supabase
      .from("upload_tracks")
      .select("id, title, version, artist_name, isrc, track_number")
      .eq("upload_id", data.uploadId)
      .order("track_number");

    type NewItem = {
      sublabel_id: string;
      title: string;
      artist_name: string | null;
      isrc: string | null;
      upc: string | null;
      item_type: "album" | "album_song" | "single" | "ringtone";
    };
    const rows: NewItem[] = [];
    if (upload.kind === "album" && upload.upc) {
      rows.push({
        sublabel_id: upload.sublabel_id,
        title: upload.title,
        artist_name: upload.artist_name ?? null,
        isrc: upload.upc,
        upc: upload.upc,
        item_type: "album",
      });
    }
    const trackType = upload.kind === "album" ? "album_song" : upload.kind === "ringtones" ? "ringtone" : "single";
    for (const t of tracks ?? []) {
      if (!t.isrc) continue;
      rows.push({
        sublabel_id: upload.sublabel_id,
        title: t.version ? `${t.title} (${t.version})` : t.title,
        artist_name: t.artist_name ?? upload.artist_name ?? null,
        isrc: t.isrc,
        upc: upload.kind === "album" ? (upload.upc ?? null) : null,
        item_type: trackType,
      });
    }

    let added = 0;
    if (rows.length) {
      const codes = rows.map((r) => r.isrc!).filter(Boolean);
      const { data: existing } = await context.supabase.from("items").select("isrc").in("isrc", codes);
      const taken = new Set((existing ?? []).map((i) => (i.isrc ?? "").toUpperCase()));
      const fresh = rows.filter((r) => !taken.has((r.isrc ?? "").toUpperCase()));
      if (fresh.length) {
        const { error } = await context.supabase.from("items").insert(fresh);
        if (error) throw new Error(error.message);
        added = fresh.length;
      }
    }

    // Free the source files: Apple has the package, storage no longer needs them.
    const b2 = await import("./b2.server");
    const { data: files } = await context.supabase
      .from("upload_files")
      .select("id, storage_key")
      .eq("upload_id", data.uploadId);
    for (const f of files ?? []) {
      try {
        await b2.deleteObject(f.storage_key);
      } catch {
        /* already gone */
      }
    }
    if ((files ?? []).length) {
      await context.supabase.from("upload_tracks").update({ file_id: null, artwork_file_id: null }).eq("upload_id", data.uploadId);
      await context.supabase.from("upload_files").delete().eq("upload_id", data.uploadId);
    }

    await context.supabase
      .from("uploads")
      .update({ catalog_synced_at: new Date().toISOString(), file_count: 0, total_bytes: 0 })
      .eq("id", data.uploadId);

    return {
      ok: true as const,
      message: `${added} catalog item${added === 1 ? "" : "s"} added; source files removed from storage.`,
    };
  });
