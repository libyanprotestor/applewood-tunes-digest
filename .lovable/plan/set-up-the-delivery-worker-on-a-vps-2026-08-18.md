# Set up the delivery worker on a VPS

The app already queues delivery jobs correctly; nothing packages because no worker is running. This plan gets a worker online on a small Hetzner/DigitalOcean box, with one change on my side: the worker currently expects a service-role key, which is not available to you on Lovable Cloud.

## Change I make in the app

1. **Worker signs in as a dedicated account instead of using a service key.**
   The worker will log in with `WORKER_EMAIL` / `WORKER_PASSWORD` (a normal admin account you create in the dashboard) plus the public anon key, and refresh its session automatically. Same permissions as an admin in the UI, nothing extra leaks.
   - `worker/index.js`: replace `SUPABASE_SERVICE_ROLE_KEY` with anon key + password sign-in, re-auth on token expiry.
   - `worker/.env.example` and `worker/README.md` updated to match.
2. **Confirm the worker's database access under those permissions** — job claiming (`claim_delivery_job`), job/state updates, `delivery_logs`, `delivery_packages`, and `uploads` status. Any missing grant/policy for an admin-role account gets a migration.
3. **One-command deploy script** `worker/deploy.sh` — installs Docker, builds the image, runs the container with `--restart=always`, and prints the log tail command.
4. **Live status in the dashboard**: show `worker_id` and last heartbeat on the Delivery card so you can tell at a glance whether a worker is connected, plus a "Cancel queued job" button to clear the job that is stuck right now.

## What you do

**1. Create the VPS (5 min)**
- Hetzner Cloud → new project → Add Server → Ubuntu 24.04, type **CX22** (2 vCPU / 4 GB / 40 GB, ~€4.5/mo), add your SSH key, create.
- Note the IP, then `ssh root@<ip>`.

**2. Get Apple's Transporter**
- Download `iTMSTransporter` for Linux from Apple (App Store Connect → Resources and Help → Transporter, or the apploader link in the worker README).
- Copy the archive to the VPS as `transporter.tar.gz` next to the worker files.

**3. Apple credentials to have ready**
- Apple ID used for delivery.
- App-specific password (appleid.apple.com → Sign-in and Security → App-Specific Passwords).
- Provider short name (App Store Connect → Users and Access → Integrations, or run Transporter's `-m provider` command; the README includes it).

**4. Create the worker login**
- In the dashboard, add a normal admin user, e.g. `worker@yourdomain.com`, with a long random password. Those two values go in the worker `.env` only.

**5. Deploy**
```bash
git clone <this repo> && cd worker
cp .env.example .env && nano .env    # fill the values below
bash deploy.sh
docker logs -f delivery-worker
```

`.env` values: backend URL + anon key (both public, I'll paste the exact lines), `WORKER_EMAIL`/`WORKER_PASSWORD`, your four `B2_*` values, `APPLE_PROVIDER_SHORTNAME`, `APPLE_TRANSPORTER_USER`, `APPLE_TRANSPORTER_PASSWORD`.

## Verifying

Within ~15 seconds of the worker starting, the job already queued for the ringtone release moves `queued → claimed → packaging → uploading`, with Transporter output streaming live into the Delivery log on the release page, and a per-package row with Apple's ticket id on success.

## Notes

- Apple credentials and B2 keys live only on the VPS — never in the app or in chat.
- One worker handles several GB of deliveries a day; add a second box later and job claiming already handles it safely.
- Running cost: ~€5/month.
