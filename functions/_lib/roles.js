// Role rules for PUT /api/data (P0-2). Pure functions, unit-tested in roles.test.js.
//
//   admin     may write any client field (credentials are protected separately,
//             see accounts.protectEmployees).
//   employee  may write only the fields below, and inside them only records that
//             belong to the session: a foreign record already in KV is kept as
//             KV has it (the client always sends the whole array it loaded), a
//             foreign record KV does not know is dropped, and a record with no
//             owner yet is stamped with the session id.
//   server-owned fields are never written through PUT by anyone.

export const EMPLOYEE_PUT_FIELDS = new Set(["checkouts", "equipmentRequests", "adminRequests", "invoices", "reports", "productionCompanies"]);
export const SERVER_OWNED_FIELDS = new Set(["adminPinHash", "staff", "calendarToken", "auditLog"]);
// Which key names the owner of a record, per field. productionCompanies uses
// addedBy (P2-9: a shared house added by the admin has none, so crew cannot
// rename or re-address it; the one they added themselves they may edit).
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
  for (const e of incoming || []) {
    if (!e || typeof e !== "object") continue;
    const prev = e.id != null ? kv.get(e.id) : undefined;
    if (prev && ownerOf(prev, ownerKey) !== ownerId) { out.push(prev); continue; } // foreign record: keep what KV has
    const owner = ownerOf(e, ownerKey);
    if (owner === ownerId) { out.push(e); continue; }
    if (owner == null || owner === "") { out.push({ ...e, [ownerKey]: ownerId }); continue; } // new, unowned: it is theirs
    // claims to be someone else's and KV does not know it: dropped
  }
  return out;
}

// Fields a crew member may FILL IN on a record they do not own, when KV has
// them empty (productionCompanies: a house auto-registered from a booking has no
// billing address; the crew invoicing it needs one on the document). Existing
// values are never overwritten, the name never changes.
export const COMPANY_FILLABLE = ["address", "taxId", "branch"];
const blank = (v) => v == null || String(v).trim() === "";
export function fillEmpty(prev, inc, fields) {
  if (!prev || !inc || !fields || !fields.length) return prev;
  let out = prev;
  for (const f of fields) {
    if (blank(prev[f]) && !blank(inc[f])) { if (out === prev) out = { ...prev }; out[f] = String(inc[f]).trim(); }
  }
  return out;
}

// Whole-value field written by an employee (productionCompanies): apply the
// ownership filter, then bring back every KV record the payload left out unless
// it is the session's own (that one was deleted on purpose). `fillable` lists
// the empty fields of a foreign record the session may fill in (see fillEmpty).
export function mergeOwnedWhole(incoming, existing, ownerId, ownerKey, { fillable = [] } = {}) {
  let kept = restrictOwn(incoming, existing, ownerId, ownerKey);
  if (fillable.length) {
    const incById = new Map((incoming || []).filter(e => e && e.id != null).map(e => [e.id, e]));
    kept = kept.map(e => (e && e.id != null && (e[ownerKey] ?? null) !== ownerId) ? fillEmpty(e, incById.get(e.id), fillable) : e);
  }
  const ids = new Set(kept.filter(e => e && e.id != null).map(e => e.id));
  for (const e of existing || []) {
    if (!e || e.id == null || ids.has(e.id)) continue;
    if (ownerOf(e, ownerKey) === ownerId) continue; // own record removed by the session
    kept.push(e);
  }
  return kept;
}

// Invoices from an employee: only their own (an unowned one is stamped with the
// session id); a record whose id belongs to someone else in KV is dropped so the
// per-employee invoice merge never sees a foreign id.
export function ownInvoices(incoming, existing, ownerId) {
  const kv = new Map((existing || []).filter(e => e && e.id != null).map(e => [e.id, e]));
  const out = [];
  for (const i of incoming || []) {
    if (!i || typeof i !== "object") continue;
    const prev = i.id != null ? kv.get(i.id) : undefined;
    if (prev && prev.employeeId !== ownerId) continue;
    if (i.employeeId === ownerId) out.push(i);
    else if (i.employeeId == null || i.employeeId === "") out.push({ ...i, employeeId: ownerId });
  }
  return out;
}
