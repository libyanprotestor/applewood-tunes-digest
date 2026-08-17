import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/* ---------------------------------- sublabels --------------------------------- */

export const listSublabels = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("sublabels")
      .select("id, name, contact_email, notes, is_active, created_at")
      .order("name");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const saveSublabel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        name: z.string().trim().min(1).max(120),
        contactEmail: z.string().trim().email().max(255).or(z.literal("")).optional(),
        notes: z.string().trim().max(1000).optional(),
        isActive: z.boolean().default(true),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertAdmin } = await import("./guards.server");
    await assertAdmin(context.supabase, context.userId);
    const payload = {
      name: data.name,
      contact_email: data.contactEmail || null,
      notes: data.notes || null,
      is_active: data.isActive,
    };
    const query = data.id
      ? context.supabase.from("sublabels").update(payload).eq("id", data.id)
      : context.supabase.from("sublabels").insert(payload);
    const { error } = await query;
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteSublabel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { assertAdmin } = await import("./guards.server");
    await assertAdmin(context.supabase, context.userId);

    const { count, error: countError } = await context.supabase
      .from("items")
      .select("id", { count: "exact", head: true })
      .eq("sublabel_id", data.id);
    if (countError) throw new Error(countError.message);
    if ((count ?? 0) > 0)
      return {
        ok: false as const,
        message: `This sublabel still has ${count} catalog item${count === 1 ? "" : "s"}. Delete or reassign them first.`,
      };

    const { error } = await context.supabase.from("sublabels").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const, message: "" };
  });


/** Creates the login a sublabel uses to sign in and see their own numbers. */
export const createSublabelUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        sublabelId: z.string().uuid(),
        email: z.string().trim().email().max(255),
        password: z.string().min(8).max(72),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertAdmin } = await import("./guards.server");
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { sublabel_id: data.sublabelId },
    });
    if (error) throw new Error(error.message);

    const userId = created.user?.id;
    if (userId) {
      await supabaseAdmin
        .from("profiles")
        .upsert({ id: userId, email: data.email, sublabel_id: data.sublabelId }, { onConflict: "id" });
      await supabaseAdmin
        .from("user_roles")
        .upsert({ user_id: userId, role: "sublabel" }, { onConflict: "user_id,role" });
    }
    return { ok: true };
  });

/** Sets a new password for an existing sublabel login. */
export const resetSublabelPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        password: z.string().min(8).max(72),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertAdmin } = await import("./guards.server");
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      password: data.password,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listSublabelUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { assertAdmin } = await import("./guards.server");
    await assertAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("profiles")
      .select("id, email, sublabel_id")
      .not("sublabel_id", "is", null);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/* ------------------------------------ items ----------------------------------- */

export const listItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ sublabelId: z.string().uuid().nullable().optional(), search: z.string().optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    let query = context.supabase
      .from("items")
      .select("id, title, artist_name, isrc, upc, apple_id, item_type, sublabel_id, sublabels(name)")
      .order("title")
      .limit(500);
    if (data.sublabelId) query = query.eq("sublabel_id", data.sublabelId);
    if (data.search)
      query = query.or(
        `title.ilike.%${data.search}%,isrc.ilike.%${data.search}%,upc.ilike.%${data.search}%,apple_id.ilike.%${data.search}%`,
      );
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

const csvItem = z.object({
  sublabel: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(300),
  artistName: z.string().trim().max(300).optional(),
  isrc: z.string().trim().max(40).optional(),
  upc: z.string().trim().max(40).optional(),
  appleId: z.string().trim().max(40).optional(),
  itemType: z.enum(["ringtone", "single", "album", "other"]).default("single"),
});

/** Bulk-imports catalog rows parsed from a CSV in the browser; each row names its sublabel. */
export const importItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ rows: z.array(csvItem).min(1).max(5000) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertAdmin } = await import("./guards.server");
    await assertAdmin(context.supabase, context.userId);

    const { data: subs, error: subsError } = await context.supabase.from("sublabels").select("id, name");
    if (subsError) throw new Error(subsError.message);
    const byName = new Map((subs ?? []).map((s) => [s.name.trim().toLowerCase(), s.id]));
    const nameById = new Map((subs ?? []).map((s) => [s.id, s.name]));

    // existing catalog codes, to flag duplicates against the database
    const { data: existing, error: existingError } = await context.supabase
      .from("items")
      .select("isrc, apple_id");
    if (existingError) throw new Error(existingError.message);
    const seenIsrc = new Set<string>();
    const seenApple = new Set<string>();
    for (const e of existing ?? []) {
      if (e.isrc) seenIsrc.add(e.isrc.toUpperCase());
      if (e.apple_id) seenApple.add(e.apple_id);
    }

    let inserted = 0;
    const perSublabel = new Map<string, number>();
    const unknownSublabels = new Map<string, number>();
    const duplicates: { title: string; sublabel: string; isrc: string | null; appleId: string | null; reason: string }[] = [];
    const errors: string[] = [];

    for (const row of data.rows) {
      const isrc = row.isrc ? row.isrc.toUpperCase() : null;
      const appleId = row.appleId || null;

      const sublabelId = byName.get(row.sublabel.trim().toLowerCase());
      if (!sublabelId) {
        unknownSublabels.set(row.sublabel, (unknownSublabels.get(row.sublabel) ?? 0) + 1);
        continue;
      }

      const dupIsrc = isrc ? seenIsrc.has(isrc) : false;
      const dupApple = appleId ? seenApple.has(appleId) : false;
      if (dupIsrc || dupApple) {
        duplicates.push({
          title: row.title,
          sublabel: row.sublabel,
          isrc,
          appleId,
          reason: dupIsrc && dupApple ? "ISRC and Apple ID" : dupIsrc ? "ISRC" : "Apple ID",
        });
        continue;
      }

      const { error } = await context.supabase.from("items").insert({
        sublabel_id: sublabelId,
        title: row.title,
        artist_name: row.artistName || null,
        isrc,
        upc: row.upc ? row.upc.toUpperCase() : null,
        apple_id: appleId,
        item_type: row.itemType,
      });
      if (error) {
        errors.push(`${row.title}: ${error.message}`);
        continue;
      }
      inserted += 1;
      if (isrc) seenIsrc.add(isrc);
      if (appleId) seenApple.add(appleId);
      const label = nameById.get(sublabelId) ?? row.sublabel;
      perSublabel.set(label, (perSublabel.get(label) ?? 0) + 1);
    }

    return {
      totalRows: data.rows.length,
      inserted,
      perSublabel: [...perSublabel.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
      unknownSublabels: [...unknownSublabels.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
      skippedUnknownSublabel: [...unknownSublabels.values()].reduce((a, b) => a + b, 0),
      duplicateCount: duplicates.length,
      duplicates: duplicates.slice(0, 500),
      errors: errors.slice(0, 50),
    };
  });




export const deleteItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { assertAdmin } = await import("./guards.server");
    await assertAdmin(context.supabase, context.userId);

    const [sales, streams] = await Promise.all([
      context.supabase.from("sales").select("id", { count: "exact", head: true }).eq("item_id", data.id),
      context.supabase.from("streams").select("id", { count: "exact", head: true }).eq("item_id", data.id),
    ]);
    if (sales.error) throw new Error(sales.error.message);
    if (streams.error) throw new Error(streams.error.message);
    const saleCount = sales.count ?? 0;
    const streamCount = streams.count ?? 0;
    if (saleCount > 0 || streamCount > 0)
      return {
        ok: false as const,
        message: `This item has ${saleCount} sale row${saleCount === 1 ? "" : "s"} and ${streamCount} stream row${streamCount === 1 ? "" : "s"} linked to it, so it can't be deleted.`,
      };

    const { error } = await context.supabase.from("items").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const, message: "" };
  });


/* ------------------------------- unmatched sales ------------------------------ */

export const listUnmatched = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { assertAdmin } = await import("./guards.server");
    await assertAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("unmatched_sales")
      .select("id, sale_date, title, artist_name, isrc, upc, units, revenue_usd, country_code")
      .eq("resolved", false)
      .order("sale_date", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/** Assigns unmatched report lines to a catalog item, moving the revenue over.
 *  By default every unresolved line sharing the same ISRC/UPC is assigned at once. */
export const assignUnmatched = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        unmatchedId: z.string().uuid(),
        itemId: z.string().uuid(),
        applyToAll: z.boolean().default(true),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertAdmin } = await import("./guards.server");
    await assertAdmin(context.supabase, context.userId);

    const { data: seed, error: rowError } = await context.supabase
      .from("unmatched_sales")
      .select("*")
      .eq("id", data.unmatchedId)
      .single();
    if (rowError) throw new Error(rowError.message);

    const { data: item, error: itemError } = await context.supabase
      .from("items")
      .select("id, sublabel_id")
      .eq("id", data.itemId)
      .single();
    if (itemError) throw new Error(itemError.message);

    let rows = [seed];
    if (data.applyToAll && (seed.isrc || seed.upc)) {
      let q = context.supabase.from("unmatched_sales").select("*").eq("resolved", false);
      q = seed.isrc ? q.eq("isrc", seed.isrc) : q.eq("upc", seed.upc!);
      const { data: siblings, error } = await q;
      if (error) throw new Error(error.message);
      if (siblings?.length) rows = siblings;
    }

    const { error: insertError } = await context.supabase.from("sales").insert(
      rows.map((row) => ({
        item_id: item.id,
        sublabel_id: item.sublabel_id,
        sale_date: row.sale_date,
        country_code: row.country_code,
        units: row.units,
        original_currency: row.original_currency,
        revenue_usd: row.revenue_usd,
        product_type_id: row.product_type_id,
        report_run_id: row.report_run_id,
      })),
    );
    if (insertError) throw new Error(insertError.message);

    const { error: updateError } = await context.supabase
      .from("unmatched_sales")
      .update({ resolved: true })
      .in(
        "id",
        rows.map((r) => r.id),
      );
    if (updateError) throw new Error(updateError.message);
    return { ok: true, count: rows.length };
  });


/* -------------------------------- report runs -------------------------------- */

export const listRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { assertAdmin } = await import("./guards.server");
    await assertAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("report_runs")
      .select("*")
      .order("report_date", { ascending: false })
      .limit(60);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/** Manually pulls the report for a given date. */
export const runReportFetch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertAdmin } = await import("./guards.server");
    await assertAdmin(context.supabase, context.userId);
    const { ingestReport } = await import("./ingest.server");
    return ingestReport(data.reportDate, context.supabase);
  });

/* ---------------------------------- streams ----------------------------------- */

/** Manually pulls the Apple Music streaming report for a given date. */
export const runStreamsFetch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertAdmin } = await import("./guards.server");
    await assertAdmin(context.supabase, context.userId);
    const { ingestStreams } = await import("./ingest-streams.server");
    return ingestStreams(data.reportDate, context.supabase);
  });

/** Revenue paid per 1000 streams. */
export const getStreamRate = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("app_settings")
      .select("stream_rate_per_1000")
      .limit(1)
      .maybeSingle();
    if (error) {
      // Transient auth/clock-skew errors must not blank the page; fall back to the default rate.
      console.error("[getStreamRate]", error.message);
      return { ratePer1000: 1 };
    }
    return { ratePer1000: Number(data?.stream_rate_per_1000 ?? 1) };
  });

export const setStreamRate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ ratePer1000: z.number().min(0).max(10000) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertAdmin } = await import("./guards.server");
    await assertAdmin(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("app_settings")
      .upsert({ id: true, stream_rate_per_1000: data.ratePer1000 }, { onConflict: "id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listUnmatchedStreams = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { assertAdmin } = await import("./guards.server");
    await assertAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("unmatched_streams")
      .select("id, stream_date, apple_identifier, container_name, storefront_name, streams")
      .eq("resolved", false)
      .order("stream_date", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/** Assigns unmatched streaming lines to a catalog item (all lines sharing the Apple Identifier by default). */
export const assignUnmatchedStream = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        unmatchedId: z.string().uuid(),
        itemId: z.string().uuid(),
        applyToAll: z.boolean().default(true),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertAdmin } = await import("./guards.server");
    await assertAdmin(context.supabase, context.userId);

    const { data: seed, error: rowError } = await context.supabase
      .from("unmatched_streams")
      .select("*")
      .eq("id", data.unmatchedId)
      .single();
    if (rowError) throw new Error(rowError.message);

    const { data: item, error: itemError } = await context.supabase
      .from("items")
      .select("id, sublabel_id, apple_id")
      .eq("id", data.itemId)
      .single();
    if (itemError) throw new Error(itemError.message);

    // Remember Apple's numeric identifier so future report lines match automatically.
    if (!item.apple_id && seed.apple_identifier) {
      await context.supabase
        .from("items")
        .update({ apple_id: seed.apple_identifier })
        .eq("id", item.id);
    }

    let rows = [seed];
    if (data.applyToAll && seed.apple_identifier) {
      const { data: siblings, error } = await context.supabase
        .from("unmatched_streams")
        .select("*")
        .eq("resolved", false)
        .eq("apple_identifier", seed.apple_identifier);
      if (error) throw new Error(error.message);
      if (siblings?.length) rows = siblings;
    }

    const { error: insertError } = await context.supabase.from("streams").insert(
      rows.map(({ id: _id, resolved: _resolved, created_at: _createdAt, ...rest }) => ({
        ...rest,
        item_id: item.id,
        sublabel_id: item.sublabel_id,
      })),
    );
    if (insertError) throw new Error(insertError.message);

    const { error: updateError } = await context.supabase
      .from("unmatched_streams")
      .update({ resolved: true })
      .in(
        "id",
        rows.map((r) => r.id),
      );
    if (updateError) throw new Error(updateError.message);
    return { ok: true, count: rows.length };
  });

/** Creates a catalog item from an unmatched sale or stream line, then assigns every
 *  unresolved line sharing the same identifier to it. */
export const createItemFromUnmatched = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        kind: z.enum(["sale", "stream"]),
        unmatchedId: z.string().uuid(),
        sublabelId: z.string().uuid(),
        title: z.string().trim().min(1).max(300),
        artistName: z.string().trim().max(300).optional(),
        itemType: z.enum(["ringtone", "single", "album", "other"]).default("single"),
        isrc: z.string().trim().max(40).optional(),
        upc: z.string().trim().max(40).optional(),
        appleId: z.string().trim().max(40).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertAdmin } = await import("./guards.server");
    await assertAdmin(context.supabase, context.userId);

    const { data: item, error } = await context.supabase
      .from("items")
      .insert({
        sublabel_id: data.sublabelId,
        title: data.title,
        artist_name: data.artistName || null,
        item_type: data.itemType,
        isrc: data.isrc ? data.isrc.toUpperCase() : null,
        upc: data.upc ? data.upc.toUpperCase() : null,
        apple_id: data.appleId || null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true as const, itemId: item.id };
  });

