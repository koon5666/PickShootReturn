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
export function mergePhotoArray(incoming, existing, { clearedAt = 0 } = {}) {
  const exMap = new Map((existing || []).map(e => [e.id, e]));
  if (clearedAt) incoming = incoming.filter(e => !(e && !exMap.has(e.id) && typeof e.ts === "number" && e.ts < clearedAt));
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
export function mergeById(incoming, existing) {
  const exMap = new Map((existing || []).map(e => [e.id, e]));
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
export function mergeInvoices(incoming, existing, employeeId) {
  const kvList = existing || [];
  const existingMap = new Map(kvList.map(e => [e.id, e]));
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
