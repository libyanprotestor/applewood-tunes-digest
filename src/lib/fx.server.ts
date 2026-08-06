/**
 * Currency conversion to USD using Frankfurter (ECB data, free, no API key).
 * Rates are looked up for the report date so historical figures stay stable.
 */

type RateMap = Map<string, number>;

const cache = new Map<string, RateMap>();

async function loadRatesForDate(date: string): Promise<RateMap> {
  const cached = cache.get(date);
  if (cached) return cached;

  const map: RateMap = new Map([["USD", 1]]);
  try {
    const res = await fetch(`https://api.frankfurter.dev/v1/${date}?base=USD`);
    if (res.ok) {
      const body = (await res.json()) as { rates?: Record<string, number> };
      for (const [cur, rate] of Object.entries(body.rates ?? {})) {
        if (rate > 0) map.set(cur.toUpperCase(), rate);
      }
    }
  } catch (error) {
    console.error("[fx] rate lookup failed", date, error);
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
