// GET /api/public -> what the login screen needs before anyone is signed in:
// company name, crew names for the account picker, staff names for the admin
// picker, and the names of member-register requests still pending (P2-8 shows
// "waiting for approval" on the device that registered). Never a credential,
// never a phone / LINE id, never any job or gear data.
import { readField } from "../_lib/store.js";
import { OWNER_STAFF_ID } from "../_lib/auth.js";

export async function onRequestGet({ env }) {
  const [company, employees, staff, requests] = await Promise.all([
    readField(env.KV, "companyName"), readField(env.KV, "employees"), readField(env.KV, "staff"), readField(env.KV, "adminRequests"),
  ]);
  const emp = (Array.isArray(employees.value) ? employees.value : []).filter(e => e && e.id != null).map(e => ({ id: e.id, name: e.name || "" }));
  const st = (Array.isArray(staff.value) ? staff.value : []).filter(s => s && s.id != null).map(s => ({ id: s.id, name: s.name || "", role: s.role === "owner" ? "owner" : "counter" }));
  const owner = st.find(s => s.id === OWNER_STAFF_ID);
  const pending = (Array.isArray(requests.value) ? requests.value : [])
    .filter(r => r && r.type === "member-register" && r.status === "pending" && !r._deleted)
    .map(r => ({ id: r.id, name: r.name || "", submittedAt: r.submittedAt || null }));
  return Response.json({
    companyName: typeof company.value === "string" ? company.value : null,
    employees: emp,
    ownerName: (owner && owner.name) || null,
    staff: st.filter(s => s.id !== OWNER_STAFF_ID),
    pendingRegistrations: pending,
  }, { headers: { "Cache-Control": "no-store" } });
}
