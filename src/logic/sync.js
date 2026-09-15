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
  "adminPin", "timezone", "timeFormat", "kpiConfig", "punishments", "kpiEvents",
  "photoVerification", "navOrder", "verificationConfig", "invoicePresets", "chatEnabled",
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
