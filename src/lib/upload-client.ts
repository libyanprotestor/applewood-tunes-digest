/** Browser-side helper that pushes a file straight to object storage. */

export type StartResult = {
  mode: "single" | "multipart";
  key: string;
  role: "audio" | "artwork" | "document" | "other";
  filename: string;
  partSize: number;
  url: string | null;
  multipartId: string | null;
  urls: string[];
};

function putWithProgress(url: string, body: Blob, onProgress: (loaded: number) => void) {
  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.getResponseHeader("ETag") ?? "");
      else reject(new Error(`Upload failed (${xhr.status}): ${xhr.responseText.slice(0, 200)}`));
    };
    xhr.onerror = () => reject(new Error("Network error while uploading. Check the bucket's CORS rules."));
    xhr.send(body);
  });
}

export async function pushFile(
  file: File,
  start: StartResult,
  onProgress: (fraction: number) => void,
): Promise<{ parts: { partNumber: number; etag: string }[] }> {
  if (start.mode === "single") {
    await putWithProgress(start.url!, file, (loaded) => onProgress(Math.min(1, loaded / (file.size || 1))));
    return { parts: [] };
  }

  const parts: { partNumber: number; etag: string }[] = [];
  let completed = 0;
  for (let i = 0; i < start.urls.length; i++) {
    const from = i * start.partSize;
    const chunk = file.slice(from, Math.min(from + start.partSize, file.size));
    const etag = await putWithProgress(start.urls[i]!, chunk, (loaded) =>
      onProgress(Math.min(1, (completed + loaded) / (file.size || 1))),
    );
    if (!etag)
      throw new Error(
        "Storage did not return an ETag. Add ETag to the bucket's CORS exposed headers and try again.",
      );
    parts.push({ partNumber: i + 1, etag });
    completed += chunk.size;
    onProgress(Math.min(1, completed / (file.size || 1)));
  }
  return { parts };
}

export function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
