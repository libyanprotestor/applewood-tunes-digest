# Delivery pipeline: upload → review → package → Apple Transporter

Extends the current sales/streams dashboard with the full release-delivery chain, so sublabels stop using Google Drive and you stop running desktop tools by hand.

## Architecture at a glance

```text
Sublabel browser
   │  direct multipart upload (presigned URLs, never through the app server)
   ▼
Backblaze B2 bucket  ──────────────┐
   │                               │
   │ upload record + metadata      │ worker downloads/uploads
   ▼                               ▼
Lovable Cloud database        VPS worker (Docker: Node + Java + iTMSTransporter)
 (uploads, tracks, ISRC pool,   1. pull next queued job
  delivery_jobs, logs)          2. fetch files from B2
   ▲                            3. build .itmsp package (album/single/ringtone)
   │  job status polling        4. iTMSTransporter verify + upload to Apple
   └────────────────────────────5. report status/log lines back
```

Why these picks: B2 is the cheapest at ~$0.006/GB-month and the worker is the only heavy reader, so egress stays tiny. A €5/month always-on VPS is the only sane place for Java Transporter; serverless has no Java and no 1 GB working disk.

## What sublabels get

- New "Uploads" page: pick type (album / singles / ringtones), drop a folder or zip, see per-file progress with resumable chunked upload.
- Client-side validation before upload: audio format/length, artwork square + minimum size, filename sanity.
- Status timeline per upload: Uploaded → In review → Packaged → Delivered to Apple → Live / Rejected, with the rejection reason when Apple refuses.

## What admin gets

- Queue of incoming uploads across all sublabels, filterable by sublabel/type/status.
- Preview drawer: artwork thumbnails, inline audio player (streamed via short-lived signed B2 URLs), file list with sizes.
- Metadata sheet editor replacing the spreadsheet step:
  - Artist name typed once, applied to every row.
  - "Assign ISRCs" button pulls the next unused codes from the shared pool and stamps them onto the tracks in order.
  - Per-row overrides for title, version, track number, explicit flag, and (albums) UPC.
  - Inline validation: ISRC format, no duplicates against the existing catalog, required fields per type.
- ISRC pool manager: paste or CSV-import a block of codes, see used/remaining counts, reclaim codes from a cancelled upload.
- "Package & deliver" button queues the job; live log view streams the worker's output, with retry on failure.
- Delivered releases auto-create catalog items (title, artist, ISRC, UPC, Apple ID once Apple returns it) so sales and streams match on the first report.

## Technical section

**Storage (Backblaze B2)**
- One private bucket, keys namespaced `sublabel/<id>/upload/<uploadId>/<filename>`.
- Server functions mint presigned upload URLs (B2's S3-compatible endpoint) and short-lived signed GET URLs for preview; files never pass through Lovable's server, so the 1 GB limit is irrelevant.
- Uploads use S3 multipart in 50 MB parts, retried per part, so a dropped connection resumes rather than restarts.
- Lifecycle rule deletes raw source files N days after successful delivery (configurable) to hold storage cost down.
- Secrets `B2_KEY_ID`, `B2_APPLICATION_KEY`, `B2_BUCKET`, `B2_ENDPOINT` stored server-side.

**Database (new tables, all RLS-scoped like the existing ones)**
- `uploads` — sublabel_id, type, title, status, storage_prefix, size, counts, timestamps.
- `upload_files` — upload_id, role (audio / artwork / doc), key, filename, bytes, duration, checksum.
- `upload_tracks` — the metadata sheet: track number, title, artist, isrc, explicit, file reference.
- `isrc_pool` — code, used_by_track_id, assigned_at; shared across all sublabels, next-free assignment.
- `delivery_jobs` — upload_id, state (queued/claimed/packaging/uploading/succeeded/failed), attempts, apple_ticket, error.
- `delivery_logs` — job_id, ts, line — for the live log view.
- Admin-write / sublabel-read-own policies plus GRANTs, matching the pattern already used by `items` and `sales`.

**Worker (VPS)**
- Docker image: Node 20 + JRE + Apple `iTMSTransporter`, deployed to a Hetzner CX22 (~€4.5/month, 40 GB disk — enough for two concurrent 1 GB jobs).
- Claims jobs atomically via a `claim_delivery_job()` database function (`FOR UPDATE SKIP LOCKED`), so scaling to a second VPS needs no code change.
- Packaging modules port the logic of your existing albumat / ranat / singles tools into one library with three profiles, emitting a valid `.itmsp` (metadata.xml + assets + MD5 checksums).
- Runs `iTMSTransporter -m verify` first, then `-m upload`; stdout streamed line-by-line into `delivery_logs`.
- Retries transient Apple errors up to 3 times with backoff; hard failures surface the Apple message verbatim in the dashboard.
- Authenticates to the database with the service role key held only on the VPS; Apple credentials (`TRANSPORTER_USER`, app-specific password or API key) live only on the VPS too.

**Repo additions**
- `src/lib/uploads.functions.ts` — presign, register upload, list, preview URLs.
- `src/lib/delivery.functions.ts` — sheet save, ISRC assignment, queue job, log tail.
- `src/lib/b2.server.ts` — signing helpers.
- `src/routes/_authenticated/uploads.tsx` (sublabel + admin views), `.../uploads.$id.tsx` (review + sheet), `.../isrc.tsx` (pool).
- `worker/` — Dockerfile, job runner, packaging profiles, README with one-command deploy.

**Running cost estimate**: VPS ~€5/month + B2 ~$0.60/month per 100 GB retained + near-zero egress.

## What I need from you

- Backblaze B2 application key + bucket name (I'll request them through the secure secret form).
- A VPS you own (I'll give you the exact provisioning + deploy commands), plus your Apple Transporter username and app-specific password to set on it.
- Your `iTMSTransporter` build — Apple requires you download it from their site; the worker README will point at the exact path to drop it in.

## Build order

1. Database schema + RLS + ISRC pool.
2. B2 signing + sublabel upload page with multipart progress.
3. Admin review, preview, metadata sheet, ISRC one-click assignment.
4. Worker repo: packaging profiles for the three types, verified against a sample album.
5. Transporter delivery, live logs, retries, catalog auto-creation on success.
