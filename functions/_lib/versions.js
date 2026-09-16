// Per-field optimistic versions (P1-13). Each top-level KV field carries a version
// string in its KV METADATA ({ v }), written atomically with the value. GET returns
// `_v: { field: version }`; a PUT may carry the versions it loaded and the server
// answers 409 when one of them is stale instead of silently overwriting another
// device's write. Pure helpers; the route owns the KV calls.

export function newVersion() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// Fields that are written as a whole value (last-writer-wins) and therefore need
// the stale check. Id-merged arrays (checkouts, adminRequests, equipmentRequests,
// invoices) are already safe to write from a stale session and are not checked.
export const VERSIONED = new Set([
  "equipment", "jobs", "employees", "reports", "productionCompanies", "companyName",
  "timezone", "timeFormat", "kpiConfig", "punishments", "kpiEvents",
  "photoVerification", "navOrder", "verificationConfig", "invoicePresets", "chatEnabled",
  "theme", "roleList",
]);

// sent: the `_v` map from the PUT body (may be absent for old clients / scripts).
// Returns true when the client's copy of `field` is older than KV.
export function isStale(field, sent, current) {
  if (!VERSIONED.has(field)) return false;
  if (!sent || typeof sent !== "object" || !(field in sent)) return false; // client did not opt in
  const mine = sent[field] ?? null;
  const kv = current ?? null;
  return mine !== kv;
}
