// Save-payload rules shared by the debounced save effect, the "Save" buttons and
// the offline reconnect (P1-14). One place decides which top-level fields go to
// PUT /api/data, so the reconnect can push exactly the edits made offline
// (the "dirty delta") before the page is allowed to reload.
//
// Rules (unchanged from the original save effect, now testable):
//   safeSave(key)  = field was loaded from KV (kvLoaded) OR differs from the
//                    post-load snapshot (the user changed it)
//   changed(key)   = safeSave AND reference !== lastSaved[key]
//   invoices       = an employee sends only their own; admin sends all
//   lineGroupId    = null means "leave KV alone"
//   employee       = only the fields the server lets a crew session write
//                    (functions/_lib/roles.js EMPLOYEE_PUT_FIELDS, the same list
//                    the server enforces: one stray field would 403 the whole PUT
//                    and take the allowed ones down with it)
// Pure; unit-tested in offline.test.js.
import { EMPLOYEE_PUT_FIELDS } from "../../functions/_lib/roles.js";

export const SAVE_FIELDS = ["equipment", "jobs", "checkouts", "employees", "reports", "productionCompanies", "invoices", "companyName", "equipmentRequests", "adminRequests", "timezone", "timeFormat", "kpiConfig", "punishments", "kpiEvents", "photoVerification", "navOrder", "verificationConfig", "invoicePresets", "chatEnabled", "theme"];

// state: { field: value } (may include lineGroupId). Returns { payload, sent }:
// payload is what to PUT, sent the per-field values to record in lastSaved once
// the PUT succeeds (they differ for invoices, where the payload is filtered).
export function buildSavePayload(state, { lastSaved = {}, kvLoaded = new Set(), snapshot = null, user = null } = {}) {
  const safeSave = (key, val) => kvLoaded.has(key) || (snapshot !== null && val !== snapshot[key]);
  const changed = (key, val) => safeSave(key, val) && lastSaved[key] !== val;
  const isEmployee = user != null && user.role !== "admin";
  const payload = {}, sent = {};
  for (const key of SAVE_FIELDS) {
    if (!(key in state)) continue;
    if (isEmployee && !EMPLOYEE_PUT_FIELDS.has(key)) continue; // server-rejected for a crew session
    const val = state[key];
    if (!changed(key, val)) continue;
    if (key === "invoices") {
      payload.invoices = isEmployee ? (val || []).filter(inv => inv.employeeId === user.id) : val;
      payload._invoiceEmployeeId = isEmployee ? user.id : "admin";
    } else {
      payload[key] = val;
    }
    sent[key] = val;
  }
  if (!isEmployee && "lineGroupId" in state && state.lineGroupId !== null && changed("lineGroupId", state.lineGroupId)) {
    payload.lineGroupId = state.lineGroupId;
    sent.lineGroupId = state.lineGroupId;
  }
  return { payload, sent };
}

// Names of the fields with unsaved edits (for the offline banner + reconnect gate).
export function dirtyFields(state, opts) {
  return Object.keys(buildSavePayload(state, opts).sent);
}

// Profile PUTs made while offline. One entry per employee, newest wins, order of
// first arrival kept so the drain is predictable.
export function queueProfile(queue, empId, profile) {
  const list = Array.isArray(queue) ? queue.filter(q => q && q.empId !== empId) : [];
  const idx = Array.isArray(queue) ? queue.findIndex(q => q && q.empId === empId) : -1;
  const entry = { empId, profile, ts: Date.now() };
  if (idx < 0) return [...list, entry];
  list.splice(idx, 0, entry);
  return list;
}

// Drain the queue with `put(empId, profile) -> Promise<{ok}>`. Stops at the first
// failure and returns what is still pending (so nothing is dropped).
export async function drainProfileQueue(queue, put) {
  const rest = [...(queue || [])];
  while (rest.length) {
    const q = rest[0];
    let ok = false;
    try { const r = await put(q.empId, q.profile); ok = !!(r && r.ok); } catch { ok = false; }
    if (!ok) break;
    rest.shift();
  }
  return rest;
}
