/**
 * Builds Apple `.itmsp` package directories.
 *
 * The XML mirrors the music5.1 packages Apple's own tooling produces:
 * albums get one package holding every song, ringtones get one package per
 * tone (artwork + audio + metadata.xml).
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
  const stat = await fs.stat(path.join(dir, filename));
  return { file_name: filename, size: stat.size, checksum: await md5File(path.join(dir, filename)) };
}

function genres(code, indent) {
  const pad = " ".repeat(indent);
  return `${pad}<genres>
${pad}    <genre code="${esc(code)}"></genre>
${pad}    <genre code="${esc(code)}"></genre>
${pad}</genres>`;
}

function artists(name, indent) {
  const pad = " ".repeat(indent);
  const roles = [
    ["Producer", "true"],
    ["Composer", "false"],
    ["Programmer", "false"],
  ];
  return `${pad}<artists>
${roles
  .map(
    ([role, primary]) => `${pad}    <artist>
${pad}        <artist_name>${esc(name)}</artist_name>
${pad}        <apple_id></apple_id>
${pad}        <roles>
${pad}            <role>${role}</role>
${pad}        </roles>
${pad}        <primary>${primary}</primary>
${pad}    </artist>`,
  )
  .join("\n")}
${pad}</artists>`;
}

function assetXml(tag, meta, indent) {
  const pad = " ".repeat(indent);
  return `${pad}<${tag}>
${pad}    <file_name>${esc(meta.file_name)}</file_name>
${pad}    <size>${meta.size}</size>
${pad}    <checksum type="md5">${meta.checksum}</checksum>
${pad}</${tag}>`;
}

function head(release) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://apple.com/itunes/importer" version="music5.1" generator="ITunesPackage" generator_version="3.1.4 (1085)">
    <language>${esc(release.language || "en")}</language>
    <provider>${esc(release.provider)}</provider>`;
}

/** Album metadata.xml — one album, every track inside. */
async function albumMetadata(dir, release, tracks, audioNames, artwork) {
  const artworkMeta = artwork ? await fileMeta(dir, artwork) : null;
  const trackXml = [];
  for (let i = 0; i < tracks.length; i++) {
    const meta = await fileMeta(dir, audioNames[i]);
    const track = tracks[i];
    trackXml.push(`            <track>
                <vendor_id>${esc(track.isrc)}</vendor_id>
${genres(release.genre_code, 16)}
${artists(track.artist_name || release.artist_name, 16)}
                <copyright_pline>${esc(release.copyright_pline)}</copyright_pline>
                <label_name>${esc(release.label_name)}</label_name>
                <title>${esc(track.title)}</title>
                <isrc>${esc(track.isrc)}</isrc>
                <products>
                    <product>
                        <territory>WW</territory>
                        <cleared_for_sale>true</cleared_for_sale>
                    </product>
                </products>
                <volume_number>1</volume_number>
                <track_number>${i + 1}</track_number>
${assetXml("audio_file", meta, 16)}
                <audio_language>${esc(release.language || "en")}</audio_language>
            </track>`);
  }

  return `${head(release)}
    <album>
        <vendor_id>${esc(release.vendor_id)}</vendor_id>
${genres(release.genre_code, 8)}
${artists(release.artist_name, 8)}
        <copyright_pline>${esc(release.copyright_pline)}</copyright_pline>
        <copyright_cline>${esc(release.copyright_cline)}</copyright_cline>
        <label_name>${esc(release.label_name)}</label_name>
        <title>${esc(release.title)}</title>${
          release.release_date
            ? `\n        <original_release_date>${esc(release.release_date)}</original_release_date>`
            : ""
        }${artworkMeta ? `\n        <artwork_files>\n${assetXml("file", artworkMeta, 12)}\n        </artwork_files>` : ""}
        <preorder_previews>true</preorder_previews>
        <track_count>${tracks.length}</track_count>
        <products>
            <product>
                <territory>WW</territory>
                <cleared_for_sale>true</cleared_for_sale>
                <cleared_for_ticketmaster>true</cleared_for_ticketmaster>
            </product>
        </products>
        <tracks>
${trackXml.join("\n")}
        </tracks>
    </album>
</package>
`;
}

/** Ringtone metadata.xml — one tone per package. */
async function ringtoneMetadata(dir, release, track, audioName, artwork) {
  const audioMeta = await fileMeta(dir, audioName);
  const artworkMeta = artwork ? await fileMeta(dir, artwork) : null;
  return `${head(release)}
    <album>
        <vendor_id>${esc(track.isrc)}</vendor_id>
${genres(release.genre_code || "RINGTONES-00", 8)}
${artists(track.artist_name || release.artist_name, 8)}
        <copyright_pline>${esc(release.copyright_pline)}</copyright_pline>
        <copyright_cline>${esc(release.copyright_cline)}</copyright_cline>
        <label_name>${esc(release.label_name)}</label_name>
        <title>${esc(track.title)}</title>
        <album_type>ringtone</album_type>${
          release.release_date
            ? `\n        <original_release_date>${esc(release.release_date)}</original_release_date>`
            : ""
        }${artworkMeta ? `\n        <artwork_files>\n${assetXml("file", artworkMeta, 12)}\n        </artwork_files>` : ""}
        <products>
            <product>
                <territory>WW</territory>${
                  release.release_date
                    ? `\n                <sales_start_date>${esc(release.release_date)}</sales_start_date>`
                    : ""
                }
                <cleared_for_sale>true</cleared_for_sale>
            </product>
        </products>
        <tracks>
            <track>
                <vendor_id>${esc(track.isrc)}</vendor_id>
                <title>${esc(track.title)}</title>
                <type>ringtone</type>
                <isrc>${esc(track.isrc)}</isrc>
                <track_number>1</track_number>
${assetXml("audio_file", audioMeta, 16)}
            </track>
        </tracks>
    </album>
</package>
`;
}

async function makePackage(sourceDir, vendorId, assetNames, xml) {
  const dir = path.join(sourceDir, `${vendorId}.itmsp`);
  await fs.mkdir(dir, { recursive: true });
  for (const name of assetNames) {
    await fs.copyFile(path.join(sourceDir, name), path.join(dir, name));
  }
  await fs.writeFile(path.join(dir, "metadata.xml"), xml, "utf8");
  return dir;
}

/**
 * Returns the packages to deliver: `[{ dir, vendorId, title }]`.
 * Albums yield one entry, ringtones one entry per tone.
 */
export async function buildPackages(workDir, release, tracks, audioNames, artworkNames) {
  if (release.kind === "ringtones") {
    const out = [];
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      const audio = audioNames[i];
      const artwork = artworkNames[i] ?? null;
      const xml = await ringtoneMetadata(workDir, release, track, audio, artwork);
      const assets = artwork ? [audio, artwork] : [audio];
      out.push({
        dir: await makePackage(workDir, track.isrc, assets, xml),
        vendorId: track.isrc,
        title: track.title,
      });
    }
    return out;
  }

  const artwork = artworkNames.find(Boolean) ?? null;
  const xml = await albumMetadata(workDir, release, tracks, audioNames, artwork);
  const assets = artwork ? [...audioNames, artwork] : [...audioNames];
  return [
    {
      dir: await makePackage(workDir, release.vendor_id, assets, xml),
      vendorId: release.vendor_id,
      title: release.title,
    },
  ];
}
