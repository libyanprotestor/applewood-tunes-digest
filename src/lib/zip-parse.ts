/**
 * Browser-side unpacking of a release zip.
 *
 * Album zip   → a folder with the songs + the cover, plus a sheet whose first
 *               row holds the album title and the rows below the song titles.
 * Ringtone zip → a folder holding a sheet and numbered folders 1..n, each with
 *               one ringtone and one picture.
 */
import { unzipSync } from "fflate";
import * as XLSX from "xlsx";

export type ExtractedFile = {
  /** Name used in storage and inside the Apple package. */
  name: string;
  path: string;
  blob: File;
  role: "audio" | "artwork" | "document";
  folder: number | null;
};

export type ExtractedTrack = {
  folder: number | null;
  title: string;
  audioPath: string;
  artworkPath: string | null;
};

export type Extracted = {
  kind: "album" | "ringtones";
  albumTitle: string;
  files: ExtractedFile[];
  tracks: ExtractedTrack[];
  sheetRows: string[][];
  warnings: string[];
};

const AUDIO = /\.(wav|flac|aif|aiff|mp3|m4a)$/i;
const IMAGE = /\.(jpe?g|png|tiff?)$/i;
const SHEET = /\.(xlsx|xls|csv)$/i;
const JUNK = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$|\._)/i;

const base = (p: string) => p.split("/").pop() ?? p;
const numeric = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

/** Last numeric path segment, e.g. "pack/ringtones/3/1.wav" → 3. */
function folderNumber(path: string) {
  const segments = path.split("/").slice(0, -1);
  for (let i = segments.length - 1; i >= 0; i--) {
    const n = Number(segments[i]);
    if (Number.isInteger(n) && n > 0) return n;
  }
  return null;
}

function sheetToRows(name: string, bytes: Uint8Array): string[][] {
  if (/\.csv$/i.test(name)) {
    const text = new TextDecoder().decode(bytes);
    return text
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0)
      .map((line) => line.split(",").map((c) => c.trim().replace(/^"|"$/g, "")));
  }
  const book = XLSX.read(bytes, { type: "array" });
  const first = book.SheetNames[0];
  if (!first) return [];
  const rows = XLSX.utils.sheet_to_json<string[]>(book.Sheets[first]!, {
    header: 1,
    blankrows: false,
    defval: "",
  });
  return rows.map((r) => (r ?? []).map((c) => String(c ?? "").trim()));
}

/** Picks the column holding the titles, and drops a header row when present. */
function titleCells(rows: string[][]) {
  if (rows.length === 0) return [] as { row: string[]; title: string }[];
  const header = rows[0]!.some((c) => /^(title|song|track)/i.test(c)) ? rows[0]! : null;
  const body = header ? rows.slice(1) : rows;
  let column = header ? header.findIndex((c) => /^(title|song|track)/i.test(c)) : -1;
  if (column < 0) {
    // first column that is not just a row number
    const sample = body[0] ?? [];
    column = sample.findIndex((c) => c && !/^\d+$/.test(c));
    if (column < 0) column = 0;
  }
  return body
    .map((row) => ({ row, title: (row[column] ?? "").trim() }))
    .filter((r) => r.title.length > 0);
}

export function parseReleaseZip(zip: File, bytes: Uint8Array, kind: "album" | "ringtones"): Extracted {
  const entries = Object.entries(unzipSync(bytes)).filter(
    ([path, data]) => !JUNK.test(path) && !path.endsWith("/") && data.length > 0,
  );
  if (entries.length === 0) throw new Error("That zip is empty.");

  const warnings: string[] = [];
  const sheetEntry = entries.find(([p]) => SHEET.test(p));
  if (!sheetEntry) throw new Error("No sheet (.xlsx/.xls/.csv) was found inside the zip.");
  const sheetRows = sheetToRows(sheetEntry[0], sheetEntry[1]);
  const titles = titleCells(sheetRows);
  if (titles.length === 0) throw new Error("The sheet has no titles in it.");

  const audioEntries = entries.filter(([p]) => AUDIO.test(p)).sort((a, b) => numeric(a[0], b[0]));
  const imageEntries = entries.filter(([p]) => IMAGE.test(p)).sort((a, b) => numeric(a[0], b[0]));
  if (audioEntries.length === 0) throw new Error("No audio files were found inside the zip.");

  const files: ExtractedFile[] = [];
  const tracks: ExtractedTrack[] = [];
  const add = (path: string, data: Uint8Array, role: ExtractedFile["role"], name: string, folder: number | null) => {
    const copy = new Uint8Array(data);
    files.push({
      name,
      path,
      role,
      folder,
      blob: new File([copy], name, { type: role === "artwork" ? "image/jpeg" : "application/octet-stream" }),
    });
  };

  add(sheetEntry[0], sheetEntry[1], "document", base(sheetEntry[0]), null);

  if (kind === "album") {
    const albumTitle = titles[0]!.title;
    const songTitles = titles.slice(1).map((t) => t.title);
    if (songTitles.length === 0) throw new Error("The sheet only has the album title — no song rows below it.");
    if (imageEntries.length === 0) throw new Error("The album cover image is missing from the zip.");
    if (songTitles.length !== audioEntries.length)
      warnings.push(
        `The sheet lists ${songTitles.length} songs but the zip holds ${audioEntries.length} audio files. They were paired in order.`,
      );

    const cover = imageEntries[0]!;
    add(cover[0], cover[1], "artwork", base(cover[0]), null);

    const count = Math.min(songTitles.length, audioEntries.length);
    for (let i = 0; i < count; i++) {
      const [path, data] = audioEntries[i]!;
      add(path, data, "audio", base(path), null);
      tracks.push({ folder: null, title: songTitles[i]!, audioPath: path, artworkPath: cover[0] });
    }
    return { kind, albumTitle, files, tracks, sheetRows, warnings };
  }

  // ringtones — one package per numbered folder
  const byFolder = new Map<number, { audio?: [string, Uint8Array]; image?: [string, Uint8Array] }>();
  for (const entry of audioEntries) {
    const n = folderNumber(entry[0]);
    if (n === null) continue;
    const slot = byFolder.get(n) ?? {};
    slot.audio ??= entry;
    byFolder.set(n, slot);
  }
  for (const entry of imageEntries) {
    const n = folderNumber(entry[0]);
    if (n === null) continue;
    const slot = byFolder.get(n) ?? {};
    slot.image ??= entry;
    byFolder.set(n, slot);
  }
  if (byFolder.size === 0)
    throw new Error("No numbered ringtone folders were found. Each ringtone needs its own folder named 1, 2, 3…");

  const rowByFolder = new Map<number, string>();
  titles.forEach((t, index) => {
    const explicit = t.row.map((c) => Number(c)).find((n) => Number.isInteger(n) && n > 0);
    rowByFolder.set(explicit ?? index + 1, t.title);
  });

  for (const n of [...byFolder.keys()].sort((a, b) => a - b)) {
    const slot = byFolder.get(n)!;
    if (!slot.audio) {
      warnings.push(`Folder ${n} has no audio file and was skipped.`);
      continue;
    }
    if (!slot.image) warnings.push(`Folder ${n} has no picture.`);
    const title = rowByFolder.get(n);
    if (!title) {
      warnings.push(`Folder ${n} has no matching row in the sheet and was skipped.`);
      continue;
    }
    const audioName = `${n}_${base(slot.audio[0])}`;
    add(slot.audio[0], slot.audio[1], "audio", audioName, n);
    let artworkPath: string | null = null;
    if (slot.image) {
      artworkPath = slot.image[0];
      add(slot.image[0], slot.image[1], "artwork", `${n}_${base(slot.image[0])}`, n);
    }
    tracks.push({ folder: n, title, audioPath: slot.audio[0], artworkPath });
  }
  if (tracks.length === 0) throw new Error("None of the ringtone folders could be matched to the sheet.");

  return { kind, albumTitle: zip.name.replace(/\.zip$/i, ""), files, tracks, sheetRows, warnings };
}

export async function readZip(file: File) {
  return new Uint8Array(await file.arrayBuffer());
}
