import { gunzipSync } from "node:zlib";

export const REPORTER_SALES_ENDPOINT =
  "https://reportingitc-reporter.apple.com/reportservice/sales/v1";


export interface ReportRow {
  title: string;
  artistName: string;
  isrc: string;
  upc: string;
  units: number;
  price: number;
  currency: string;
  countryCode: string;
  productTypeId: string;
  saleDate: string;
}

export class ReportNotReadyError extends Error {}

function credentials() {
  const accessToken = process.env["APPLE_REPORTER_ACCESS_TOKEN"];
  const vendorId = process.env["APPLE_VENDOR_ID"];
  if (!accessToken || !vendorId) {
    throw new Error(
      "Apple Reporter is not configured yet. Add APPLE_REPORTER_ACCESS_TOKEN and APPLE_VENDOR_ID.",
    );
  }
  return { accessToken, vendorId };
}

/** Fetches and decompresses the Music Detailed daily report for a date (YYYYMMDD). */
export async function fetchDailyReport(dateYYYYMMDD: string): Promise<string> {
  const { accessToken, vendorId } = credentials();
  const jsonRequest = {
    accesstoken: accessToken,
    version: "2.2",
    mode: "Robot.XML",
    queryInput: `[p=Reporter.properties, Sales.getReport, ${vendorId},Sales,Detailed,Daily,${dateYYYYMMDD},1_3]`,
  };

  const res = await fetch(REPORTER_SALES_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "*/*",
    },
    body: `jsonRequest=${encodeURIComponent(JSON.stringify(jsonRequest))}`,
  });

  const buffer = Buffer.from(await res.arrayBuffer());
  const isGzip = buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;

  if (!isGzip) {
    const text = buffer.toString("utf8");
    const codeMatch = text.match(/<Code>(\d+)<\/Code>/);
    const msgMatch = text.match(/<Message>([^<]*)<\/Message>/);
    const code = codeMatch?.[1];
    const message = msgMatch?.[1] ?? text.slice(0, 300);
    // 213 = no reports available for that date yet.
    if (code === "213" || /not available|no reports/i.test(message)) {
      throw new ReportNotReadyError(message);
    }
    throw new Error(`Apple Reporter error (${res.status}${code ? `/${code}` : ""}): ${message}`);
  }

  return gunzipSync(buffer).toString("utf8");
}

function num(value: string | undefined): number {
  const n = Number.parseFloat((value ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function pick(header: string[], row: string[], ...names: string[]): string {
  for (const name of names) {
    const idx = header.findIndex((h) => h === name.toLowerCase());
    if (idx >= 0) return (row[idx] ?? "").trim();
  }
  return "";
}

function normalizeDate(value: string, fallback: string): string {
  const v = value.trim();
  let m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1]}-${m[2]}`;
  m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return v;
  m = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return fallback;
}

/** Parses the tab-separated Reporter text into normalized rows. */
export function parseReport(text: string, fallbackDate: string): ReportRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const header = lines[0]!.split("\t").map((h) => h.trim().toLowerCase());

  const rows: ReportRow[] = [];
  for (const line of lines.slice(1)) {
    const cols = line.split("\t");
    if (cols.length < 3) continue;

    const units = num(pick(header, cols, "units", "quantity"));
    if (!units) continue;

    const price = num(
      pick(header, cols, "royalty price", "customer price", "extended partner share", "partner share"),
    );
    const currency =
      pick(header, cols, "royalty currency", "customer currency", "partner share currency") || "USD";

    rows.push({
      title: pick(header, cols, "title", "item title", "song/album") || "",
      artistName: pick(header, cols, "artist/show", "artist", "artist/show/developer/author") || "",
      isrc: pick(header, cols, "isrc", "isrc/isbn").toUpperCase(),
      upc: pick(header, cols, "upc", "vendor identifier", "grid").toUpperCase(),
      units,
      price,
      currency: currency.toUpperCase().slice(0, 3),
      countryCode: pick(header, cols, "country code", "country of sale", "storefront").toUpperCase(),
      productTypeId: pick(header, cols, "product type identifier", "product type id"),
      saleDate: normalizeDate(pick(header, cols, "begin date", "start date"), fallbackDate),
    });
  }
  return rows;
}
