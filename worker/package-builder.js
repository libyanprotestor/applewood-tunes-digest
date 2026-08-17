/**
 * Builds the Apple `.itmsp` package directory for a release.
 * Albums and singles use the music package format; ringtones use the tone format.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

const esc = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export function md5File(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash("md5");
    createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}

async function fileMeta(dir, filename) {
  const full = path.join(dir, filename);
  const stat = await fs.stat(full);
  return { file_name: filename, size: stat.size, checksum: await md5File(full) };
}

function assetBlock(meta, role = "source") {
  return `        <asset type="full">
          <data_file role="${role}">
            <file_name>${esc(meta.file_name)}</file_name>
            <size>${meta.size}</size>
            <checksum type="md5">${meta.checksum}</checksum>
          </data_file>
        </asset>`;
}

function trackBlock(track, meta, index, release) {
  return `      <track>
        <track_number>${index + 1}</track_number>
        <volume_number>1</volume_number>
        <isrc>${esc(track.isrc)}</isrc>
        <title>${esc(track.title)}</title>
        ${track.version ? `<subtitle>${esc(track.version)}</subtitle>` : ""}
        <artist>
          <primary_artist>
            <name>${esc(track.artist_name || release.artist_name)}</name>
          </primary_artist>
        </artist>
        <explicit_content>${track.explicit ? "explicit" : "not_explicit"}</explicit_content>
        <preview start_time="00:00:30"/>
${assetBlock(meta)}
      </track>`;
}

/** Music (album / singles) metadata.xml */
async function musicMetadata(dir, release, tracks, files, artwork) {
  const artworkMeta = artwork ? await fileMeta(dir, artwork) : null;
  const trackXml = [];
  for (let i = 0; i < tracks.length; i++) {
    const meta = await fileMeta(dir, files[i]);
    trackXml.push(trackBlock(tracks[i], meta, i, release));
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://apple.com/itunes/importer" version="music5.3">
  <provider>${esc(release.provider)}</provider>
  <team_id>${esc(release.provider)}</team_id>
  <album>
    <vendor_id>${esc(release.upc || release.vendor_id)}</vendor_id>
    ${release.upc ? `<upc>${esc(release.upc)}</upc>` : ""}
    <title>${esc(release.title)}</title>
    <artist>
      <primary_artist>
        <name>${esc(release.artist_name)}</name>
      </primary_artist>
    </artist>
    <label_name>${esc(release.label_name)}</label_name>
    ${release.release_date ? `<original_release_date>${esc(release.release_date)}</original_release_date>` : ""}
    ${
      artworkMeta
        ? `<artwork_files>
      <artwork_file>
        <file_name>${esc(artworkMeta.file_name)}</file_name>
        <size>${artworkMeta.size}</size>
        <checksum type="md5">${artworkMeta.checksum}</checksum>
      </artwork_file>
    </artwork_files>`
        : ""
    }
    <tracks>
${trackXml.join("\n")}
    </tracks>
  </album>
</package>
`;
}

/** Ringtone metadata.xml — one tone per audio file. */
async function ringtoneMetadata(dir, release, tracks, files) {
  const toneXml = [];
  for (let i = 0; i < tracks.length; i++) {
    const meta = await fileMeta(dir, files[i]);
    toneXml.push(`  <tone>
    <vendor_id>${esc(tracks[i].isrc)}</vendor_id>
    <isrc>${esc(tracks[i].isrc)}</isrc>
    <title>${esc(tracks[i].title)}</title>
    <artist>${esc(tracks[i].artist_name || release.artist_name)}</artist>
    <label_name>${esc(release.label_name)}</label_name>
    <explicit_content>${tracks[i].explicit ? "explicit" : "not_explicit"}</explicit_content>
${assetBlock(meta)}
  </tone>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://apple.com/itunes/importer" version="tone1.2">
  <provider>${esc(release.provider)}</provider>
${toneXml.join("\n")}
</package>
`;
}

/**
 * @param workDir directory that already holds every downloaded asset
 * @param release { kind, title, artist_name, upc, release_date, label_name, provider, vendor_id }
 * @param tracks  ordered track rows with { title, version, artist_name, isrc, explicit }
 * @param files   audio filenames in the same order as `tracks`
 * @param artwork artwork filename or null
 * @returns path of the created .itmsp directory
 */
export async function buildPackage(workDir, release, tracks, files, artwork) {
  const vendorId = release.upc || release.vendor_id;
  const itmsp = path.join(workDir, `${vendorId}.itmsp`);
  await fs.mkdir(itmsp, { recursive: true });

  const moved = [];
  for (const name of [...files, artwork].filter(Boolean)) {
    await fs.rename(path.join(workDir, name), path.join(itmsp, name));
    moved.push(name);
  }

  const xml =
    release.kind === "ringtones"
      ? await ringtoneMetadata(itmsp, release, tracks, files)
      : await musicMetadata(itmsp, release, tracks, files, artwork);

  await fs.writeFile(path.join(itmsp, "metadata.xml"), xml, "utf8");
  return itmsp;
}
