// Server-side array merge rules used by PUT /api/data (functions/api/data.js).
// Pure functions, no KV access: unit-tested in merge.test.js.
//
// Files under functions/_lib are shared helpers, not routes (Pages Functions
// only routes files that do not start with an underscore).
//
// Tombstones (P0-5): a record with `_deleted: true` is a deletion that must stick.
// Every merge here honours it: once KV holds a tombstone for an id, an incoming
// live copy of that id (a device that loaded before the delete and re-saves) can
// NOT resurrect it. An incoming tombstone always wins over a live KV copy.

import { isDataUri, stripInline } from "./photos.js";
export { isDataUri };

// Lean boot: strip an inline base64 photo to `null` + a `hasPhoto` marker.
export const stripPhoto = stripInline;

export const isTombstone = (e) => !!(e && e._deleted);

// ── One id, one record (security re-review 2026-09) ──────────────────────────
// Every merge below keys on `id`, so an array where one id appears twice is
// ambiguous: a crew PUT could inflate a field with copies of one record (KV grew
// per request, duplicated pick events double-counted "still out"), and real data
// already held a few collisions (a batch return mints "co<ts><eqId>" per loan,
// so one item returned on two loans in the same millisecond shares an id).
// uniqueIds() makes the invariant hold without losing anything:
//   - copies that are IDENTICAL apart from their photo payload / markers collapse
//     to one (the copy that carries a photo or marker wins, else the last one);
//   - copies that DIFFER are distinct records: the first keeps the id, the k-th
//     other one is re-keyed "<id>#k" (the suffix photos.js already gives their
//     photo keys) and is never dropped;
//   - entries without an id are left where they are.
// Deterministic and idempotent (a second pass is a no-op), so GET, the PUT
// self-heal of the KV copy and the client agree on every id.
const PHOTO_KEYS = new Set(["photo", "photos", "hasPhoto", "hasPhotos", "photoSig", "photoSigs", "photoKey"]);
const isRec = (e) => !!e && typeof e === "object";
function stable(v) {
  if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}";
  return JSON.stringify(v === undefined ? null : v);
}
function contentSig(e) {
  const c = {};
  for (const k of Object.keys(e)) if (!PHOTO_KEYS.has(k)) c[k] = e[k];
  return stable(c);
}
const carriesPhoto = (e) => isDataUri(e.photo) || !!e.hasPhoto || !!e.hasPhotos || (Array.isArray(e.photos) && e.photos.some(isDataUri));
export function uniqueIds(arr) {
  if (!Array.isArray(arr)) return [];
  const present = new Set(); // every id the input mentions: a re-key never collides with one
  for (const e of arr) if (isRec(e) && e.id != null) present.add(e.id);
  const out = [];
  const taken = new Set();
  const groups = new Map(); // id as sent -> [{ at, sig }] one per distinct record under it
  for (const e of arr) {
    if (!isRec(e) || e.id == null) { out.push(e); continue; }
    const id = e.id;
    let group = groups.get(id);
    if (!group) { groups.set(id, [{ at: out.length, sig: null }]); taken.add(id); out.push(e); continue; }
    const sig = contentSig(e);
    if (group[0].sig === null) group[0].sig = contentSig(out[group[0].at]);
    const same = group.find(g => g.sig === sig);
    if (same) {
      // the same record twice: keep the copy that still carries its photo, else the later one
      if (!(carriesPhoto(out[same.at]) && !carriesPhoto(e))) out[same.at] = e;
      continue;
    }
    let k = 1, rekeyed;
    do { rekeyed = `${id}#${k++}`; } while (taken.has(rekeyed) || present.has(rekeyed));
    taken.add(rekeyed);
    group.push({ at: out.length, sig });
    out.push({ ...e, id: rekeyed });
  }
  return out;
}
// Records only (drops null / non-object entries), each id once.
const records = (arr) => uniqueIds((arr || []).filter(isRec));

// Build a tombstone for a record (keeps the id + a few identifying fields so the
// row stays readable in a backup, drops any photo payload).
export function tombstoneOf(entry, deletedAt = new Date().toISOString()) {
  const { photo, photos, hasPhoto, hasPhotos, ...rest } = entry || {};
  return { ...rest, _deleted: true, deletedAt: rest.deletedAt || deletedAt };
}

// Merge an incoming photo-bearing array (checkouts, adminRequests) against KV.
//  - A real data: URI in the incoming entry always wins (new capture / re-shot).
//  - An incoming lean copy (photo null / hasPhoto marker) keeps the KV photo: the
//    inline data URI when the record is unmigrated, or the `hasPhoto` marker when
//    the photo already lives in its own key (photos.js).
//  - KV-only entries (added by another session, not in this payload) are kept.
//  - KV tombstones win over an incoming live copy; incoming tombstones win.
//  - The transient `hasPhoto` marker is persisted ONLY when it means "photo lives
//    in a photo key" (i.e. KV already had it); a lean marker with no photo behind
//    it is never persisted.
//  - `clearedAt` (ms, from "clear history"): an incoming entry KV does not have
//    whose `ts` is older than the clear is a record a stale device still holds
//    from before the clear. It is dropped instead of resurrected. New captures
//    (ts after the clear) always pass.
// Timestamp of a record for the watermark rules (checkouts ts, requests
// requestedAt/submittedAt, invoices createdAt).
export function recordTime(e) {
  if (!e || typeof e !== "object") return null;
  for (const k of ["ts", "createdAt", "requestedAt", "submittedAt"]) {
    const v = e[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v) { const t = Date.parse(v); if (Number.isFinite(t)) return t; }
  }
  return null;
}
// Drop incoming entries KV does not know whose record time predates `since`
// (a clear-history or a restore): a stale device still holds them from before.
// Entries with no timestamp always pass (never lose a record on a guess).
export function dropStaleUnknown(incoming, exMap, since) {
  if (!since) return incoming;
  return incoming.filter(e => { if (!e || exMap.has(e.id)) return true; const t = recordTime(e); return !(typeof t === "number" && t < since); });
}

export function mergePhotoArray(incoming, existing, { clearedAt = 0, restoredAt = 0 } = {}) {
  incoming = records(incoming); existing = records(existing); // one id, one record (uniqueIds)
  const exMap = new Map(existing.map(e => [e.id, e]));
  incoming = dropStaleUnknown(incoming, exMap, Math.max(clearedAt || 0, restoredAt || 0));
  const incomingIds = new Set(incoming.map(e => e.id));
  const merged = incoming.map(inc => {
    const kv = exMap.get(inc.id);
    if (isTombstone(kv) && !isTombstone(inc)) return kv;      // deletion is final
    if (isTombstone(inc)) return tombstoneOf(inc);
    const { hasPhoto, ...rest } = inc;
    if (isDataUri(inc.photo)) return { ...rest, photo: inc.photo };
    if (kv && isDataUri(kv.photo)) return { ...rest, photo: kv.photo };
    if (kv && kv.hasPhoto) {
      const out = { ...rest, photo: null, hasPhoto: true };
      if (kv.photoSig) out.photoSig = kv.photoSig;
      return out;
    }
    return { ...rest, photo: (kv && kv.photo) ?? inc.photo ?? null };
  });
  // keep KV-only entries (added by another session, not in this payload)
  for (const e of (existing || [])) if (!incomingIds.has(e.id)) merged.push(e);
  return merged;
}

// Id-merge for arrays where concurrent sessions append independently
// (equipmentRequests): incoming entries win for shared ids, KV-only ids are
// preserved so a stale session never erases another session's additions.
// Tombstones as above.
export function mergeById(incoming, existing, { restoredAt = 0 } = {}) {
  incoming = records(incoming); existing = records(existing); // one id, one record (uniqueIds)
  const exMap = new Map(existing.map(e => [e.id, e]));
  incoming = dropStaleUnknown(incoming, exMap, restoredAt);
  const incomingIds = new Set(incoming.map(e => e.id));
  const merged = incoming.map(inc => {
    const kv = exMap.get(inc.id);
    if (isTombstone(kv) && !isTombstone(inc)) return kv;
    if (isTombstone(inc)) return tombstoneOf(inc);
    return inc;
  });
  for (const e of (existing || [])) if (!incomingIds.has(e.id)) merged.push(e);
  return merged;
}

// Invoices: per-employee ownership + write-once paidDate / whTaxDoc.
//  - employeeId (non-admin session): the caller only owns its own invoices; every
//    other employee's invoices (and admin's soft-deletes) are preserved exactly.
//  - admin session: append-only merge across all invoices.
//  - write-once fields set by one device must not be wiped by a stale session.
//  - tombstones as above (KV `_deleted` wins over an incoming live copy).
export function mergeInvoices(incoming, existing, employeeId, { restoredAt = 0 } = {}) {
  incoming = records(incoming); // one id, one record (uniqueIds)
  const kvList = records(existing);
  const existingMap = new Map(kvList.map(e => [e.id, e]));
  incoming = dropStaleUnknown(incoming, existingMap, restoredAt);
  const mergeInv = (inc) => {
    const kv = existingMap.get(inc.id);
    if (!kv) return inc;
    if (isTombstone(kv) && !isTombstone(inc)) return kv;
    return {
      ...inc,
      paidDate: inc.paidDate || kv.paidDate || null,
      whTaxDoc: inc.whTaxDoc || kv.whTaxDoc || null,
    };
  };
  const incomingIds = new Set(incoming.map(e => e.id));
  if (employeeId && employeeId !== "admin") {
    const otherKv = kvList.filter(e => e.employeeId !== employeeId);
    const myKvOnly = kvList.filter(e => e.employeeId === employeeId && !incomingIds.has(e.id));
    return [...incoming.map(mergeInv), ...otherKv, ...myKvOnly];
  }
  return [...incoming.map(mergeInv), ...kvList.filter(e => !incomingIds.has(e.id))];
}

// Strip tombstones from an array before it goes to the client (the client never
// needs to render a deleted gear request / checkout). Invoices are NOT stripped:
// the app's invoice UI already filters `_deleted` itself and relies on seeing them.
export function withoutTombstones(arr) {
  return Array.isArray(arr) ? arr.filter(e => !isTombstone(e)) : arr;
}
