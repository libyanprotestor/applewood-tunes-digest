# Delivery worker

Packages uploaded releases into Apple `.itmsp` bundles and delivers them with
iTMSTransporter. It runs outside Lovable because Transporter needs Java and the
files are far too big for a serverless runtime.

## What it does

1. Signs in to the backend as a dedicated admin account (email + password, using
   the public anon key — no private service key needed).
2. Claims one queued job at a time (`claim_delivery_job`, lease-protected, so
   several workers can run side by side).
3. Downloads the release audio and artwork from the storage bucket.
4. Builds `metadata.xml` plus MD5 checksums into a `<vendor_id>.itmsp` folder —
   music format for albums/singles, tone format for ringtones.
5. Runs `iTMSTransporter -m upload` and streams every line into `delivery_logs`,
   which the dashboard tails live.
6. Marks the job delivered (with Apple's transaction id) or failed with the
   error; failed jobs can be retried from the release page.

## 1. Create the VPS

Hetzner Cloud → new project → Add Server → **Ubuntu 24.04**, type **CX22**
(2 vCPU / 4 GB / 40 GB, ~€4.5/mo), add your SSH key, create. Then `ssh root@<ip>`.
A DigitalOcean 2 GB droplet works the same way.

## 2. Create the worker login

In the dashboard, create a normal user (e.g. `worker@yourdomain.com`) with a long
random password and give it the **admin** role. Those two values go only in the
worker `.env` on the VPS.

## 3. Apple credentials

| Value | Where to get it |
| --- | --- |
| `APPLE_TRANSPORTER_USER` | The Apple ID used for delivery |
| `APPLE_TRANSPORTER_PASSWORD` | appleid.apple.com → Sign-In and Security → App-Specific Passwords |
| `APPLE_PROVIDER_SHORTNAME` | App Store Connect → Users and Access → Integrations, or run `iTMSTransporter -m provider -u <appleid> -p <app-specific-password>` |

## 4. Apple's Transporter

Download iTMSTransporter for Linux from Apple
(<https://itunesconnect.apple.com/apploader/itmstransporter_linux.tar.gz>, or via
App Store Connect → Resources and Help → Transporter) and copy it to the VPS as
`transporter.tar.gz` next to this file:

```bash
scp itmstransporter_linux.tar.gz root@<ip>:/root/<repo>/worker/transporter.tar.gz
```

## 5. Deploy

```bash
git clone <this repo> && cd worker
cp .env.example .env && nano .env     # fill in the blanks
bash deploy.sh                        # installs Docker, builds, runs with --restart=always
docker logs -f delivery-worker
```

Redeploy after any change with `git pull && bash deploy.sh`.

### Environment

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | Backend URL and public key (already filled in `.env.example`) |
| `WORKER_EMAIL` / `WORKER_PASSWORD` | The dedicated admin login from step 2 |
| `B2_ENDPOINT` / `B2_BUCKET` / `B2_KEY_ID` / `B2_APPLICATION_KEY` | Storage access |
| `APPLE_PROVIDER_SHORTNAME` | Your Apple provider short name |
| `APPLE_TRANSPORTER_USER` / `APPLE_TRANSPORTER_PASSWORD` | Apple ID + app-specific password |
| `WORKER_ID` | Optional label shown in the queue |
| `POLL_INTERVAL_MS` | Optional, defaults to 15000 |

## 6. Verify

Within ~15 seconds the queued job moves `queued → claimed → packaging →
uploading` and Transporter output streams into the Delivery log on the release
page. The release page also shows which worker picked the job up.

## Bucket CORS (required for browser uploads)

The dashboard uploads straight from the browser, so the bucket must allow it
and expose `ETag` (multipart uploads fail without it):

```json
[
  {
    "corsRuleName": "dashboard",
    "allowedOrigins": ["https://sublabel-sales.lovable.app", "http://localhost:8080"],
    "allowedOperations": ["s3_put", "s3_get", "s3_head"],
    "allowedHeaders": ["*"],
    "exposeHeaders": ["etag"],
    "maxAgeSeconds": 3600
  }
]
```

Apply with `b2 bucket update <bucket> allPrivate --corsRules "$(cat cors.json)"`.
