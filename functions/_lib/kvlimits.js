// KV value size guard (P0-1). Cloudflare KV rejects values over 25 MiB with an
// opaque 500. We refuse anything over MAX_VALUE_BYTES up front with a readable
// 413 so the client can tell the user instead of retrying forever.
export const KV_HARD_LIMIT = 25 * 1024 * 1024;
export const MAX_VALUE_BYTES = 20 * 1024 * 1024;

const enc = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
export function byteLength(str) {
  if (typeof str !== "string") str = JSON.stringify(str);
  return enc ? enc.encode(str).length : Buffer.byteLength(str, "utf8");
}

export function fmtMiB(bytes) { return (bytes / 1048576).toFixed(1) + " MiB"; }

// Returns null when fine, else a { field, bytes, limit, error } descriptor.
export function checkSize(field, str) {
  const bytes = byteLength(str);
  if (bytes <= MAX_VALUE_BYTES) return null;
  return {
    field, bytes, limit: MAX_VALUE_BYTES,
    error: `"${field}" would be ${fmtMiB(bytes)}, over the ${fmtMiB(MAX_VALUE_BYTES)} storage limit. Nothing was saved. Run the photo migration (Settings > Data) or remove old records.`,
  };
}
