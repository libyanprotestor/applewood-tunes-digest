/** Server-only helpers behind the upload server functions. */
import type { SupabaseClient } from "@supabase/supabase-js";

export const PART_SIZE = 50 * 1024 * 1024; // 50 MB
export const SINGLE_PUT_LIMIT = 100 * 1024 * 1024;

export function sanitizeFilename(name: string) {
  return name
    .split(/[\\/]/)
    .pop()!
    .replace(/[^\w.\-() ]+/g, "_")
    .slice(0, 180);
}

export function guessRole(filename: string, contentType: string) {
  const lower = filename.toLowerCase();
  if (contentType.startsWith("audio/") || /\.(wav|flac|aif|aiff|mp3|m4a)$/.test(lower)) return "audio" as const;
  if (contentType.startsWith("image/") || /\.(jpg|jpeg|png|tif|tiff)$/.test(lower)) return "artwork" as const;
  if (/\.(csv|xlsx|xls|txt|pdf|doc|docx)$/.test(lower)) return "document" as const;
  return "other" as const;
}

/** Loads an upload the caller is allowed to see; RLS does the real gating. */
export async function loadUpload(supabase: SupabaseClient, uploadId: string) {
  const { data, error } = await supabase
    .from("uploads")
    .select("id, sublabel_id, kind, title, status, storage_prefix")
    .eq("id", uploadId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Upload not found");
  return data;
}

export function partCountFor(bytes: number) {
  return Math.max(1, Math.ceil(bytes / PART_SIZE));
}

export function isrcValid(code: string) {
  return /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(code.toUpperCase().replace(/-/g, ""));
}

export function normalizeIsrc(code: string) {
  return code.toUpperCase().replace(/[-\s]/g, "");
}
