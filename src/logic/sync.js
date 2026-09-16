// Client-side conflict handling for PUT /api/data (P1-13).
//
// The server keeps a version per whole-value field (equipment, jobs, employees,
// reports, productionCompanies, KPI, settings...). A PUT carries the versions the
// client loaded; when another device wrote the field in between the server
// answers 409 instead of overwriting. The client then re-GETs, re-applies its own
// delta on top of the fresh server copy (this module) and retries once.
//
// Pure functions, unit-tested in sync.test.js.

// Fields the server version-checks. Mirrors functions/_lib/versions.js VERSIONED.
export const VERSIONED_FIELDS = [
  "equipment", "jobs", "employees", "reports", "productionCompanies", "companyName",
  "timezone", "timeFormat", "kpiConfig", "punishments", "kpiEvents",
  "photoVerification", "navOrder", "verificationConfig", "invoicePresets", "chatEnabled",
  "theme",
];

// { field: version } for the fields present in `payload` (only those the server
// checks), taken from the versions the client currently holds.
export function versionsFor(payload, versions) {
  const out = {};
  for (const f of VERSIONED_FIELDS) if (payload[f] !== undefined) out[f] = versions[f] ?? null;
  return out;
}

const hasIds = (arr) => Array.isArray(arr) && arr.length > 0 && arr.every(e => e && typeof e === "object" && e.id != null);
const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);

// Three-way merge of ONE field: what this client changed since `base` (the copy
// it loaded / last saved) is re-applied onto `server` (the fresh copy).
//  - arrays of { id } records: records this client added or edited win; records
//    it deleted are dropped; everything it did not touch takes the server copy
//    (so another device's edits to other records survive). Server order first,
//    local additions appended.
//  - anything else (scalars, objects, arrays without ids such as navOrder): the
//    local value wins only if it actually changed vs base, else the server value.
export function rebase(base, local, server) {
  if (hasIds(local) && (hasIds(server) || (Array.isArray(server) && server.length === 0))) {
    const B = new Map((Array.isArray(base) ? base : []).filter(e => e && e.id != null).map(e => [e.id, e]));
    const L = new Map(local.map(e => [e.id, e]));
    const out = [];
    const seen = new Set();
    for (const s of server) {
      if (!s || s.id == null) { out.push(s); continue; }
      seen.add(s.id);
      const l = L.get(s.id), b = B.get(s.id);
      if (l === undefined) { if (b !== undefined) continue; out.push(s); continue; } // deleted locally
      if (b === undefined || !same(l, b)) out.push(l); else out.push(s);          // added/edited locally wins
    }
    for (const l of local) {
      if (seen.has(l.id)) continue;
      const b = B.get(l.id);
      if (b === undefined || !same(l, b)) out.push(l); // new locally, or edited locally after the server dropped it
      // untouched locally and gone on the server: stays gone
    }
    return out;
  }
  if (base === undefined) return local;
  return same(local, base) ? server : local;
}

// Re-apply every conflicting field of `payload` onto the fresh `serverData`.
// Returns { payload: retry payload with fresh versions, merged: { field: value } }.
export function rebasePayload(payload, bases, serverData, conflicts) {
  const merged = {};
  const next = { ...payload };
  for (const f of conflicts) {
    if (payload[f] === undefined) continue;
    merged[f] = rebase(bases[f], payload[f], serverData[f]);
    next[f] = merged[f];
  }
  next._v = versionsFor(next, serverData._v || {});
  return { payload: next, merged };
}

// ── Failed-save snapshot ─────────────────────────────────────────────────────
// A PUT that failed (network blip) is retried later. The retry must carry the
// versions and the bases OF THE FAILED ATTEMPT, not whatever the client holds by
// then: a remote sync in between refreshes versionsRef / lastSavedRef, and a
// retry built from those would pass the server's stale check with a payload
// that predates the other device's write, silently erasing it.
export function pendingSave(payload, versions, lastSaved) {
  const bases = {};
  for (const f of Object.keys(payload || {})) {
    if (f === "_v" || f === "_invoiceEmployeeId") continue;
    bases[f] = lastSaved ? lastSaved[f] : undefined;
  }
  return { payload, versions: versionsFor(payload || {}, versions || {}), bases };
}

// ── Remote copy arriving over a dirty field ──────────────────────────────────
// When another device's snapshot lands (WebSocket data_saved, BroadcastChannel,
// the 409 re-GET) a field this client has edited but not yet saved must not be
// replaced wholesale: the local edits are re-applied on top of the server copy
// (rebase). Returns the value to put in state; when the rebase adds nothing the
// server copy itself is returned so the field reads as clean.
export function adoptRemote({ base, local, server }) {
  if (base === undefined || local === base) return server;
  const merged = rebase(base, local, server);
  return same(merged, server) ? server : merged;
}
