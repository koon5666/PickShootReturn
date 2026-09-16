// KV storage layer shared by /api/data, /api/photo, /api/backup, /api/migrate-photos,
// /api/history-clear. Owns: the FIELDS list, per-field versions (metadata), photo
// externalization on write and re-inlining on read. Every function takes the KV
// binding so it can run against tests/fakekv.js in unit tests.

import { PHOTO_FIELDS, externalize, photoKeysOf, inlinePhotos, loadPhotos, countInline, photoKey, isDataUri, storedSigs } from "./photos.js";
import { newVersion } from "./versions.js";
import { checkSize } from "./kvlimits.js";

// Every top-level field the app reads/writes. Each is stored under its own KV key.
// Keep this in sync with the app's DATA_FIELDS (src/App.jsx).
export const FIELDS = [
  "equipment", "jobs", "checkouts", "employees", "reports", "productionCompanies",
  "invoices", "companyName", "equipmentRequests", "adminRequests", "adminPin",
  "lineGroupId", "timezone", "timeFormat", "kpiConfig", "punishments", "kpiEvents",
  "photoVerification", "navOrder", "verificationConfig", "invoicePresets", "chatEnabled",
  // auth track (P0-2 / P2-6): server-owned, never sent by the client, backed up like the rest
  "adminPinHash", "staff", "calendarToken", "auditLog",
  "theme", // { style, palette } per tenant (P3-8)
];

// Fields whose photos the client renders immediately on boot, so GET re-inlines
// them. checkouts + resolved adminRequests stay lean (lazy /api/photo).
export const INLINE_ON_GET = new Set(["equipment", "reports"]);

// ── read ────────────────────────────────────────────────────────────────────
// Raw field read: { raw: string|null, value: any, v: string|null, meta: object }.
// meta carries the version and, for checkouts, `clearedAt` (see history-clear).
export async function readField(kv, field) {
  const { value: raw, metadata } = await kv.getWithMetadata(field);
  let value = null;
  if (raw != null) { try { value = JSON.parse(raw); } catch { value = null; } }
  const meta = metadata && typeof metadata === "object" ? metadata : {};
  return { raw, value, v: meta.v || null, meta };
}

export async function readAllFields(kv) {
  const rows = await Promise.all(FIELDS.map(f => readField(kv, f)));
  const values = {}, versions = {};
  FIELDS.forEach((f, i) => { values[f] = rows[i].value; versions[f] = rows[i].v; });
  return { values, versions };
}

// Put every photo of `field` back inline (equipment / reports / pending admin
// requests). Missing photo keys leave the marker so nothing is misreported.
export async function inlineField(kv, field, arr, filter) {
  if (!Array.isArray(arr) || !PHOTO_FIELDS[field]) return arr;
  const subset = filter ? arr.filter(filter) : arr;
  const blobs = await loadPhotos(field, subset, k => kv.get(k));
  if (!Object.keys(blobs).length) return arr;
  const inlined = inlinePhotos(field, arr, blobs);
  return inlined;
}

// One photo: its own key first, inline (unmigrated) fallback second.
export async function getPhoto(kv, field, id, index) {
  const own = await kv.get(photoKey(field, id, index));
  if (isDataUri(own)) return own;
  const { value } = await readField(kv, field);
  if (!Array.isArray(value)) return null;
  const e = value.find(x => x && x.id === id);
  if (!e) return null;
  if (index == null) return isDataUri(e.photo) ? e.photo : null;
  return Array.isArray(e.photos) && isDataUri(e.photos[index]) ? e.photos[index] : null;
}

// ── write ───────────────────────────────────────────────────────────────────
// Prepare a field write: externalize photos, serialize, size-check. Returns
// { field, entries, str, photos, size } where size is null when fine. `existing`
// (the KV array, optional) lets unchanged inline photos skip their key write.
export function prepareWrite(field, value, existing) {
  const { entries, photos } = externalize(field, value, Infinity, existing ? storedSigs(field, existing) : null);
  const str = JSON.stringify(entries === undefined ? null : entries);
  return { field, entries, str, photos, size: checkSize(field, str) };
}

// Commit prepared writes: photo keys first (so an array never references a
// missing key), then the values with a fresh version in metadata. `metaByField`
// carries existing metadata (e.g. checkouts.clearedAt) forward; `extraMeta` adds
// to it. Returns the { field: version } map written.
export async function commitWrites(kv, prepared, metaByField = {}, extraMeta = {}) {
  const photoOps = [];
  for (const p of prepared) for (const ph of p.photos) photoOps.push(kv.put(ph.key, ph.data));
  await Promise.all(photoOps);
  const out = {};
  await Promise.all(prepared.map(p => {
    const v = newVersion();
    out[p.field] = v;
    const { v: _old, ...carry } = metaByField[p.field] || {};
    return kv.put(p.field, p.str, { metadata: { ...carry, ...(extraMeta[p.field] || {}), v } });
  }));
  return out;
}

// Convenience: write one field (externalizing photos), return its new version.
// Existing metadata (clearedAt) is carried forward; `extraMeta` overrides it.
export async function writeField(kv, field, value, extraMeta) {
  const p = prepareWrite(field, value);
  if (p.size) throw Object.assign(new Error(p.size.error), { size: p.size });
  const { meta } = await readField(kv, field);
  const vs = await commitWrites(kv, [p], { [field]: meta }, extraMeta ? { [field]: extraMeta } : {});
  return vs[field];
}

// Delete every photo key an array refers to (clear history, prune).
export async function deletePhotoKeys(kv, field, arr) {
  const keys = photoKeysOf(field, arr);
  await Promise.all(keys.map(k => kv.delete(k)));
  return keys.length;
}

// Delete every `photo:<field>:` key in KV (belt and braces for clear history:
// catches keys whose record was already dropped from the array).
export async function deletePhotoPrefix(kv, field) {
  let n = 0, cursor;
  do {
    const page = await kv.list({ prefix: `photo:${field}:`, cursor });
    await Promise.all(page.keys.map(k => kv.delete(k.name)));
    n += page.keys.length;
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return n;
}

// ── migration ───────────────────────────────────────────────────────────────
// Move up to `limit` inline photos of one field into their own keys. Idempotent
// and resumable: photo keys are written first, then the array; a crash between
// the two only means the next run rewrites the same keys. Returns progress.
export async function migrateField(kv, field, limit = 20) {
  const { value, v } = await readField(kv, field);
  const before = countInline(field, value);
  if (!before) return { field, moved: 0, remaining: 0, records: Array.isArray(value) ? value.length : 0 };
  const { entries, photos } = externalize(field, value, limit);
  await Promise.all(photos.map(ph => kv.put(ph.key, ph.data)));
  const str = JSON.stringify(entries);
  const size = checkSize(field, str);
  if (size) throw Object.assign(new Error(size.error), { size });
  // Re-read right before the array write: a PUT that landed while the photo keys
  // were being written (a new checkout, an approval) must not be overwritten by
  // the copy read above. That PUT externalized the field itself on the way in
  // (prepareWrite), so this batch simply yields; the caller loops until
  // `remaining` is 0 and the keys already written are reused.
  const fresh = await readField(kv, field);
  if (fresh.v !== v) return { field, moved: 0, remaining: countInline(field, fresh.value), records: Array.isArray(fresh.value) ? fresh.value.length : 0, retry: true };
  // keep the version: migration is not a user edit, open clients stay valid
  await kv.put(field, str, { metadata: { ...fresh.meta, v: v || newVersion() } });
  return { field, moved: photos.length, remaining: countInline(field, entries), records: entries.length, bytes: str.length };
}

export const PHOTO_FIELD_NAMES = Object.keys(PHOTO_FIELDS);
