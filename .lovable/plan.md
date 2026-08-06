# Apple Music Sales & Royalty Dashboard

An internal reporting app that pulls daily Apple Music sales reports, matches them to your catalog, converts everything to USD, and shows revenue by company and by sublabel.

## What gets built

### 1. Backend (Lovable Cloud)
Database tables:
- `sublabels` — name, contact, status. Created manually by admin.
- `items` — title, artist, ISRC/UPC, type (ringtone / single / album), linked to a sublabel. Imported via CSV.
- `sales` — one row per report line: date, territory, units, unit price, original currency, USD amount, matched item, sublabel, report source.
- `unmatched_sales` — report rows whose ISRC/UPC isn't in the catalog, kept for admin review and assignable to an item later.
- `fx_rates` — daily rate per currency to USD, stored by date so historical totals never change.
- `report_runs` — per-date fetch log: status, rows parsed, matched/unmatched counts, errors, retry count.
- `profiles` + `user_roles` (admin / sublabel) — roles in their own table, never on the profile.

Security: row-level rules so a sublabel account can only read its own items and sales; admins see everything. Apple access token and vendor ID live only in server-side secrets, never in browser code.

### 2. Apple Reporter integration
- Server-side call to the Reporter sales service using `Sales.getReport, <vendor>, Music, Detailed, Daily, YYYYMMDD`, authenticated with the access token.
- Response is gzipped; it's decompressed server-side and parsed as tab-separated text.
- Columns used: title, artist, ISRC/UPC (Apple Identifier / ISRC field), units, customer price, customer currency, country, sale/return type.
- Matching is by ISRC first, then UPC. Matched rows insert into `sales`; the rest go to `unmatched_sales`.
- Re-running a date is safe: existing rows for that report date + vendor are replaced, not duplicated.

### 3. Daily scheduled jobs
Apple publishes on three regional clocks, so three scheduled runs per day:
- 05:00 Pacific — Americas
- 05:00 Japan Standard Time — Japan, Australia, New Zealand
- 05:00 Central European Time — all other territories

Each run fetches the previous day's report. If Apple says the report isn't ready yet, the run is marked pending and retried on a short backoff (up to a few hours) instead of failing silently. Admin can also trigger a manual fetch for any past date from the UI.

### 4. Currency conversion
Rates come from a free exchange-rate API (Frankfurter — ECB data, no API key needed, supports historical dates). For each report date the day's rates are fetched once, cached in `fx_rates`, and used to convert every line to USD. Existing sales keep their original rate.

### 5. App screens

**Admin**
- Dashboard: total units and USD revenue with day / week / month / year toggles, trend chart, top items, top sublabels, breakdown by territory and item type.
- Sublabels: create, edit, and create their login (email + initial password); per-sublabel revenue view.
- Catalog: item list with search/filter, CSV import (title, ISRC/UPC, optional artist, item type, sublabel) with a preview and error report before committing.
- Unmatched sales queue: review rows and assign them to an item, which back-fills the revenue.
- Report runs: status of each daily fetch, with manual re-fetch.

**Sublabel**
- Sign in with the credentials the admin issued.
- Their own dashboard: units and USD revenue by day / week / month / year, per-item breakdown, trend chart. No access to other sublabels or company totals.

## Technical notes
- Reporter calls, unzipping, parsing, matching, and FX lookups all run in TanStack Start server functions; the scheduled trigger is a secured public API route called by cron.
- `APPLE_REPORTER_ACCESS_TOKEN`, `APPLE_VENDOR_ID`, and a cron secret are stored as server secrets (requested from you once Cloud is enabled).
- Sales are stored at line-item granularity so any aggregation period can be computed from the same data.
- Aggregations are done in SQL views/functions for speed on large row counts.

## Build order
1. Enable Lovable Cloud, create schema + roles + access rules.
2. Auth: admin and sublabel sign-in, role routing.
3. Sublabel management and CSV catalog import.
4. Reporter fetch + parse + match + FX conversion, with manual date trigger.
5. Scheduled jobs for the three regional windows, plus retry and run log.
6. Admin and sublabel dashboards.
