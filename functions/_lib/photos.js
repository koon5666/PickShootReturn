// Photo externalization (P0-1). Base64 verification / library photos used to live
// inline in the field arrays (checkouts, adminRequests, reports, equipment); the
// prod `checkouts` value was 20.8 MiB against KV's 25 MiB per-value cap. Every
// `data:` URI now lives in its OWN key and the array entry keeps only a marker:
//
//   checkouts / adminRequests / equipment  { ...entry, photo: null, hasPhoto: true }
//     key  photo:<field>:<recordId>
//   reports                                { ...entry, photos: [null, ...], hasPhotos: true }
//     key  photo:reports:<recordId>:<index>
//
// Pure functions only (no KV): the route decides what to read/write. Every helper
// is idempotent, so an unmigrated record (inline data URI) and a migrated one
// (marker) can coexist in the same array and both converge on the next PUT.

export const isDataUri = (s) => typeof s === "string" && s.startsWith("data:");

// Fields that carry photos, and the shape they use.
export const PHOTO_FIELDS = {
  checkouts: "photo",
  adminRequests: "photo",
  equipment: "photo",
  reports: "photos",
};
export const PHOTO_PREFIX = "photo:";

export function photoKey(field, id, index) {
  return index == null ? `${PHOTO_PREFIX}${field}:${id}` : `${PHOTO_PREFIX}${field}:${id}:${index}`;
}

// Cheap content signature (length + FNV-1a) kept on the marker as `photoSig`
// (reports: `photoSigs[]`). GET re-inlines equipment / report photos, so a client
// sends them back inline on every save; when the signature matches what is
// already stored the photo key is NOT rewritten (saves ~1.5 MiB of KV writes per
// equipment edit on the prod dataset).
export function photoSig(data) {
  let h = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) { h ^= data.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return data.length.toString(36) + ":" + h.toString(36);
}

// { key: sig } for every externalized photo of an array (from its markers).
export function storedSigs(field, arr) {
  const out = new Map();
  if (!Array.isArray(arr)) return out;
  const kind = PHOTO_FIELDS[field];
  for (const e of arr) {
    if (!e || typeof e !== "object" || e.id == null) continue;
    if (kind === "photo") { if (e.hasPhoto && e.photoSig) out.set(photoKey(field, e.id), e.photoSig); }
    else if (e.hasPhotos && Array.isArray(e.photoSigs)) e.photoSigs.forEach((sg, i) => { if (sg) out.set(photoKey(field, e.id, i), sg); });
  }
  return out;
}

// Split an array into { entries, photos } where `entries` carries markers only and
// `photos` is the list of { key, data } to write. Entries that are already
// externalized are passed through untouched (no write needed). Entries with no
// photo at all are untouched as well. `limit` caps how many photos are moved in
// this pass (migration batches); the rest stay inline for the next pass.
// `existingSigs` (Map key -> sig, from storedSigs of the KV array) lets an inline
// photo whose signature already matches the stored key skip the write.
export function externalize(field, arr, limit = Infinity, existingSigs = null) {
  const photos = [];
  if (!Array.isArray(arr)) return { entries: arr, photos };
  const kind = PHOTO_FIELDS[field];
  if (!kind) return { entries: arr, photos };
  let moved = 0;
  const entries = arr.map(e => {
    if (!e || typeof e !== "object" || e.id == null) return e;
    if (kind === "photo") {
      if (!isDataUri(e.photo) || moved >= limit) return e;
      const key = photoKey(field, e.id), sig = photoSig(e.photo);
      moved++;
      if (!existingSigs || existingSigs.get(key) !== sig) photos.push({ key, data: e.photo });
      return { ...e, photo: null, hasPhoto: true, photoSig: sig };
    }
    // reports: photos[] (all of a record's photos move together)
    if (!Array.isArray(e.photos) || !e.photos.some(isDataUri)) return e;
    if (moved + e.photos.filter(isDataUri).length > limit) return e;
    const sigs = Array.isArray(e.photoSigs) ? [...e.photoSigs] : [];
    const slots = e.photos.map((p, i) => {
      if (!isDataUri(p)) return p;
      const key = photoKey(field, e.id, i), sig = photoSig(p);
      moved++;
      if (!existingSigs || existingSigs.get(key) !== sig) photos.push({ key, data: p });
      sigs[i] = sig;
      return null;
    });
    return { ...e, photos: slots, hasPhotos: true, photoSigs: sigs };
  });
  return { entries, photos };
}

// Every photo key an externalized array refers to (for GET re-inlining, backups,
// deletion). Unmigrated inline entries contribute nothing here.
export function photoKeysOf(field, arr) {
  const keys = [];
  if (!Array.isArray(arr)) return keys;
  const kind = PHOTO_FIELDS[field];
  if (!kind) return keys;
  for (const e of arr) {
    if (!e || typeof e !== "object" || e.id == null) continue;
    if (kind === "photo") { if (e.hasPhoto && !isDataUri(e.photo)) keys.push(photoKey(field, e.id)); continue; }
    if (e.hasPhotos && Array.isArray(e.photos)) e.photos.forEach((p, i) => { if (!isDataUri(p)) keys.push(photoKey(field, e.id, i)); });
  }
  return keys;
}

// Put photos back inline from a { key: dataUri } map (missing keys leave the
// marker in place so the client's lazy loader can still try /api/photo).
export function inlinePhotos(field, arr, blobs) {
  if (!Array.isArray(arr)) return arr;
  const kind = PHOTO_FIELDS[field];
  if (!kind) return arr;
  return arr.map(e => {
    if (!e || typeof e !== "object" || e.id == null) return e;
    if (kind === "photo") {
      if (!e.hasPhoto || isDataUri(e.photo)) return e;
      const data = blobs[photoKey(field, e.id)];
      if (!isDataUri(data)) return e;
      const { hasPhoto, ...rest } = e; // photoSig stays: lets the next PUT skip an unchanged photo
      return { ...rest, photo: data };
    }
    if (!e.hasPhotos || !Array.isArray(e.photos)) return e;
    let all = true;
    const photos = e.photos.map((p, i) => {
      if (isDataUri(p)) return p;
      const data = blobs[photoKey(field, e.id, i)];
      if (!isDataUri(data)) { all = false; return p; }
      return data;
    });
    const { hasPhotos, ...rest } = e;
    return all ? { ...rest, photos } : { ...e, photos };
  });
}

// Lean form for the boot payload: a real data URI becomes a marker but nothing is
// written. Used for checkouts + resolved adminRequests (fetched lazily).
export function stripInline(entry) {
  if (entry && isDataUri(entry.photo)) {
    const { photo, ...rest } = entry;
    return { ...rest, photo: null, hasPhoto: true };
  }
  return entry;
}

// Count of photos still stored inline in an array (migration progress).
export function countInline(field, arr) {
  if (!Array.isArray(arr)) return 0;
  const kind = PHOTO_FIELDS[field];
  let n = 0;
  for (const e of arr) {
    if (!e || typeof e !== "object") continue;
    if (kind === "photo") { if (isDataUri(e.photo)) n++; }
    else if (kind === "photos" && Array.isArray(e.photos)) n += e.photos.filter(isDataUri).length;
  }
  return n;
}

// Read every photo key referenced by `arr` through `getter(key) -> Promise<string|null>`
// and return the { key: data } map. Parallel, bounded by `limit` in flight.
export async function loadPhotos(field, arr, getter, limit = 16) {
  const keys = photoKeysOf(field, arr);
  const blobs = {};
  let i = 0;
  const worker = async () => {
    while (i < keys.length) {
      const k = keys[i++];
      try { const v = await getter(k); if (isDataUri(v)) blobs[k] = v; } catch {}
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, keys.length || 1) }, worker));
  return blobs;
}
