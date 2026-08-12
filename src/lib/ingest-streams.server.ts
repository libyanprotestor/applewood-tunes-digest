import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchStreamsReport, parseStreamsReport, ReportNotReadyError } from "./reporter.server";

export interface StreamIngestResult {
  reportDate: string;
  status: "success" | "not_ready" | "failed";
  rowsParsed: number;
  rowsMatched: number;
  rowsUnmatched: number;
  streams: number;
  error?: string;
}

function compact(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

/**
 * Fetches Apple's daily Music (streaming) detailed report, matches each line to a
 * catalog item by Apple Identifier (ISRC or UPC) and stores the stream counts.
 * Re-running the same date replaces the previous rows.
 */
export async function ingestStreams(reportDate: string, db?: SupabaseClient): Promise<StreamIngestResult> {
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
        kind: "streams",
        status: "pending",
        started_at: new Date().toISOString(),
      },
      { onConflict: "report_date,kind" },
    )
    .select("id, retry_count")
    .single();

  const runId = runRow?.id as string | undefined;

  const finish = async (result: Omit<StreamIngestResult, "reportDate">) => {
    if (runId) {
      await supabaseAdmin
        .from("report_runs")
        .update({
          status: result.status,
          rows_parsed: result.rowsParsed,
          rows_matched: result.rowsMatched,
          rows_unmatched: result.rowsUnmatched,
          revenue_usd: 0,
          error_message: result.error ?? null,
          retry_count:
            result.status === "success"
              ? (runRow?.retry_count ?? 0)
              : (runRow?.retry_count ?? 0) + 1,
          finished_at: new Date().toISOString(),
        })
        .eq("id", runId);
    }
    return { reportDate, ...result };
  };

  try {
    const text = await fetchStreamsReport(compactDate);
    const rows = parseStreamsReport(text, reportDate);

    if (runId) {
      await supabaseAdmin.from("streams").delete().eq("report_run_id", runId);
      await supabaseAdmin.from("unmatched_streams").delete().eq("report_run_id", runId);
    }

    const { data: items } = await supabaseAdmin.from("items").select("id, sublabel_id, isrc, upc");
    const byCode = new Map<string, { id: string; sublabel_id: string }>();
    for (const item of items ?? []) {
      if (item.isrc) byCode.set(compact(item.isrc), { id: item.id, sublabel_id: item.sublabel_id });
      if (item.upc) byCode.set(compact(item.upc), { id: item.id, sublabel_id: item.sublabel_id });
    }

    const matched: Record<string, unknown>[] = [];
    const unmatched: Record<string, unknown>[] = [];
    let totalStreams = 0;

    for (const row of rows) {
      totalStreams += row.streams;
      const shared = {
        stream_date: row.streamDate,
        ingest_date: row.ingestDate,
        apple_identifier: row.appleIdentifier || null,
        storefront_name: row.storefrontName || null,
        time_bucket: row.timeBucket || null,
        subscription_type: row.subscriptionType || null,
        subscription_mode: row.subscriptionMode || null,
        channel_partner: row.channelPartner || null,
        device_type: row.deviceType || null,
        source_of_stream: row.sourceOfStream || null,
        container_type: row.containerType || null,
        container_sub_type: row.containerSubType || null,
        container_id: row.containerId || null,
        container_name: row.containerName || null,
        end_reason_type: row.endReasonType || null,
        offline: row.offline || null,
        audio_format: row.audioFormat || null,
        streams: row.streams,
        report_run_id: runId ?? null,
      };

      const match = row.appleIdentifier ? byCode.get(compact(row.appleIdentifier)) : undefined;
      if (match) matched.push({ ...shared, item_id: match.id, sublabel_id: match.sublabel_id });
      else unmatched.push(shared);
    }

    for (let i = 0; i < matched.length; i += 500) {
      const { error } = await supabaseAdmin.from("streams").insert(matched.slice(i, i + 500) as never);
      if (error) throw new Error(error.message);
    }
    for (let i = 0; i < unmatched.length; i += 500) {
      const { error } = await supabaseAdmin
        .from("unmatched_streams")
        .insert(unmatched.slice(i, i + 500) as never);
      if (error) throw new Error(error.message);
    }

    return finish({
      status: "success",
      rowsParsed: rows.length,
      rowsMatched: matched.length,
      rowsUnmatched: unmatched.length,
      streams: totalStreams,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return finish({
      status: error instanceof ReportNotReadyError ? "not_ready" : "failed",
      rowsParsed: 0,
      rowsMatched: 0,
      rowsUnmatched: 0,
      streams: 0,
      error: message,
    });
  }
}
