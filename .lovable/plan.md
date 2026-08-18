# Zip-based album & ringtone uploads with Apple packaging

## What the sublabel does

The upload page loses the Title and Artist fields. A sublabel only picks the type (Album or Ringtones) and drops **one zip file**.

- **Album zip** → inside is a folder containing the songs and the cover art, plus a sheet. The sheet's first row holds the album title, the rows below hold the song titles.
- **Ringtone zip** → inside is a folder containing a sheet and numbered folders `1..n`; each numbered folder holds one ringtone audio file and one picture. Each numbered folder becomes its own Apple package.

The zip is stored in the cloud, unpacked automatically, and every audio file, image and sheet row is recorded. If the structure doesn't match (missing sheet, missing artwork, folder numbers that don't line up with sheet rows), the upload is flagged with a plain-language error the sublabel can read and fix.

## What the admin does

On the release page the admin gets:

1. **Preview** — play each audio file, view each image, and see the sheet exactly as parsed.
2. **Release details** — artist name (mandatory), release date, genre, language, label name, copyright lines. These are pre-filled from the sublabel's saved defaults and can be overridden per release.
3. **Apply artist to all** — one click fills the artist column for every row.
4. **Assign codes** — one click pulls the next free codes from the ISRC pool: for an album the first code becomes the album vendor id / UPC and each track gets the next code; for ringtones each ringtone gets its own code. Codes are marked used and returned to the pool if the release is cancelled or rejected.
5. **Review the filled sheet** — the sheet is an editable table; individual cells can be corrected. A **Download sheet** button exports the filled version as CSV.
6. **Approve** → the release becomes Ready.
7. **Package & deliver** → builds the `.itmsp` package(s) and sends them to Apple through Transporter.
8. **Apple response** — the delivery panel shows live state (packaging, uploading, delivered, failed), Apple's transaction ticket when it succeeds, and Apple's error text when it doesn't, plus a per-line log.

Delivery stays blocked until artist name and every code is filled.

## Packaging output

- **Album** → one folder `<albumcode>.itmsp` containing the artwork, every audio file and `metadata.xml`, matching the structure of the sample you supplied (`music5.1`, provider, album block with genres/artists/roles/copyright/label/artwork/products, then one `<track>` per song with vendor_id, isrc, title, volume + track number, `audio_file` with size and md5 checksum).
- **Ringtones** → one `<code>.itmsp` per numbered folder, each containing that ringtone's audio, its picture and its own `metadata.xml` in Apple's tone format. Each package is delivered to Apple separately and gets its own status row.

I'll match the ringtone `metadata.xml` byte-for-byte against the two files you're uploading before writing the generator.

## Technical notes

- New server function unzips the uploaded archive in the worker (not in the edge runtime, since large zips and audio files exceed its limits), writes the extracted objects back to storage under the upload prefix, and populates `upload_files` / `upload_tracks`. Sheet parsing supports CSV and XLSX.
- `upload_tracks` gains a `folder_number` column (ringtones) and `upload_files` gains a per-track artwork link; `uploads` gains genre / language / copyright / label columns. `sublabels` gains the matching default columns.
- ISRC assignment reuses the existing `isrc_pool` claim/release functions, extended to cover the album-level code.
- `worker/package-builder.js` is rewritten to emit the exact album XML shape above and a new tone builder that produces one package per ringtone; `worker/index.js` loops over packages and records a per-package Transporter result.
- The upload form drops title/artist inputs; `createUpload` takes the title from the sheet after extraction.
