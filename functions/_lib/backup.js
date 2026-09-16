// Dated backup versions (P2-7) with server-side restore.
//
// Layout (one backup = one id, `<kind>_<base36 ts>`):
//   bak:<id>:meta        { id, kind, savedAt, label, fields, counts, profileKeys,
//                          photos: { photoKey: sha256 }, profiles: { profileKey: sha256 } }
//   bak:<id>:f:<field>   the field value as stored (photos externalized, tombstones kept)
//   bakblob:<sha256>     photo data URI / profile JSON, content-addressed and SHARED
//                        between versions, so ten versions of a 40 MiB dataset cost
//                        ~40 MiB, not 400. Blobs no longer referenced by any retained
//                        version are garbage-collected after each prune.
// Kinds: manual (Settings > Create Backup), auto (daily, from the admin session),
// safety (taken automatically right before a restore or a clear-history).
// Legacy single-slot backups (bak_man:* / bak_auto:*) stay readable + restorable
// as ids `legacy:bak_man` / `legacy:bak_auto`.
//
// Restore = safety snapshot of the live data, then write every field of the
// chosen version (fresh versions, so open clients get a 409 and re-sync), every
// photo key, every profile, and drop photo keys the restored arrays no longer
// reference. KV has no transactions: the safety snapshot is the rollback.

import { FIELDS, readField, prepareWrite, commitWrites } from "./store.js";
import { PHOTO_FIELDS, externalize, photoKeysOf, loadPhotos, inlinePhotos, isDataUri } from "./photos.js";

export const RETENTION = { manual: 5, auto: 5, safety: 3 };
// Arrays PUT /api/data merges by id (a stale client copy cannot overwrite them
// wholesale, so a restore has to stamp them, see restoreBackup).
export const ID_MERGED = ["checkouts", "adminRequests", "equipmentRequests", "invoices"];
// Daily auto-backup: one per 20 h, judged SERVER-side from the newest auto
// version, so every new device / cleared browser cannot mint another "Daily"
// version and evict the real older ones (the client's localStorage gate is only
// a hint).
export const AUTO_MIN_GAP_MS = 20 * 3600 * 1000;
export function autoBackupDue(list, now = Date.now(), gapMs = AUTO_MIN_GAP_MS) {
  const latest = (list || []).filter(b => b && b.kind === "auto").sort((a, b) => b.savedAt - a.savedAt)[0];
  if (!latest) return { due: true, latest: null };
  return { due: now - latest.savedAt >= gapMs, latest };
}
const PREFIX = "bak:";
const BLOB = "bakblob:";
const LEGACY = { "legacy:bak_man": { prefix: "bak_man", kind: "manual" }, "legacy:bak_auto": { prefix: "bak_auto", kind: "auto" } };

export async function sha256(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export function backupId(kind, ts = Date.now()) { return `${kind}_${ts.toString(36)}`; }

async function listAll(kv, prefix) {
  const names = [];
  let cursor;
  do {
    const page = await kv.list({ prefix, cursor });
    names.push(...page.keys.map(k => k.name));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return names;
}

// ── create ──────────────────────────────────────────────────────────────────
export async function createBackup(kv, { kind = "manual", label = "" } = {}) {
  if (!RETENTION[kind]) throw new Error("bad backup kind");
  const id = backupId(kind);
  const savedAt = Date.now();
  const existingBlobs = new Set((await listAll(kv, BLOB)).map(n => n.slice(BLOB.length)));
  const blobWrites = new Map(); // hash -> data
  const photos = {};            // photoKey -> hash
  const counts = {};
  const fieldOps = [];

  for (const f of FIELDS) {
    const { raw, value } = await readField(kv, f);
    let stored = raw ?? "null";
    if (PHOTO_FIELDS[f] && Array.isArray(value)) {
      // Unmigrated inline photos go to blobs too, so a backup is always the small form.
      const { entries, photos: inline } = externalize(f, value);
      for (const p of inline) { const h = await sha256(p.data); photos[p.key] = h; if (!existingBlobs.has(h)) blobWrites.set(h, p.data); }
      const blobs = await loadPhotos(f, entries, k => kv.get(k));
      for (const [k, data] of Object.entries(blobs)) { const h = await sha256(data); photos[k] = h; if (!existingBlobs.has(h)) blobWrites.set(h, data); }
      stored = JSON.stringify(entries);
      counts[f] = entries.length;
    } else if (Array.isArray(value)) counts[f] = value.length;
    fieldOps.push([`${PREFIX}${id}:f:${f}`, stored]);
  }

  const profileKeys = await listAll(kv, "profile_");
  const profiles = {};
  for (const k of profileKeys) {
    const raw = await kv.get(k);
    if (raw == null) continue;
    const h = await sha256(raw); profiles[k] = h;
    if (!existingBlobs.has(h)) blobWrites.set(h, raw);
  }

  // blobs first, then fields, then meta (a reader only trusts a backup with a meta)
  await Promise.all([...blobWrites].map(([h, data]) => kv.put(BLOB + h, data)));
  await Promise.all(fieldOps.map(([k, v]) => kv.put(k, v)));
  const meta = { id, kind, savedAt, label: String(label || "").slice(0, 80), fields: FIELDS, counts, profileKeys: Object.keys(profiles), photos, profiles, photoCount: Object.keys(photos).length };
  await kv.put(`${PREFIX}${id}:meta`, JSON.stringify(meta));
  const pruned = await pruneBackups(kv);
  return { ...publicMeta(meta), pruned };
}

function publicMeta(m) {
  const { photos, profiles, ...rest } = m;
  return { ...rest, photoCount: m.photoCount ?? Object.keys(photos || {}).length, profileCount: Object.keys(profiles || {}).length };
}

// ── list ────────────────────────────────────────────────────────────────────
export async function listBackups(kv) {
  const names = (await listAll(kv, PREFIX)).filter(n => n.endsWith(":meta"));
  const metas = (await Promise.all(names.map(n => kv.get(n, "json")))).filter(Boolean).map(publicMeta);
  for (const [id, { prefix, kind }] of Object.entries(LEGACY)) {
    const m = await kv.get(`${prefix}:meta`, "json");
    if (m && m.savedAt) metas.push({ id, kind, savedAt: m.savedAt, label: "legacy single slot", legacy: true, fields: m.fields || FIELDS, counts: {}, photoCount: null, profileCount: (m.profileKeys || []).length });
  }
  return metas.sort((a, b) => b.savedAt - a.savedAt);
}

async function readMeta(kv, id) {
  if (LEGACY[id]) {
    const { prefix, kind } = LEGACY[id];
    const m = await kv.get(`${prefix}:meta`, "json");
    return m ? { id, kind, savedAt: m.savedAt, legacy: true, prefix, fields: m.fields || FIELDS, photos: {}, profiles: {} } : null;
  }
  return kv.get(`${PREFIX}${id}:meta`, "json");
}

// Field value of a backup as stored (string). Legacy slots keep inline photos.
async function readBackupField(kv, meta, f) {
  const key = meta.legacy ? `${meta.prefix}:f:${f}` : `${PREFIX}${meta.id}:f:${f}`;
  const raw = await kv.get(key);
  if (raw == null) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function readBackupProfiles(kv, meta) {
  if (meta.legacy) return (await kv.get(`${meta.prefix}:profiles`, "json")) || {};
  const out = {};
  for (const [k, h] of Object.entries(meta.profiles || {})) {
    const raw = await kv.get(BLOB + h);
    if (raw == null) { out[k] = null; continue; }
    try { out[k] = JSON.parse(raw); } catch { out[k] = { photo: raw }; }
  }
  return out;
}

// ── read one (download): the whole dataset with photos re-inlined ───────────
export async function getBackup(kv, id) {
  const meta = await readMeta(kv, id);
  if (!meta) return null;
  const out = { id: meta.id, kind: meta.kind, savedAt: meta.savedAt, label: meta.label || "" };
  for (const f of meta.fields) {
    let v = await readBackupField(kv, meta, f);
    if (PHOTO_FIELDS[f] && Array.isArray(v) && !meta.legacy) {
      const blobs = {};
      for (const k of photoKeysOf(f, v)) { const h = meta.photos[k]; if (h) { const d = await kv.get(BLOB + h); if (isDataUri(d)) blobs[k] = d; } }
      v = inlinePhotos(f, v, blobs);
    }
    out[f] = v;
  }
  out._profiles = await readBackupProfiles(kv, meta);
  return out;
}

// ── restore ─────────────────────────────────────────────────────────────────
export async function restoreBackup(kv, id, { safety = true } = {}) {
  const meta = await readMeta(kv, id);
  if (!meta) return { ok: false, error: "backup not found" };
  let safetyId = null;
  if (safety) safetyId = (await createBackup(kv, { kind: "safety", label: `before restore ${id}` })).id;

  // 1. photos referenced by the backup (blob -> live photo key)
  const photoOps = [];
  for (const [k, h] of Object.entries(meta.photos || {})) {
    photoOps.push(kv.get(BLOB + h).then(d => (isDataUri(d) ? kv.put(k, d) : null)));
  }
  await Promise.all(photoOps);

  // 2. fields (legacy inline photos get externalized by prepareWrite)
  const prepared = [];
  const restoredArrays = {};
  for (const f of meta.fields) {
    const v = await readBackupField(kv, meta, f);
    const p = prepareWrite(f, v);
    if (p.size) return { ok: false, error: p.size.error, safetyId };
    prepared.push(p);
    if (PHOTO_FIELDS[f]) restoredArrays[f] = p.entries;
  }
  // restoredAt: a device that loaded BEFORE the restore still holds records the
  // restored version does not have; when it re-saves, the id-merges drop the
  // ones that predate this moment instead of resurrecting them (same rule as
  // clearedAt for clear-history; functions/_lib/merge.js).
  const restoredAt = Date.now();
  const extraMeta = {};
  for (const f of ID_MERGED) extraMeta[f] = { restoredAt };
  const versions = await commitWrites(kv, prepared, {}, extraMeta);

  // 3. profiles
  const profiles = await readBackupProfiles(kv, meta);
  await Promise.all(Object.entries(profiles).map(([k, prof]) => prof ? kv.put(k, JSON.stringify(prof)) : null).filter(Boolean));

  // 4. drop live photo keys no restored array references (orphans from the
  //    previous live state); the safety snapshot still has them.
  let orphans = 0;
  for (const f of Object.keys(PHOTO_FIELDS)) {
    const keep = new Set(photoKeysOf(f, restoredArrays[f]));
    const live = await listAll(kv, `photo:${f}:`);
    const drop = live.filter(k => !keep.has(k));
    await Promise.all(drop.map(k => kv.delete(k)));
    orphans += drop.length;
  }
  return { ok: true, id, savedAt: meta.savedAt, safetyId, versions, orphanPhotosRemoved: orphans };
}

// ── off-site export (P2-7) ──────────────────────────────────────────────────
// Optional: with an R2 bucket bound as BACKUPS (wrangler.toml / Pages settings)
// every version is also written there as one JSON object, photos inline, under
//   psr/<kind>/<YYYY-MM-DD>/<id>.json
// so a KV-wide accident is recoverable from outside KV. No binding = no-op, so
// nothing here can fail a backup; the result says which happened.
export function exportKey(meta) {
  const day = new Date(meta.savedAt || Date.now()).toISOString().slice(0, 10);
  return `psr/${meta.kind || "manual"}/${day}/${meta.id}.json`;
}
export async function exportBackup(env, kv, id) {
  const bucket = env && env.BACKUPS;
  if (!bucket || typeof bucket.put !== "function") return { ok: false, skipped: "no R2 binding" };
  const snap = await getBackup(kv, id);
  if (!snap) return { ok: false, error: "backup not found" };
  const key = exportKey({ id, kind: snap.kind || "manual", savedAt: snap.savedAt || Date.now() });
  const body = JSON.stringify(snap);
  try {
    await bucket.put(key, body, { httpMetadata: { contentType: "application/json" } });
    return { ok: true, key, bytes: body.length };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

// ── retention + blob GC ─────────────────────────────────────────────────────
export async function pruneBackups(kv) {
  const names = (await listAll(kv, PREFIX)).filter(n => n.endsWith(":meta"));
  const metas = (await Promise.all(names.map(n => kv.get(n, "json")))).filter(Boolean).sort((a, b) => b.savedAt - a.savedAt);
  const perKind = {};
  const keep = [], drop = [];
  for (const m of metas) {
    perKind[m.kind] = (perKind[m.kind] || 0) + 1;
    (perKind[m.kind] <= (RETENTION[m.kind] || 1) ? keep : drop).push(m);
  }
  for (const m of drop) {
    const keys = await listAll(kv, `${PREFIX}${m.id}:`);
    await Promise.all(keys.map(k => kv.delete(k)));
  }
  const referenced = new Set();
  for (const m of keep) { for (const h of Object.values(m.photos || {})) referenced.add(h); for (const h of Object.values(m.profiles || {})) referenced.add(h); }
  const blobs = await listAll(kv, BLOB);
  const gc = blobs.filter(n => !referenced.has(n.slice(BLOB.length)));
  await Promise.all(gc.map(n => kv.delete(n)));
  return { removed: drop.map(m => m.id), blobsFreed: gc.length, kept: keep.length };
}
