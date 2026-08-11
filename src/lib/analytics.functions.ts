import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Who is signed in and what they may see. */
export const getViewer = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getViewerScope } = await import("./guards.server");
    const scope = await getViewerScope(context.supabase, context.userId);
    let sublabelName: string | null = null;
    if (scope.sublabelId) {
      const { data } = await context.supabase
        .from("sublabels")
        .select("name")
        .eq("id", scope.sublabelId)
        .maybeSingle();
      sublabelName = data?.name ?? null;
    }
    return { ...scope, sublabelName };
  });

const rangeSchema = z.object({
  from: z.string(),
  to: z.string(),
  bucket: z.enum(["day", "week", "month", "year"]),
  sublabelId: z.string().uuid().nullable().optional(),
});

/** Time-bucketed units + USD revenue. Row access is enforced by database rules. */
export const getSalesSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => rangeSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { getViewerScope } = await import("./guards.server");
    const scope = await getViewerScope(context.supabase, context.userId);
    const sublabel = scope.isAdmin ? (data.sublabelId ?? null) : scope.sublabelId;

    const args = {
      _from: data.from,
      _to: data.to,
      _bucket: data.bucket,
      ...(sublabel ? { _sublabel: sublabel } : {}),
    };
    const { data: rows, error } = await context.supabase.rpc("sales_summary", args);
    if (error) throw new Error(error.message);
    return (rows ?? []) as { bucket: string; units: number; revenue_usd: number }[];
  });

/** Top items and (for admins) top sublabels in a period. */
export const getBreakdown = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    rangeSchema.omit({ bucket: true }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { getViewerScope } = await import("./guards.server");
    const scope = await getViewerScope(context.supabase, context.userId);
    const sublabel = scope.isAdmin ? (data.sublabelId ?? null) : scope.sublabelId;

    let query = context.supabase
      .from("sales")
      .select("units, revenue_usd, sublabel_id, item_id, items(title, artist_name, item_type), sublabels(name)")
      .gte("sale_date", data.from)
      .lte("sale_date", data.to)
      .limit(5000);
    if (sublabel) query = query.eq("sublabel_id", sublabel);

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);

    const items = new Map<string, { title: string; artist: string; type: string; units: number; revenue: number }>();
    const labels = new Map<string, { name: string; units: number; revenue: number }>();
    const types = new Map<string, { units: number; revenue: number }>();
    let totalUnits = 0;
    let totalRevenue = 0;

    for (const row of (rows ?? []) as never[]) {
      const r = row as unknown as {
        units: number;
        revenue_usd: number;
        item_id: string;
        sublabel_id: string;
        items: { title: string; artist_name: string | null; item_type: string } | null;
        sublabels: { name: string } | null;
      };
      totalUnits += r.units;
      totalRevenue += Number(r.revenue_usd);

      const item = items.get(r.item_id) ?? {
        title: r.items?.title ?? "Unknown",
        artist: r.items?.artist_name ?? "",
        type: r.items?.item_type ?? "other",
        units: 0,
        revenue: 0,
      };
      item.units += r.units;
      item.revenue += Number(r.revenue_usd);
      items.set(r.item_id, item);

      const label = labels.get(r.sublabel_id) ?? { name: r.sublabels?.name ?? "Unknown", units: 0, revenue: 0 };
      label.units += r.units;
      label.revenue += Number(r.revenue_usd);
      labels.set(r.sublabel_id, label);

      const key = r.items?.item_type ?? "other";
      const t = types.get(key) ?? { units: 0, revenue: 0 };
      t.units += r.units;
      t.revenue += Number(r.revenue_usd);
      types.set(key, t);
    }

    const sortByRevenue = <T extends { revenue: number }>(a: T, b: T) => b.revenue - a.revenue;

    return {
      totalUnits,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      topItems: [...items.values()].sort(sortByRevenue).slice(0, 10),
      topSublabels: scope.isAdmin ? [...labels.values()].sort(sortByRevenue).slice(0, 10) : [],
      byType: [...types.entries()].map(([type, v]) => ({ type, ...v })).sort(sortByRevenue),
    };
  });

/** Time-bucketed stream counts + revenue at the configured rate per 1000 streams. */
export const getStreamsSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => rangeSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { getViewerScope } = await import("./guards.server");
    const scope = await getViewerScope(context.supabase, context.userId);
    const sublabel = scope.isAdmin ? (data.sublabelId ?? null) : scope.sublabelId;

    const args = {
      _from: data.from,
      _to: data.to,
      _bucket: data.bucket,
      ...(sublabel ? { _sublabel: sublabel } : {}),
    };
    const { data: rows, error } = await context.supabase.rpc("streams_summary", args);
    if (error) throw new Error(error.message);
    return (rows ?? []) as { bucket: string; streams: number; revenue_usd: number }[];
  });

/** Total streams, revenue and top streamed items in a period. */
export const getStreamsBreakdown = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => rangeSchema.omit({ bucket: true }).parse(input))
  .handler(async ({ data, context }) => {
    const { getViewerScope } = await import("./guards.server");
    const scope = await getViewerScope(context.supabase, context.userId);
    const sublabel = scope.isAdmin ? (data.sublabelId ?? null) : scope.sublabelId;

    const { data: setting } = await context.supabase
      .from("app_settings")
      .select("stream_rate_per_1000")
      .limit(1)
      .maybeSingle();
    const ratePer1000 = Number(setting?.stream_rate_per_1000 ?? 1);

    let query = context.supabase
      .from("streams")
      .select("streams, sublabel_id, item_id, items(title, artist_name, item_type), sublabels(name)")
      .gte("stream_date", data.from)
      .lte("stream_date", data.to)
      .limit(5000);
    if (sublabel) query = query.eq("sublabel_id", sublabel);

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);

    const items = new Map<string, { title: string; artist: string; streams: number }>();
    const labels = new Map<string, { name: string; streams: number }>();
    let totalStreams = 0;

    for (const row of (rows ?? []) as never[]) {
      const r = row as unknown as {
        streams: number;
        item_id: string;
        sublabel_id: string;
        items: { title: string; artist_name: string | null } | null;
        sublabels: { name: string } | null;
      };
      totalStreams += r.streams;

      const item = items.get(r.item_id) ?? {
        title: r.items?.title ?? "Unknown",
        artist: r.items?.artist_name ?? "",
        streams: 0,
      };
      item.streams += r.streams;
      items.set(r.item_id, item);

      const label = labels.get(r.sublabel_id) ?? { name: r.sublabels?.name ?? "Unknown", streams: 0 };
      label.streams += r.streams;
      labels.set(r.sublabel_id, label);
    }

    const revenue = (streams: number) => Math.round((streams * ratePer1000) / 1000 * 100) / 100;

    return {
      ratePer1000,
      totalStreams,
      totalRevenue: revenue(totalStreams),
      topItems: [...items.values()]
        .sort((a, b) => b.streams - a.streams)
        .slice(0, 10)
        .map((i) => ({ ...i, revenue: revenue(i.streams) })),
      topSublabels: scope.isAdmin
        ? [...labels.values()]
            .sort((a, b) => b.streams - a.streams)
            .slice(0, 10)
            .map((l) => ({ ...l, revenue: revenue(l.streams) }))
        : [],
    };
  });
