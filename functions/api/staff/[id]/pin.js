// POST /api/staff/:id/pin { pin } -> owner resets a staff PIN (":id" = "owner" resets the owner PIN).
import { requireOwner, readJson, PIN_RE } from "../../../_lib/auth.js";
import { setStaffPin } from "../../../_lib/accounts.js";
import { appendAudit } from "../../../_lib/audit.js";

export async function onRequestPost(context) {
  const auth = await requireOwner(context);
  if (!auth.ok) return auth.response;
  const body = await readJson(context.request);
  const pin = String(body.pin ?? "");
  if (!PIN_RE.test(pin)) return Response.json({ ok: false, error: "PIN must be 4-6 digits" }, { status: 400 });
  const r = await setStaffPin(context.env.KV, String(context.params.id || ""), pin);
  if (!r) return Response.json({ ok: false, error: "unknown staff" }, { status: 404 });
  await appendAudit(context.env.KV, auth.session, { action: "pin.reset", targetId: String(context.params.id) });
  return Response.json({ ok: true, staff: r.staff });
}
