import { createFileRoute } from "@tanstack/react-router";

/**
 * Called by the scheduler three times a day, once per Apple release window.
 * Apple publishes daily reports by 5am Pacific (Americas), 5am JST (Japan /
 * Australia / New Zealand) and 5am CET (everywhere else). If the report is not
 * ready the run is marked "not ready" and the next scheduled attempt retries it.
 */
export const Route = createFileRoute("/api/public/hooks/apple-reports")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = request.headers.get("apikey");
        const expected =
          process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["SUPABASE_ANON_KEY"] ?? "";
        if (!expected || apiKey !== expected) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        let body: { region?: string } = {};
        try {
          body = (await request.json()) as { region?: string };
        } catch {
          body = {};
        }

        const region = body.region;
        if (region !== "americas" && region !== "japan_anz" && region !== "europe_other") {
          return new Response(JSON.stringify({ error: "Invalid region" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const { ingestReport } = await import("@/lib/ingest.server");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Yesterday, plus any earlier day in the last week that never succeeded.
        const today = new Date();
        const dates: string[] = [];
        for (let i = 1; i <= 7; i += 1) {
          const d = new Date(today);
          d.setUTCDate(d.getUTCDate() - i);
          dates.push(d.toISOString().slice(0, 10));
        }

        const { data: done } = await supabaseAdmin
          .from("report_runs")
          .select("report_date")
          .eq("region", region)
          .eq("status", "success")
          .in("report_date", dates);
        const succeeded = new Set((done ?? []).map((r) => r.report_date as string));

        const results = [];
        for (const date of dates) {
          if (succeeded.has(date)) continue;
          results.push(await ingestReport(date, region));
        }

        return new Response(JSON.stringify({ region, results }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
