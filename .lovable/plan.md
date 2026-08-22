# Fix stale delivery states, runaway logs, and parallel deliveries

## What actually happened

Checked the database for your two ringtone jobs:

- WAJEEH OLD RING TONE: 91 packages `succeeded`, 1 `uploading`, 8 `awaiting_approval` — job still `uploading`, attempt 2.
- wajeeh childern tone: 39 `succeeded`, 1 `uploading`, 20 `awaiting_approval` — job still `uploading`, attempt 3.
- Both jobs were claimed by `worker-1` and were running at the same time (11:33 and 12:38), and both jobs' database writes simply stop at a point in time (last log 12:33 and 12:59) even though Transporter kept uploading successfully.

That pattern means the worker's database session stopped working mid-run: two worker runs share one login, and Supabase rotates refresh tokens, so when one refreshes the other's token is revoked. From that moment every `delivery_packages` update and every log insert fails silently (the worker never checks the error from these writes), while iTMSTransporter happily keeps delivering to Apple. Hence "delivered at Apple, still uploading/awaiting_approval here".

The log box stopping is separate: the page asks for the **first** 500 log lines of the job (`afterId: 0`, ascending, limit 500). Your jobs wrote 46,890 and 64,988 lines, so you only ever see the oldest 500.

## The fix

### 1. Worker writes must never fail silently

- Wrap every Supabase call in the worker in a helper that checks the error, and on any auth/permission error re-signs in once and retries the write.
- Refresh the session check before each package upload, not just once per poll cycle.
- If a write still fails after retry, the worker logs it loudly to stdout and fails the job instead of silently continuing.

### 2. One job at a time, one worker identity

- Unique worker id per process (`hostname-pid`) so two accidental instances are visible instead of both calling themselves `worker-1`.
- The worker takes a single job and does not poll again until it is finished — plus a local lock file so a second process on the same machine refuses to start delivering.
- Deliveries then run strictly one after the other, as you expected.

### 3. Much smaller, more useful logs

Stop mirroring every Transporter line into the database. What gets stored:

- packaging: one line per package built, plus start/finish lines;
- delivering: one line when a package starts uploading;
- per item after upload: **one** line — success (with Apple ticket) or error (with the last few meaningful Transporter error lines);
- job-level start/finish/failure lines.

Full Transporter output still goes to the container's stdout (`docker logs`) for deep debugging.

### 4. Log panel shows the live tail

- `deliveryLogs` returns the newest lines (ordered newest-first, then reversed for display) and supports incremental polling by last seen id.
- Panel keeps polling while the job is packaging, uploading or awaiting approval, so you see progress in real time.

### 5. Recovering the two stuck jobs

- Add an admin action on the delivery panel: **Resync job state** — re-reads each package's real state and, when Apple already accepted them, lets you mark the remaining packages/job as delivered instead of leaving them frozen.
- For the current two jobs, after the worker redeploy you can either resync them or reject and re-run; nothing extra goes to Apple from a resync.

## Technical notes

- `worker/index.js`: `db()` wrapper with auth-aware retry; `ensureSession()` before each package; `WORKER_ID = ${hostname}-${pid}`; lock file in `WORK_ROOT`; logging trimmed to the levels above (Transporter stdout buffered in memory, only its error tail persisted on failure).
- `src/lib/delivery.functions.ts`: `deliveryLogs` newest-first + `afterId` tail mode; new `resyncJob` server function (admin only) to reconcile package/job/upload states.
- `src/routes/_authenticated/uploads_.$id.tsx`: tail-based log query with a wider polling state list, plus the Resync button.
- Requires `git pull` + worker redeploy on the VPS.
