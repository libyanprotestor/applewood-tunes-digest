# Admin upload & delivery flow: leaner UI, less bandwidth, auto-catalog

## 1. Media preview on demand

- Nothing from Backblaze is fetched or rendered when the page opens: the upload detail request no longer mints preview links by default, so no audio or images load.
- A new **Preview** button fetches the short-lived links and shows the media.
- Pressing **Approve** or **Reject** immediately hides the media and drops the links, so playback and image traffic stop; the admin presses **Preview** again to see them.
- Audio list stays where it is; the artwork grid moves below the audio, 4 images per row, inside a scroll box sized to exactly two rows.

## 2. Sections and buttons

- **Release details** and **Metadata sheet** become collapsible panels; both collapse automatically as soon as the release is approved.
- **Download sheet** always works, in every mode and status.
- The **Cancel** status button is removed — **Reject** is the only way to deny an upload. (The separate "cancel a queued job" button in the Delivery list stays, it does a different thing.)
- The single "Package & deliver" button becomes two:
  - **Package** — reviews the metadata XML and queues the worker to build the packages.
  - **Deliver** — enabled once packages are built and shown; sends them to Apple.
- The built-packages review section is collapsible and collapses itself after the admin approves the packaging, leaving **Deliver** as the next step.

## 3. Deletion rules

- Once approved, individual audio/artwork **Delete** links are disabled.
- **Delete upload** stays available only while the status is Draft, Rejected or Delivered; hidden/disabled otherwise.

## 4. After delivery

- **Packaging rejected:** only the built `.itmsp` package folders are removed from the delivery server. Downloaded source files stay so a repackage doesn't re-download from Backblaze.
- **Delivered successfully:**
  - original files are deleted from Backblaze and their rows cleared, and the whole job folder is removed from the delivery server;
  - the upload is locked permanently — In review / Reject / Approve / Package / Deliver all disappear;
  - the release is written into the sublabel's catalog automatically:
    - ringtones → one `ringtone` item per ringtone, with its ISRC
    - singles → one `single` item per track, with its ISRC
    - album → one `album` item with the album ISRC, plus one `album_song` item per track
  - duplicates are skipped, so re-running never double-adds.

## Technical notes

- Migration: add `album_song` to the `item_type` enum; add a `catalog_synced_at` (or equivalent flag) column on `uploads` so catalog insertion is idempotent.
- `getUpload` gains a `withUrls` flag (default false). A new `uploadMediaUrls` server function returns presigned links only when Preview is pressed; the client keeps them in state, not in the cached query.
- New server function `finalizeDelivered(uploadId)`: verifies admin, requires status `delivered`, inserts catalog items (album/album_song/single/ringtone) for the upload's sublabel skipping existing ISRCs, deletes Backblaze objects + `upload_files` rows, stamps the sync flag. Called by the worker after a successful Apple upload (or by the admin page when it sees `delivered` and the flag unset, as a safety net).
- Worker (`worker/index.js`): on reject-packages cleanup remove only `*.itmsp` dirs, keep downloads; on success remove the whole `WORK_ROOT/job-<id>` folder and call the finalize path. Requires a `git pull` + redeploy on the VPS.
- UI work is contained in `src/routes/_authenticated/uploads_.$id.tsx` (collapsible sections via local state, preview state, grid + scroll box, button gating from `upload.status`).
