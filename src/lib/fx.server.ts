/**
 * Currency conversion to USD for the report date, so historical figures stay stable.
 *
 * Two free sources, no API key:
 *  1. Frankfurter (ECB) — accurate but only ~30 currencies (no AED, TWD, …).
 *  2. @fawazahmed0/currency-api on jsDelivr — daily historical rates for
 *     virtually every currency; used for anything ECB does not publish.
 */

type RateMap = Map<string, number>;

const cache = new Map<string, RateMap>();

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch (error) {
    console.error("[fx] request failed", url, error);
    return null;
  }
}

async function loadRatesForDate(date: string): Promise<RateMap> {
  const cached = cache.get(date);
  if (cached) return cached;

  // units of <currency> per 1 USD
  const map: RateMap = new Map([["USD", 1]]);

  const ecb = (await fetchJson(`https://api.frankfurter.dev/v1/${date}?base=USD`)) as
    | { rates?: Record<string, number> }
    | null;
  for (const [cur, rate] of Object.entries(ecb?.rates ?? {})) {
    if (rate > 0) map.set(cur.toUpperCase(), rate);
  }

  const wide =
    ((await fetchJson(
      `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${date}/v1/currencies/usd.json`,
    )) as { usd?: Record<string, number> } | null) ??
    ((await fetchJson(
      "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json",
    )) as { usd?: Record<string, number> } | null);
  for (const [cur, rate] of Object.entries(wide?.usd ?? {})) {
    const code = cur.toUpperCase();
    if (rate > 0 && !map.has(code)) map.set(code, rate);
  }

  cache.set(date, map);
  return map;
}

/** Converts an amount in `currency` to USD using the rate for `date`. */
export async function toUsd(amount: number, currency: string, date: string): Promise<number> {
  const cur = (currency || "USD").toUpperCase();
  if (cur === "USD" || !amount) return amount;
  const rates = await loadRatesForDate(date);
  const perUsd = rates.get(cur);
  if (!perUsd) {
    console.warn(`[fx] no rate for ${cur} on ${date}; keeping nominal amount`);
    return amount;
  }
  return amount / perUsd;
}

/** Pre-warms the rate table for a date so a batch of conversions makes one request. */
export async function warmRates(date: string): Promise<void> {
  await loadRatesForDate(date);
}
