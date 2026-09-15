// POST /api/pin { oldPin, newPin } -> change the CALLER's own PIN (owner, staff
// or crew). The old PIN must verify; failures count against the login rate
// limit for this account so the endpoint is no better a guessing oracle than
// /api/login is.
import { requireSession, readJson, clientIp, PIN_RE, OWNER_STAFF_ID } from "../_lib/auth.js";
import { rateCheck, rateFail, rateClear, rateKey } from "../_lib/ratelimit.js";
import { changeOwnPin } from "../_lib/accounts.js";
import { appendAudit } from "../_lib/audit.js";

export async function onRequestPost(context) {
  const auth = await requireSession(context);
  if (!auth.ok) return auth.response;
  const { request, env } = context;
  const s = auth.session;
  const body = await readJson(request);
  const oldPin = String(body.oldPin ?? ""), newPin = String(body.newPin ?? "");
  if (!PIN_RE.test(newPin)) return Response.json({ ok: false, error: "PIN must be 4-6 digits" }, { status: 400 });
  const account = s.role === "admin" ? (s.staffId || OWNER_STAFF_ID) : s.id;
  const key = rateKey(clientIp(request), s.role, account);
  const gate = await rateCheck(env.KV, key);
  if (gate.blocked) return Response.json({ ok: false, error: "too many attempts", retryAfter: gate.retryAfter }, { status: 429, headers: { "Retry-After": String(gate.retryAfter) } });
  const r = await changeOwnPin(env.KV, s, oldPin, newPin);
  if (!r.ok) {
    if (r.wrong) { const after = await rateFail(env.KV, key); return Response.json({ ok: false, error: "current pin incorrect", retryAfter: after.blocked ? after.retryAfter : 0 }, { status: after.blocked ? 429 : 401 }); }
    return Response.json({ ok: false, error: r.error || "could not change pin" }, { status: 400 });
  }
  await rateClear(env.KV, key);
  await appendAudit(env.KV, s, { action: "pin.change", targetId: account });
  return Response.json({ ok: true });
}
