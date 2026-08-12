import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchDailyReport, parseReport, ReportNotReadyError } from "./reporter.server";
import { toUsd, warmRates } from "./fx.server";

export interface IngestResult {
  reportDate: string;
  status: "success" | "not_ready" | "failed";
  rowsParsed: number;
  rowsMatched: number;
  rowsUnmatched: number;
  revenueUsd: number;
  error?: string;
}

function compact(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

/**
 * Fetches Apple's daily Music Detailed report for every territory in one call,
 * converts revenue to USD, and stores matched / unmatched sales.
 * Re-running the same date replaces the previous rows.
 */
export async function ingestReport(reportDate: string, db?: SupabaseClient): Promise<IngestResult> {
  // Use the caller's client when provided (e.g. an authenticated admin), so the
  // service-role key is only required for unattended/cron runs.
  const supabaseAdmin: SupabaseClient =
    db ?? (await import("@/integrations/supabase/client.server")).supabaseAdmin;
  const compactDate = reportDate.replace(/-/g, "");

  const { data: runRow } = await supabaseAdmin
    .from("report_runs")
    .upsert(
      {
        report_date: reportDate,
        kind: "sales",
        status: "pending",
        started_at: new Date().toISOString(),
      },
      { onConflict: "report_date,kind" },
    )
    .select("id, retry_count")
    .single();


  const runId = runRow?.id as string | undefined;

  const finish = async (result: Omit<IngestResult, "reportDate">) => {
    if (runId) {
      await supabaseAdmin
        .from("report_runs")
        .update({
          status: result.status,
          rows_parsed: result.rowsParsed,
          rows_matched: result.rowsMatched,
          rows_unmatched: result.rowsUnmatched,
          revenue_usd: result.revenueUsd,
          error_message: result.error ?? null,
          retry_count:
            result.status === "success" ? (runRow?.retry_count ?? 0) : (runRow?.retry_count ?? 0) + 1,
          finished_at: new Date().toISOString(),
        })
        .eq("id", runId);
    }
    return { reportDate, ...result };
  };

  try {
    const text = await fetchDailyReport(compactDate);
    const rows = parseReport(text, reportDate);

    // Clear any previous ingest for this date so re-runs never duplicate.
    if (runId) {
      await supabaseAdmin.from("sales").delete().eq("report_run_id", runId);
      await supabaseAdmin.from("unmatched_sales").delete().eq("report_run_id", runId);
    }

    const { data: items } = await supabaseAdmin.from("items").select("id, sublabel_id, isrc, upc");
    const byIsrc = new Map<string, { id: string; sublabel_id: string }>();
    const byUpc = new Map<string, { id: string; sublabel_id: string }>();
    for (const item of items ?? []) {
      if (item.isrc) byIsrc.set(compact(item.isrc), { id: item.id, sublabel_id: item.sublabel_id });
      if (item.upc) byUpc.set(compact(item.upc), { id: item.id, sublabel_id: item.sublabel_id });
    }

    await warmRates(reportDate);

    const sales: Record<string, unknown>[] = [];
    const unmatched: Record<string, unknown>[] = [];
    let revenueTotal = 0;

    for (const row of rows) {
      const gross = row.units * row.price;
      const usd = Math.round((await toUsd(gross, row.currency, row.saleDate)) * 10000) / 10000;
      const match =
        (row.isrc ? byIsrc.get(compact(row.isrc)) : undefined) ??
        (row.upc ? byUpc.get(compact(row.upc)) : undefined);

      if (match) {
        revenueTotal += usd;
        sales.push({
          item_id: match.id,
          sublabel_id: match.sublabel_id,
          sale_date: row.saleDate,
          country_code: row.countryCode || null,
          units: row.units,
          original_currency: row.currency,
          revenue_usd: usd,
          product_type_id: row.productTypeId || null,
          report_run_id: runId ?? null,
        });
      } else {
        unmatched.push({
          report_run_id: runId ?? null,
          sale_date: row.saleDate,
          country_code: row.countryCode || null,
          title: row.title || null,
          artist_name: row.artistName || null,
          isrc: row.isrc || null,
          upc: row.upc || null,
          units: row.units,
          original_currency: row.currency,
          revenue_usd: usd,
          product_type_id: row.productTypeId || null,
        });
      }
    }

    for (let i = 0; i < sales.length; i += 500) {
      const { error } = await supabaseAdmin.from("sales").insert(sales.slice(i, i + 500) as never);
      if (error) throw new Error(error.message);
    }
    for (let i = 0; i < unmatched.length; i += 500) {
      const { error } = await supabaseAdmin
        .from("unmatched_sales")
        .insert(unmatched.slice(i, i + 500) as never);
      if (error) throw new Error(error.message);
    }

    return finish({
      status: "success",
      rowsParsed: rows.length,
      rowsMatched: sales.length,
      rowsUnmatched: unmatched.length,
      revenueUsd: Math.round(revenueTotal * 100) / 100,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const notReady = error instanceof ReportNotReadyError;
    return finish({
      status: notReady ? "not_ready" : "failed",
      rowsParsed: 0,
      rowsMatched: 0,
      rowsUnmatched: 0,
      revenueUsd: 0,
      error: message,
    });
  }
}
