/**
 * Pure metadata.xml builder used for the admin preview shown before delivery.
 * The delivery worker builds the final files with real md5 checksums; here the
 * checksum is unknown until packaging, so it is left as a placeholder.
 */

export type PreviewRelease = {
  kind: string;
  title: string;
  vendor_id: string;
  artist_name: string;
  genre_code: string;
  language: string;
  label_name: string;
  copyright_pline: string;
  copyright_cline: string;
  release_date: string | null;
  provider: string;
};

export type PreviewTrack = {
  title: string;
  isrc: string;
  artist_name: string;
  audio: { file_name: string; size: number } | null;
  artwork: { file_name: string; size: number } | null;
};

const esc = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function genres(code: string, indent: number) {
  const pad = " ".repeat(indent);
  return `${pad}<genres>
${pad}    <genre code="${esc(code)}"></genre>
${pad}    <genre code="${esc(code)}"></genre>
${pad}</genres>`;
}

function artists(name: string, indent: number) {
  const pad = " ".repeat(indent);
  const roles: [string, string][] = [
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

function assetXml(tag: string, meta: { file_name: string; size: number }, indent: number) {
  const pad = " ".repeat(indent);
  return `${pad}<${tag}>
${pad}    <file_name>${esc(meta.file_name)}</file_name>
${pad}    <size>${meta.size}</size>
${pad}    <checksum type="md5">(computed at packaging)</checksum>
${pad}</${tag}>`;
}

function head(release: PreviewRelease) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://apple.com/itunes/importer" version="music5.1" generator="ITunesPackage" generator_version="3.1.4 (1085)">
    <language>${esc(release.language || "en")}</language>
    <provider>${esc(release.provider)}</provider>`;
}

function albumMetadata(release: PreviewRelease, tracks: PreviewTrack[]) {
  const artwork = tracks.map((t) => t.artwork).find(Boolean) ?? null;
  const trackXml = tracks.map((track, i) => {
    const audio = track.audio ?? { file_name: "(missing audio)", size: 0 };
    return `            <track>
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
${assetXml("audio_file", audio, 16)}
                <audio_language>${esc(release.language || "en")}</audio_language>
            </track>`;
  });

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
        }${artwork ? `\n        <artwork_files>\n${assetXml("file", artwork, 12)}\n        </artwork_files>` : ""}
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

function ringtoneMetadata(release: PreviewRelease, track: PreviewTrack) {
  const audio = track.audio ?? { file_name: "(missing audio)", size: 0 };
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
        }${track.artwork ? `\n        <artwork_files>\n${assetXml("file", track.artwork, 12)}\n        </artwork_files>` : ""}
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
${assetXml("audio_file", audio, 16)}
            </track>
        </tracks>
    </album>
</package>
`;
}

/** Returns the metadata.xml documents that will be delivered. */
export function buildMetadataPreview(
  release: PreviewRelease,
  tracks: PreviewTrack[],
): { vendorId: string; title: string; xml: string }[] {
  if (release.kind === "ringtones") {
    return tracks.map((t) => ({
      vendorId: t.isrc || "(no ISRC)",
      title: t.title,
      xml: ringtoneMetadata(release, t),
    }));
  }
  return [
    {
      vendorId: release.vendor_id || "(no album ISRC)",
      title: release.title,
      xml: albumMetadata(release, tracks),
    },
  ];
}
