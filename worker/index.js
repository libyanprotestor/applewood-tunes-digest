/**
 * Delivery worker.
 *
 * Claims queued delivery jobs, downloads the release assets from object
 * storage, builds an Apple `.itmsp` package and uploads it with
 * iTMSTransporter. Runs anywhere with Node 20 + Java (see Dockerfile).
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";
import { buildPackage } from "./package-builder.js";

const env = (name, fallback) => {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`Missing environment variable ${name}`);
  return value;
};

const supabase = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});

const s3 = new S3Client({
  region: new URL(env("B2_ENDPOINT")).hostname.split(".")[1],
  endpoint: env("B2_ENDPOINT"),
  credentials: { accessKeyId: env("B2_KEY_ID"), secretAccessKey: env("B2_APPLICATION_KEY") },
  forcePathStyle: true,
});
const BUCKET = env("B2_BUCKET");

const WORKER_ID = process.env.WORKER_ID || `worker-${os.hostname()}`;
const POLL_MS = Number(process.env.POLL_INTERVAL_MS || 15000);
const TRANSPORTER = process.env.TRANSPORTER_PATH || "iTMSTransporter";
const PROVIDER = env("APPLE_PROVIDER_SHORTNAME");
const APPLE_USER = env("APPLE_TRANSPORTER_USER");
const APPLE_PASSWORD = env("APPLE_TRANSPORTER_PASSWORD");

async function log(jobId, line, level = "info") {
  const text = String(line).slice(0, 4000);
  console.log(`[${jobId}] ${text}`);
  await supabase.from("delivery_logs").insert({ job_id: jobId, line: text, level });
}

async function setJob(jobId, patch) {
  await supabase.from("delivery_jobs").update(patch).eq("id", jobId);
}

async function setUpload(uploadId, patch) {
  await supabase.from("uploads").update(patch).eq("id", uploadId);
}

async function renewLease(jobId) {
  await setJob(jobId, { lease_until: new Date(Date.now() + 3600_000).toISOString() });
}

async function download(key, destination) {
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  await pipeline(res.Body, createWriteStream(destination));
}

function run(command, args, onLine) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: { ...process.env } });
    let output = "";
    const handle = (chunk) => {
      const text = chunk.toString();
      output += text;
      text
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .forEach(onLine);
    };
    child.stdout.on("data", handle);
    child.stderr.on("data", handle);
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(output) : reject(new Error(`${command} exited with code ${code}`)),
    );
  });
}

async function processJob(jobId, uploadId) {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "delivery-"));
  try {
    await log(jobId, "Claimed job, loading release metadata.");
    const { data: upload, error: uploadError } = await supabase
      .from("uploads")
      .select("id, kind, title, artist_name, upc, release_date, sublabel_id, sublabels(name)")
      .eq("id", uploadId)
      .single();
    if (uploadError) throw new Error(uploadError.message);

    const [{ data: tracks }, { data: files }] = await Promise.all([
      supabase
        .from("upload_tracks")
        .select("id, file_id, track_number, title, version, artist_name, isrc, explicit")
        .eq("upload_id", uploadId)
        .order("track_number"),
      supabase.from("upload_files").select("id, role, filename, storage_key").eq("upload_id", uploadId),
    ]);

    if (!tracks?.length) throw new Error("The metadata sheet is empty.");
    const byId = new Map((files ?? []).map((f) => [f.id, f]));
    const artworkFile = (files ?? []).find((f) => f.role === "artwork");

    await setJob(jobId, { state: "packaging" });
    await setUpload(uploadId, { status: "packaging" });

    const audioNames = [];
    for (const track of tracks) {
      const file = byId.get(track.file_id);
      if (!file) throw new Error(`Track "${track.title}" has no audio file.`);
      if (!track.isrc) throw new Error(`Track "${track.title}" has no ISRC.`);
      await log(jobId, `Downloading ${file.filename}`);
      await download(file.storage_key, path.join(workDir, file.filename));
      audioNames.push(file.filename);
      await renewLease(jobId);
    }
    if (artworkFile) {
      await log(jobId, `Downloading ${artworkFile.filename}`);
      await download(artworkFile.storage_key, path.join(workDir, artworkFile.filename));
    }

    const release = {
      kind: upload.kind,
      title: upload.title,
      artist_name: upload.artist_name,
      upc: upload.upc,
      release_date: upload.release_date,
      label_name: upload.sublabels?.name ?? PROVIDER,
      provider: PROVIDER,
      vendor_id: tracks[0].isrc,
    };

    await log(jobId, `Building ${upload.kind} package.`);
    const itmsp = await buildPackage(workDir, release, tracks, audioNames, artworkFile?.filename ?? null);
    await log(jobId, `Package ready: ${path.basename(itmsp)}`);

    await setJob(jobId, { state: "uploading" });
    await setUpload(uploadId, { status: "delivering" });
    await renewLease(jobId);

    const transporterOutput = await run(
      TRANSPORTER,
      [
        "-m",
        "upload",
        "-u",
        APPLE_USER,
        "-p",
        APPLE_PASSWORD,
        "-f",
        itmsp,
        "-k",
        "100000",
        "-WONoPause",
        "true",
      ],
      (line) => void log(jobId, line),
    );

    const ticket = transporterOutput.match(/[Tt]ransaction[ _]?[Ii][Dd][:= ]+([\w-]+)/)?.[1] ?? null;
    await setJob(jobId, {
      state: "delivered",
      apple_ticket: ticket,
      error_message: null,
      finished_at: new Date().toISOString(),
    });
    await setUpload(uploadId, { status: "delivered" });
    await log(jobId, "Delivered to Apple.", "success");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await log(jobId, `Failed: ${message}`, "error");
    await setJob(jobId, { state: "failed", error_message: message, finished_at: new Date().toISOString() });
    await setUpload(uploadId, { status: "ready" });
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

async function tick() {
  const { data, error } = await supabase.rpc("claim_delivery_job", {
    _worker_id: WORKER_ID,
    _lease_seconds: 3600,
  });
  if (error) {
    console.error("claim failed:", error.message);
    return false;
  }
  const job = data?.[0];
  if (!job) return false;
  await processJob(job.job_id, job.upload_id);
  return true;
}

async function main() {
  console.log(`${WORKER_ID} polling every ${POLL_MS}ms`);
  for (;;) {
    let worked = false;
    try {
      worked = await tick();
    } catch (error) {
      console.error("worker loop error:", error);
    }
    if (!worked) await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main();
