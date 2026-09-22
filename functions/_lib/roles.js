// Role rules for PUT /api/data (P0-2). Pure functions, unit-tested in roles.test.js.
//
//   admin     may write any client field (credentials are protected separately,
//             see accounts.protectEmployees).
//   employee  may write only the fields below, and inside them only records that
//             belong to the session: a foreign record already in KV is kept as
//             KV has it (the client always sends the whole array it loaded), a
//             foreign record KV does not know is dropped, and a record with no
//             owner yet is stamped with the session id.
//             productionCompanies is the exception (2026-09-22): the shared
//             registry is editable by every crew member, see mergeSharedWhole.
//   server-owned fields are never written through PUT by anyone.

export const EMPLOYEE_PUT_FIELDS = new Set(["checkouts", "equipmentRequests", "adminRequests", "invoices", "reports", "productionCompanies"]);
export const SERVER_OWNED_FIELDS = new Set(["adminPinHash", "staff", "calendarToken", "auditLog"]);
// Which key names the owner of a record, per field. productionCompanies uses
// addedBy, which since 2026-09-22 is attribution and delete scope only: crew may
// edit any house, but drop from the shared list only the ones they added.
export const OWNER_KEY = {
  checkouts: "employeeId", equipmentRequests: "employeeId", adminRequests: "employeeId",
  invoices: "employeeId", reports: "employeeId", productionCompanies: "addedBy",
};

// Fields of a PUT body an employee session may not touch (meta keys ignored).
export function forbiddenFields(body, session, allFields) {
  if (!session || session.role === "admin") return [];
  const out = [];
  for (const k of allFields) {
    if (body[k] === undefined) continue;
    if (!EMPLOYEE_PUT_FIELDS.has(k)) out.push(k);
  }
  return out;
}

const ownerOf = (e, key) => (e && typeof e === "object" ? e[key] : undefined);

// Ownership filter for one array. Returns the array the merge step may use.
export function restrictOwn(incoming, existing, ownerId, ownerKey) {
  const kv = new Map((existing || []).filter(e => e && e.id != null).map(e => [e.id, e]));
  const out = [];
  const seen = new Set(); // one id, one record: a payload repeating an id yields one output (the first copy)
  for (const e of incoming || []) {
    if (!e || typeof e !== "object") continue;
    if (e.id != null) { if (seen.has(e.id)) continue; seen.add(e.id); }
    const prev = e.id != null ? kv.get(e.id) : undefined;
    if (prev && ownerOf(prev, ownerKey) !== ownerId) { out.push(prev); continue; } // foreign record: keep what KV has
    const owner = ownerOf(e, ownerKey);
    if (owner === ownerId) { out.push(e); continue; }
    if (owner == null || owner === "") { out.push({ ...e, [ownerKey]: ownerId }); continue; } // new, unowned: it is theirs
    // claims to be someone else's and KV does not know it: dropped
  }
  return out;
}

// productionCompanies written by a crew session (owner lock lifted 2026-09-22).
// A crew member may now edit EVERY company, not only the one they added, so a
// wrong billing address on their own invoice needs no admin. Two guards stay:
//   * attribution is the server's: `addedBy` / `addedByName` of a company KV
//     already holds are never rewritten by the client, and a company KV does not
//     know is stamped with the session id whatever the payload claims;
//   * a company the payload leaves out comes back unless the session added it,
//     so a stale or hostile crew device can drop only its own entries, never the
//     shared registry (the crew UI offers no delete at all).
export function mergeSharedWhole(incoming, existing, ownerId, ownerKey) {
  const kv = new Map((existing || []).filter(e => e && e.id != null).map(e => [e.id, e]));
  const out = [];
  const seen = new Set(); // one id, one record
  for (const e of incoming || []) {
    if (!e || typeof e !== "object") continue;
    if (e.id != null) { if (seen.has(e.id)) continue; seen.add(e.id); }
    const prev = e.id != null ? kv.get(e.id) : undefined;
    if (prev) { // known company: take the edit, keep the server's attribution
      const rec = { ...e };
      for (const attr of [ownerKey, "addedByName"]) {
        if (attr in prev) rec[attr] = prev[attr];       // whoever registered it keeps the credit
        else delete rec[attr];                           // house-registered: stays unattributed
      }
      out.push(rec);
      continue;
    }
    out.push({ ...e, [ownerKey]: ownerId }); // new: it is theirs, whatever it claims
  }
  const ids = new Set(out.filter(e => e && e.id != null).map(e => e.id));
  for (const e of existing || []) {
    if (!e || e.id == null || ids.has(e.id)) continue;
    if (ownerOf(e, ownerKey) === ownerId) continue; // own record removed on purpose
    ids.add(e.id);
    out.push(e);
  }
  return out;
}

// Invoices from an employee: only their own (an unowned one is stamped with the
// session id); a record whose id belongs to someone else in KV is dropped so the
// per-employee invoice merge never sees a foreign id.
export function ownInvoices(incoming, existing, ownerId) {
  const kv = new Map((existing || []).filter(e => e && e.id != null).map(e => [e.id, e]));
  const out = [];
  const seen = new Set(); // one id, one record
  for (const i of incoming || []) {
    if (!i || typeof i !== "object") continue;
    if (i.id != null) { if (seen.has(i.id)) continue; seen.add(i.id); }
    const prev = i.id != null ? kv.get(i.id) : undefined;
    if (prev && prev.employeeId !== ownerId) continue;
    if (i.employeeId === ownerId) out.push(i);
    else if (i.employeeId == null || i.employeeId === "") out.push({ ...i, employeeId: ownerId });
  }
  return out;
}

// Cheap abuse cap for a crew PUT (security re-review 2026-09): the ownership
// filter and uniqueIds stop a payload from rewriting or duplicating records, but
// a crew session may still append its OWN records without limit. No real save
// ever adds more than a handful of new records at once (autosave runs 1.5 s after
// each tap; a big pick is tens of events), so a payload that would add more than
// CREW_MAX_NEW_RECORDS ids KV does not know to one field is refused outright
// (413, nothing written) instead of growing the field toward its size limit.
export const CREW_MAX_NEW_RECORDS = 200;
// Records of `incoming` (after uniqueIds) that would be NEW in `existing`: ids KV
// does not hold, plus every entry without an id (nothing to match it by).
export function newRecordCount(incoming, existing) {
  const known = new Set((existing || []).filter(e => e && typeof e === "object" && e.id != null).map(e => e.id));
  let n = 0;
  for (const e of incoming || []) {
    if (!e || typeof e !== "object") continue;
    if (e.id == null || !known.has(e.id)) n++;
  }
  return n;
}
