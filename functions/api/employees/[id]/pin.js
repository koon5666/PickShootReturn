// POST /api/employees/:id/pin { pin, name? } -> admin sets / resets a crew PIN.
// With `name` the member is created when the id is unknown (Team > Add Member),
// so a new member's PIN never travels inside the employees array. Returns the
// credential-free employees list + its version so the client adopts it as saved.
import { requireAdmin, readJson, PIN_RE } from "../../../_lib/auth.js";
import { setEmployeePin } from "../../../_lib/accounts.js";
import { appendAudit } from "../../../_lib/audit.js";

export async function onRequestPost(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) return auth.response;
  const { env, params, request } = context;
  const id = String(params.id || "");
  const body = await readJson(request);
  const pin = String(body.pin ?? "");
  if (!id) return Response.json({ ok: false, error: "id required" }, { status: 400 });
  if (!PIN_RE.test(pin)) return Response.json({ ok: false, error: "PIN must be 4-6 digits" }, { status: 400 });
  const r = await setEmployeePin(env.KV, id, pin, { name: body.name });
  if (!r) return Response.json({ ok: false, error: "unknown employee" }, { status: 404 });
  await appendAudit(env.KV, auth.session, { action: r.created ? "employee.create" : "pin.reset", targetId: id, name: body.name || undefined });
  return Response.json({ ok: true, employees: r.employees, created: r.created, _v: { employees: r.v } });
}
