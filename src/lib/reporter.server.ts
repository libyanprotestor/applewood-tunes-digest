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

/* --------------------------- Apple Music streams ---------------------------- */

export interface StreamRow {
  streamDate: string;
  ingestDate: string | null;
  appleIdentifier: string;
  storefrontName: string;
  timeBucket: string;
  subscriptionType: string;
  subscriptionMode: string;
  channelPartner: string;
  deviceType: string;
  sourceOfStream: string;
  containerType: string;
  containerSubType: string;
  containerId: string;
  containerName: string;
  endReasonType: string;
  offline: string;
  audioFormat: string;
  streams: number;
}

/**
 * Apple Music streaming detail report:
 * Sales.getReport <vendor>, amStreams, Detailed, Daily, YYYYMMDD, 1_0
 */
export async function fetchStreamsReport(dateYYYYMMDD: string): Promise<string> {
  const { accessToken, vendorId } = credentials();
  const jsonRequest = {
    accesstoken: accessToken,
    version: "2.2",
    mode: "Robot.XML",
    queryInput: `[p=Reporter.properties, Sales.getReport, ${vendorId},amStreams,Summary,Daily,${dateYYYYMMDD},1_2]`,
  };

  const res = await fetch(REPORTER_SALES_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "*/*" },
    body: `jsonRequest=${encodeURIComponent(JSON.stringify(jsonRequest))}`,
  });

  const buffer = Buffer.from(await res.arrayBuffer());
  const isGzip = buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
  if (!isGzip) {
    const text = buffer.toString("utf8");
    const code = text.match(/<Code>(\d+)<\/Code>/)?.[1];
    const message = text.match(/<Message>([^<]*)<\/Message>/)?.[1] ?? text.slice(0, 300);
    if (code === "213" || /not available|no reports/i.test(message)) {
      throw new ReportNotReadyError(message);
    }
    throw new Error(`Apple Reporter error (${res.status}${code ? `/${code}` : ""}): ${message}`);
  }
  return gunzipSync(buffer).toString("utf8");
}

/** Parses the tab-separated Apple Music streaming report. */
export function parseStreamsReport(text: string, fallbackDate: string): StreamRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const header = lines[0]!.split("\t").map((h) => h.trim().toLowerCase());

  const rows: StreamRow[] = [];
  for (const line of lines.slice(1)) {
    const cols = line.split("\t");
    if (cols.length < 3) continue;

    const streams = num(pick(header, cols, "streams", "quantity", "units"));
    if (!streams) continue;

    const ingest = pick(header, cols, "ingest datestamp");

    rows.push({
      streamDate: normalizeDate(pick(header, cols, "datestamp", "begin date"), fallbackDate),
      ingestDate: ingest ? normalizeDate(ingest, fallbackDate) : null,
      appleIdentifier: pick(header, cols, "apple identifier", "isrc", "upc").toUpperCase(),
      storefrontName: pick(header, cols, "storefront name", "storefront"),
      timeBucket: pick(header, cols, "time bucket"),
      subscriptionType: pick(header, cols, "subscription type"),
      subscriptionMode: pick(header, cols, "subscription mode"),
      channelPartner: pick(header, cols, "channel partner"),
      deviceType: pick(header, cols, "device type"),
      sourceOfStream: pick(header, cols, "source of stream"),
      containerType: pick(header, cols, "container type"),
      containerSubType: pick(header, cols, "container sub-type", "container subtype"),
      containerId: pick(header, cols, "container id"),
      containerName: pick(header, cols, "container name"),
      endReasonType: pick(header, cols, "end reason type"),
      offline: pick(header, cols, "offline"),
      audioFormat: pick(header, cols, "audio format"),
      streams,
    });
  }
  return rows;
}
