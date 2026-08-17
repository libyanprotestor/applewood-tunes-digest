# Delivery worker

Packages uploaded releases into Apple `.itmsp` bundles and delivers them with
iTMSTransporter. It runs outside Lovable because Transporter needs Java and the
files are far too big for a serverless runtime.

## What it does

1. Claims one queued job at a time (`claim_delivery_job`, lease-protected, so
   several workers can run side by side).
2. Downloads the release audio and artwork from the storage bucket.
3. Builds `metadata.xml` plus MD5 checksums into a `<vendor_id>.itmsp` folder —
   music format for albums/singles, tone format for ringtones.
4. Runs `iTMSTransporter -m upload` and streams every line into `delivery_logs`,
   which the dashboard tails live.
5. Marks the job `delivered` (with Apple's transaction id) or `failed` with the
   error; failed jobs can be retried from the Deliveries page.

## Where to run it

A small always-on VPS is the cheapest fit: Hetzner CX22 (2 vCPU / 4 GB, ~€4/mo)
or a DigitalOcean 2 GB droplet (~$12/mo). One worker comfortably handles a few
GB of deliveries a day; add more instances if the queue backs up.

## Setup

```bash
# on the VPS
git clone <this repo> && cd worker
# place Apple's iTMSTransporter archive here as transporter.tar.gz
cp .env.example .env   # fill in the values below
docker build -t delivery-worker .
docker run -d --restart=always --env-file .env --name delivery-worker delivery-worker
```

### Environment

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | Backend URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service key — worker only, never in the app |
| `B2_ENDPOINT` / `B2_BUCKET` / `B2_KEY_ID` / `B2_APPLICATION_KEY` | Storage access |
| `APPLE_PROVIDER_SHORTNAME` | Your Apple provider short name |
| `APPLE_TRANSPORTER_USER` / `APPLE_TRANSPORTER_PASSWORD` | Apple ID + app-specific password |
| `WORKER_ID` | Optional label shown in the queue |
| `POLL_INTERVAL_MS` | Optional, defaults to 15000 |

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
