/**
 * Backblaze B2 (S3-compatible) access: SigV4 signing, presigned URLs and
 * multipart upload orchestration. Server-only — never import from the client.
 */

const enc = new TextEncoder();

function config() {
  const keyId = process.env["B2_KEY_ID"];
  const appKey = process.env["B2_APPLICATION_KEY"];
  const bucket = process.env["B2_BUCKET"];
  const endpoint = process.env["B2_ENDPOINT"];
  if (!keyId || !appKey || !bucket || !endpoint) {
    const missing = [
      !keyId && "B2_KEY_ID",
      !appKey && "B2_APPLICATION_KEY",
      !bucket && "B2_BUCKET",
      !endpoint && "B2_ENDPOINT",
    ].filter(Boolean);
    throw new Error(`Missing storage configuration: ${missing.join(", ")}`);
  }
  const url = new URL(endpoint);
  // s3.us-west-004.backblazeb2.com -> us-west-004
  const region = url.hostname.split(".")[1] ?? "us-west-004";
  return { keyId, appKey, bucket, host: url.host, origin: url.origin, region };
}

async function hmac(key: ArrayBuffer | Uint8Array, data: string) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, enc.encode(data));
}

function hex(buf: ArrayBuffer) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(data: string) {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(data)));
}

function amzDate(d = new Date()) {
  const iso = d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return { long: iso, short: iso.slice(0, 8) };
}

function encodeKey(key: string) {
  return key
    .split("/")
    .map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join("/");
}

async function signingKey(short: string) {
  const { appKey, region } = config();
  const kDate = await hmac(enc.encode(`AWS4${appKey}`), short);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, "s3");
  return hmac(kService, "aws4_request");
}

function canonicalQuery(params: Record<string, string>) {
  return Object.keys(params)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k]!)}`)
    .join("&");
}

/** Presigned URL (query-string auth) for a single request. */
export async function presign(
  method: "GET" | "PUT" | "HEAD" | "DELETE",
  key: string,
  opts: { expiresIn?: number; query?: Record<string, string> } = {},
) {
  const { keyId, bucket, host, origin, region } = config();
  const { long, short } = amzDate();
  const expires = String(opts.expiresIn ?? 3600);
  const credential = `${keyId}/${short}/${region}/s3/aws4_request`;
  const query: Record<string, string> = {
    ...(opts.query ?? {}),
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": credential,
    "X-Amz-Date": long,
    "X-Amz-Expires": expires,
    "X-Amz-SignedHeaders": "host",
  };
  const path = `/${bucket}/${encodeKey(key)}`;
  const cq = canonicalQuery(query);
  const canonical = [method, path, cq, `host:${host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    long,
    `${short}/${region}/s3/aws4_request`,
    await sha256Hex(canonical),
  ].join("\n");
  const signature = hex(await hmac(await signingKey(short), stringToSign));
  return `${origin}${path}?${cq}&X-Amz-Signature=${signature}`;
}

/** Signed request executed from the server (header auth). */
async function signedFetch(
  method: string,
  key: string,
  opts: { query?: Record<string, string>; body?: string; contentType?: string } = {},
) {
  const { keyId, bucket, host, origin, region } = config();
  const { long, short } = amzDate();
  const body = opts.body ?? "";
  const payloadHash = await sha256Hex(body);
  const path = `/${bucket}/${encodeKey(key)}`;
  const cq = canonicalQuery(opts.query ?? {});
  const headers: Record<string, string> = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": long,
  };
  if (opts.contentType) headers["content-type"] = opts.contentType;
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n]}\n`).join("");
  const signedHeaders = names.join(";");
  const canonical = [method, path, cq, canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    long,
    `${short}/${region}/s3/aws4_request`,
    await sha256Hex(canonical),
  ].join("\n");
  const signature = hex(await hmac(await signingKey(short), stringToSign));
  const auth = `AWS4-HMAC-SHA256 Credential=${keyId}/${short}/${region}/s3/aws4_request, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(`${origin}${path}${cq ? `?${cq}` : ""}`, {
    method,
    headers: { ...headers, Authorization: auth },
    body: body || undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Storage ${method} failed [${res.status}]: ${text.slice(0, 500)}`);
  return text;
}

function xmlValue(xml: string, tag: string) {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m?.[1] ?? null;
}

export async function createMultipartUpload(key: string, contentType: string) {
  const xml = await signedFetch("POST", key, { query: { uploads: "" }, contentType });
  const uploadId = xmlValue(xml, "UploadId");
  if (!uploadId) throw new Error("Storage did not return an upload id");
  return uploadId;
}

export async function presignParts(key: string, uploadId: string, partCount: number) {
  const urls: string[] = [];
  for (let i = 1; i <= partCount; i++) {
    urls.push(
      await presign("PUT", key, {
        expiresIn: 6 * 3600,
        query: { partNumber: String(i), uploadId },
      }),
    );
  }
  return urls;
}

export async function completeMultipartUpload(
  key: string,
  uploadId: string,
  parts: { partNumber: number; etag: string }[],
) {
  const body =
    "<CompleteMultipartUpload>" +
    parts
      .slice()
      .sort((a, b) => a.partNumber - b.partNumber)
      .map(
        (p) =>
          `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${p.etag.replace(/"/g, "&quot;")}</ETag></Part>`,
      )
      .join("") +
    "</CompleteMultipartUpload>";
  await signedFetch("POST", key, { query: { uploadId }, body, contentType: "application/xml" });
}

export async function abortMultipartUpload(key: string, uploadId: string) {
  await signedFetch("DELETE", key, { query: { uploadId } });
}

export async function deleteObject(key: string) {
  await signedFetch("DELETE", key);
}

/** Short-lived link the browser can use to preview artwork or stream audio. */
export function previewUrl(key: string, expiresIn = 900) {
  return presign("GET", key, { expiresIn });
}

export function uploadUrl(key: string, expiresIn = 6 * 3600) {
  return presign("PUT", key, { expiresIn });
}

export function storageConfigured() {
  try {
    config();
    return true;
  } catch {
    return false;
  }
}
