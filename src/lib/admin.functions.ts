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
    const { error } = await context.supabase.from("sublabels").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
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
      .select("id, title, artist_name, isrc, upc, item_type, sublabel_id, sublabels(name)")
      .order("title")
      .limit(500);
    if (data.sublabelId) query = query.eq("sublabel_id", data.sublabelId);
    if (data.search) query = query.or(`title.ilike.%${data.search}%,isrc.ilike.%${data.search}%,upc.ilike.%${data.search}%`);
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

const csvItem = z.object({
  title: z.string().trim().min(1).max(300),
  artistName: z.string().trim().max(300).optional(),
  isrc: z.string().trim().max(40).optional(),
  upc: z.string().trim().max(40).optional(),
  itemType: z.enum(["ringtone", "single", "album", "other"]).default("single"),
});

/** Bulk-imports catalog rows parsed from a CSV in the browser. */
export const importItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ sublabelId: z.string().uuid(), rows: z.array(csvItem).min(1).max(5000) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertAdmin } = await import("./guards.server");
    await assertAdmin(context.supabase, context.userId);

    let inserted = 0;
    const errors: string[] = [];
    for (const row of data.rows) {
      const { error } = await context.supabase.from("items").insert({
        sublabel_id: data.sublabelId,
        title: row.title,
        artist_name: row.artistName || null,
        isrc: row.isrc ? row.isrc.toUpperCase() : null,
        upc: row.upc ? row.upc.toUpperCase() : null,
        item_type: row.itemType,
      });
      if (error) errors.push(`${row.title}: ${error.message}`);
      else inserted += 1;
    }
    return { inserted, skipped: errors.length, errors: errors.slice(0, 25) };
  });

export const deleteItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { assertAdmin } = await import("./guards.server");
    await assertAdmin(context.supabase, context.userId);
    const { error } = await context.supabase.from("items").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
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

/** Assigns an unmatched report line to a catalog item, moving the revenue over. */
export const assignUnmatched = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ unmatchedId: z.string().uuid(), itemId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertAdmin } = await import("./guards.server");
    await assertAdmin(context.supabase, context.userId);

    const { data: row, error: rowError } = await context.supabase
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

    const { error: insertError } = await context.supabase.from("sales").insert({
      item_id: item.id,
      sublabel_id: item.sublabel_id,
      sale_date: row.sale_date,
      country_code: row.country_code,
      units: row.units,
      original_currency: row.original_currency,
      revenue_usd: row.revenue_usd,
      product_type_id: row.product_type_id,
      report_run_id: row.report_run_id,
    });
    if (insertError) throw new Error(insertError.message);

    const { error: updateError } = await context.supabase
      .from("unmatched_sales")
      .update({ resolved: true })
      .eq("id", data.unmatchedId);
    if (updateError) throw new Error(updateError.message);
    return { ok: true };
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

/** Manually pulls a report for a given date and region. */
export const runReportFetch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        region: z.enum(["americas", "japan_anz", "europe_other"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertAdmin } = await import("./guards.server");
    await assertAdmin(context.supabase, context.userId);
    const { ingestReport } = await import("./ingest.server");
    return ingestReport(data.reportDate, data.region);
  });
