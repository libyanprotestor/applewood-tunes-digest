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
import { buildPackages } from "./package-builder.js";

const env = (name, fallback) => {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`Missing environment variable ${name}`);
  return value;
};

// The worker authenticates as a dedicated admin account (email + password) using
// the public anon key. No service-role key is needed or available.
const supabase = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
  auth: { persistSession: false, autoRefreshToken: true },
});

const WORKER_EMAIL = env("WORKER_EMAIL");
const WORKER_PASSWORD = env("WORKER_PASSWORD");

async function signIn() {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: WORKER_EMAIL,
    password: WORKER_PASSWORD,
  });
  if (error) throw new Error(`Worker sign-in failed: ${error.message}`);
  const { data: isAdmin, error: roleError } = await supabase.rpc("has_role", {
    _user_id: data.user.id,
    _role: "admin",
  });
  if (roleError) throw new Error(`Could not verify worker role: ${roleError.message}`);
  if (!isAdmin) throw new Error(`${WORKER_EMAIL} is not an admin account — grant it the admin role first.`);
  console.log(`Signed in as ${WORKER_EMAIL}`);
}


const s3 = new S3Client({
  region: new URL(env("B2_ENDPOINT")).hostname.split(".")[1],
  endpoint: env("B2_ENDPOINT"),
  credentials: { accessKeyId: env("B2_KEY_ID"), secretAccessKey: env("B2_APPLICATION_KEY") },
  forcePathStyle: true,
});
const BUCKET = env("B2_BUCKET");

const WORKER_ID = process.env.WORKER_ID || `worker-${os.hostname()}`;
const POLL_MS = Number(process.env.POLL_INTERVAL_MS || 15000);
// Resolve the Transporter binary once at startup: the explicit path if it
// exists, otherwise anything on PATH, otherwise search the install dir.
let TRANSPORTER = process.env.TRANSPORTER_PATH || "iTMSTransporter";
async function resolveTransporter() {
  const candidates = [
    process.env.TRANSPORTER_PATH,
    "/usr/local/bin/iTMSTransporter",
    "/opt/transporter/itms/bin/iTMSTransporter",
    "/opt/transporter/bin/iTMSTransporter",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      TRANSPORTER = candidate;
      console.log(`Using Transporter at ${TRANSPORTER}`);
      return;
    } catch {
      /* keep looking */
    }
  }
  // Last resort: search the install tree.
  const search = async (dir, depth = 0) => {
    if (depth > 6) return null;
    let entries = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = await search(full, depth + 1);
        if (found) return found;
      } else if (entry.name === "iTMSTransporter") {
        return full;
      }
    }
    return null;
  };
  const found = (await search("/opt/transporter")) || (await search("/usr/local/itms"));
  if (found) {
    TRANSPORTER = found;
    console.log(`Using Transporter at ${TRANSPORTER}`);
  } else {
    console.warn(
      "iTMSTransporter was not found — set TRANSPORTER_PATH in .env or rebuild the image with the Apple installer.",
    );
  }
}
const PROVIDER = env("APPLE_PROVIDER_SHORTNAME");
const APPLE_USER = env("APPLE_TRANSPORTER_USER");
const APPLE_PASSWORD = env("APPLE_TRANSPORTER_PASSWORD");

/**
 * Runs a Supabase call and never lets its error pass silently. Auth failures
 * (expired/revoked token) trigger one re-sign-in and a retry, so a long job
 * cannot keep uploading to Apple while its database writes are being dropped.
 */
async function db(label, op) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await op();
    if (!result?.error) return result;
    const message = result.error.message || String(result.error);
    if (attempt === 0 && /jwt|token|expired|unauthor|permission denied|refresh/i.test(message)) {
      console.error(`${label}: ${message} — signing in again and retrying`);
      await signIn();
      continue;
    }
    throw new Error(`${label} failed: ${message}`);
  }
  return null;
}

async function log(jobId, line, level = "info") {
  const text = String(line).slice(0, 4000);
  console.log(`[${jobId}] ${text}`);
  try {
    await db("log insert", () => supabase.from("delivery_logs").insert({ job_id: jobId, line: text, level }));
  } catch (error) {
    console.error("could not persist log line:", error.message);
  }
}

async function setJob(jobId, patch) {
  await db("delivery_jobs update", () => supabase.from("delivery_jobs").update(patch).eq("id", jobId));
}

async function setUpload(uploadId, patch) {
  await db("uploads update", () => supabase.from("uploads").update(patch).eq("id", uploadId));
}

async function setPackage(jobId, vendorId, patch) {
  await db("delivery_packages update", () =>
    supabase.from("delivery_packages").update(patch).eq("job_id", jobId).eq("vendor_id", vendorId),
  );
}

async function renewLease(jobId) {
  await setJob(jobId, { lease_until: new Date(Date.now() + 3600_000).toISOString() });
}

async function download(key, destination) {
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  await pipeline(res.Body, createWriteStream(destination));
}

/**
 * Runs a command, mirroring its output to stdout only. Nothing is written to the
 * database line by line — on failure the last few lines travel with the error.
 */
function run(command, args, tag = "") {
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
        .forEach((line) => console.log(tag ? `${tag}: ${line}` : line));
    };
    child.stdout.on("data", handle);
    child.stderr.on("data", handle);
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolve(output);
      const tail = output
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && /error|fail|invalid|denied|exception/i.test(l))
        .slice(-5);
      reject(new Error(`${command} exited with code ${code}${tail.length ? ` — ${tail.join(" | ")}` : ""}`));
    });
  });
}

async function isApproved(jobId) {
  const { data } = await supabase
    .from("delivery_jobs")
    .select("approved_for_delivery")
    .eq("id", jobId)
    .single();
  return Boolean(data?.approved_for_delivery);
}

const WORK_ROOT = process.env.WORK_ROOT || path.join(os.tmpdir(), "delivery-work");

/** Packages already built for this job are kept on disk while we wait for approval. */
async function loadBuiltPackages(workDir) {
  try {
    const saved = JSON.parse(await fs.readFile(path.join(workDir, "packages.json"), "utf8"));
    for (const pkg of saved) await fs.access(pkg.dir);
    return saved.length ? saved : null;
  } catch {
    return null;
  }
}

async function processJob(jobId, uploadId) {
  const workDir = path.join(WORK_ROOT, `job-${jobId}`);
  await fs.mkdir(workDir, { recursive: true });
  let paused = false;
  try {
    // Resuming after approval: the packages are still on disk, so skip the
    // download + packaging pass entirely and go straight to the upload.
    const prebuilt = await loadBuiltPackages(workDir);
    if (prebuilt && (await isApproved(jobId))) {
      await log(jobId, "Approved — uploading the packages built earlier.");
      await uploadPackages(jobId, uploadId, prebuilt);
      return;
    }

    await log(jobId, "Claimed job, loading release metadata.");
    const { data: upload, error: uploadError } = await supabase
      .from("uploads")
      .select(
        "id, kind, title, artist_name, upc, release_date, genre_code, language, label_name, copyright_pline, copyright_cline, sublabel_id, sublabels(name)",
      )
      .eq("id", uploadId)
      .single();
    if (uploadError) throw new Error(uploadError.message);
    if (!upload.artist_name) throw new Error("The artist name is required before delivery.");

    const [{ data: tracks }, { data: files }] = await Promise.all([
      supabase
        .from("upload_tracks")
        .select("id, file_id, artwork_file_id, folder_number, track_number, title, version, artist_name, isrc, explicit")
        .eq("upload_id", uploadId)
        .order("track_number"),
      supabase.from("upload_files").select("id, role, filename, storage_key").eq("upload_id", uploadId),
    ]);

    if (!tracks?.length) throw new Error("The metadata sheet is empty.");
    const byId = new Map((files ?? []).map((f) => [f.id, f]));
    const fallbackArtwork = (files ?? []).find((f) => f.role === "artwork") ?? null;

    await setJob(jobId, { state: "packaging" });
    await setUpload(uploadId, { status: "packaging" });

    const audioNames = [];
    const artworkNames = [];
    const downloaded = new Set();
    const fetchOnce = async (file) => {
      if (!downloaded.has(file.filename)) {
        console.log(`[${jobId}] downloading ${file.filename}`);
        await download(file.storage_key, path.join(workDir, file.filename));
        downloaded.add(file.filename);
      }
      return file.filename;
    };

    await log(jobId, `Downloading assets for ${tracks.length} track(s).`);
    for (const track of tracks) {
      const audio = byId.get(track.file_id);
      if (!audio) throw new Error(`Track "${track.title}" has no audio file.`);
      if (!track.isrc) throw new Error(`Track "${track.title}" has no ISRC.`);
      audioNames.push(await fetchOnce(audio));
      const art = track.artwork_file_id ? byId.get(track.artwork_file_id) : fallbackArtwork;
      artworkNames.push(art ? await fetchOnce(art) : null);
      await renewLease(jobId);
    }
    await log(jobId, `${downloaded.size} file(s) downloaded.`);

    const release = {
      kind: upload.kind,
      title: upload.title,
      artist_name: upload.artist_name,
      upc: upload.upc,
      release_date: upload.release_date,
      genre_code: upload.genre_code || (upload.kind === "ringtones" ? "RINGTONES-00" : "POP-00"),
      language: upload.language || "en",
      label_name: upload.label_name || upload.sublabels?.name || PROVIDER,
      copyright_pline: upload.copyright_pline || "",
      copyright_cline: upload.copyright_cline || "",
      provider: PROVIDER,
      vendor_id: upload.upc || tracks[0].isrc,
    };

    await log(jobId, `Building ${upload.kind} package(s).`);
    const packages = await buildPackages(workDir, release, tracks, audioNames, artworkNames);
    await log(jobId, `${packages.length} package(s) ready.`);
    await fs.writeFile(
      path.join(workDir, "packages.json"),
      JSON.stringify(packages.map((p) => ({ dir: p.dir, vendorId: p.vendorId, title: p.title }))),
    );

    // Record what was built so the admin can review the exact package contents.
    for (const pkg of packages) {
      await supabase.from("delivery_packages").upsert(
        {
          upload_id: uploadId,
          job_id: jobId,
          vendor_id: pkg.vendorId,
          title: pkg.title,
          state: "awaiting_approval",
          error_message: null,
          metadata_xml: pkg.xml ?? null,
          manifest: { files: pkg.assets ?? [], folder: `${pkg.vendorId}.itmsp` },
        },
        { onConflict: "job_id,vendor_id" },
      );
    }

    if (!(await isApproved(jobId))) {
      paused = true; // keep the built packages on disk for the approved run
      await setJob(jobId, { state: "awaiting_approval" });
      await setUpload(uploadId, { status: "awaiting_approval" });
      await log(jobId, "Packages built — waiting for admin approval before uploading to Apple.", "success");
      return;
    }

    await uploadPackages(jobId, uploadId, packages);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await log(jobId, `Failed: ${message}`, "error");
    await setJob(jobId, { state: "failed", error_message: message, finished_at: new Date().toISOString() });
    await setUpload(uploadId, { status: "ready" });
  } finally {
    if (!paused) await fs.rm(workDir, { recursive: true, force: true });
  }
}

async function uploadPackages(jobId, uploadId, packages) {
  await setJob(jobId, { state: "uploading" });
  await setUpload(uploadId, { status: "delivering" });

  const failures = [];
  for (const pkg of packages) {
    await supabase
      .from("delivery_packages")
      .update({ state: "uploading", error_message: null })
      .eq("job_id", jobId)
      .eq("vendor_id", pkg.vendorId);
    await renewLease(jobId);
    try {
      const output = await run(
        TRANSPORTER,
        ["-m", "upload", "-u", APPLE_USER, "-p", APPLE_PASSWORD, "-f", pkg.dir, "-k", "100000", "-WONoPause", "true"],
        (line) => void log(jobId, `${pkg.vendorId}: ${line}`),
      );
      const ticket = output.match(/[Tt]ransaction[ _]?[Ii][Dd][:= ]+([\w-]+)/)?.[1] ?? null;
      await supabase
        .from("delivery_packages")
        .update({ state: "succeeded", apple_ticket: ticket, error_message: null })
        .eq("job_id", jobId)
        .eq("vendor_id", pkg.vendorId);
      await log(jobId, `${pkg.vendorId}: accepted by Apple${ticket ? ` (ticket ${ticket})` : ""}.`, "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${pkg.vendorId}: ${message}`);
      await supabase
        .from("delivery_packages")
        .update({ state: "failed", error_message: message })
        .eq("job_id", jobId)
        .eq("vendor_id", pkg.vendorId);
      await log(jobId, `${pkg.vendorId}: rejected — ${message}`, "error");
    }
  }

  if (failures.length) throw new Error(failures.join(" | "));

  await setJob(jobId, {
    state: "succeeded",
    error_message: null,
    finished_at: new Date().toISOString(),
  });
  await setUpload(uploadId, { status: "delivered" });
  await log(jobId, "Delivered to Apple.", "success");
}


/** Makes sure we still hold a valid access token before every poll. */
async function ensureSession() {
  const { data } = await supabase.auth.getSession();
  const session = data?.session;
  const expiresAt = session?.expires_at ? session.expires_at * 1000 : 0;
  if (!session || expiresAt - Date.now() < 60_000) {
    if (session) {
      const { data: refreshed } = await supabase.auth.refreshSession();
      if (refreshed?.session) return;
    }
    await signIn();
  }
}

/**
 * Removes work folders (downloads + built .itmsp packages) for jobs that are no
 * longer waiting for approval — e.g. the admin rejected the packages, or the
 * release was delivered. Only local disk is touched here.
 */
async function sweepWorkDirs() {
  let entries = [];
  try {
    entries = await fs.readdir(WORK_ROOT, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("job-")) continue;
    const jobId = entry.name.slice(4);
    const { data } = await supabase.from("delivery_jobs").select("state").eq("id", jobId).maybeSingle();
    const state = data?.state;
    if (state && ["queued", "claimed", "packaging", "uploading", "awaiting_approval"].includes(state)) continue;
    await fs.rm(path.join(WORK_ROOT, entry.name), { recursive: true, force: true });
    console.log(`Cleaned work folder for job ${jobId} (state ${state ?? "gone"})`);
  }
}

async function tick() {
  await ensureSession();
  await sweepWorkDirs();

  const { data, error } = await supabase.rpc("claim_delivery_job", {
    _worker_id: WORKER_ID,
    _lease_seconds: 3600,
  });
  if (error) {
    // Session expired or was invalidated — sign in again and retry once.
    if (/jwt|token|unauthor|permission denied/i.test(error.message)) {
      console.error("session lost, signing in again:", error.message);
      await signIn();
      return false;
    }
    console.error("claim failed:", error.message);
    return false;
  }
  const job = data?.[0];
  if (!job) return false;
  await processJob(job.job_id, job.upload_id);
  return true;
}


async function main() {
  await resolveTransporter();
  await signIn();
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
