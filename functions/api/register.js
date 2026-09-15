// POST /api/register { name, pin, contact } -> a member-register request (P2-8).
// Unauthenticated (the requester has no account yet), IP rate-limited like a
// login. The requested PIN is hashed HERE and stored as requestedPinHash; the
// plaintext never touches KV and is never shown to the admin. Approval
// (/api/approve-member) copies the hash onto the new employee.
import { secretMissing, secretMissingResponse, originOk, readJson, clientIp, PIN_RE, hashPin } from "../_lib/auth.js";
import { rateCheck, rateFail, rateKey } from "../_lib/ratelimit.js";
import { readField, writeField } from "../_lib/store.js";
import { notifyGroup } from "../_lib/line.js";

export async function onRequestPost({ request, env }) {
  if (secretMissing(env)) return secretMissingResponse();
  if (!originOk(request)) return Response.json({ ok: false, error: "cross-origin request refused" }, { status: 403 });
  const body = await readJson(request);
  const name = String(body.name || "").trim().slice(0, 80);
  const pin = String(body.pin ?? "");
  const contact = String(body.contact || "").trim().slice(0, 120);
  if (!name) return Response.json({ ok: false, error: "name required" }, { status: 400 });
  if (!PIN_RE.test(pin)) return Response.json({ ok: false, error: "PIN must be 4-6 digits" }, { status: 400 });
  if (!contact) return Response.json({ ok: false, error: "contact required" }, { status: 400 });

  const key = rateKey(clientIp(request), "register", "-");
  const gate = await rateCheck(env.KV, key);
  if (gate.blocked) return Response.json({ ok: false, error: "too many requests", retryAfter: gate.retryAfter }, { status: 429, headers: { "Retry-After": String(gate.retryAfter) } });
  await rateFail(env.KV, key); // every registration counts toward the window

  const lower = name.toLowerCase();
  const { value: reqs } = await readField(env.KV, "adminRequests");
  const list = Array.isArray(reqs) ? reqs : [];
  if (list.some(r => r && r.type === "member-register" && r.status === "pending" && !r._deleted && String(r.name || "").trim().toLowerCase() === lower)) {
    return Response.json({ ok: false, error: "pending", pending: true }, { status: 409 });
  }
  const { value: emps } = await readField(env.KV, "employees");
  if ((Array.isArray(emps) ? emps : []).some(e => e && String(e.name || "").trim().toLowerCase() === lower)) {
    return Response.json({ ok: false, error: "name taken", taken: true }, { status: 409 });
  }
  const req = { id: "ar" + Date.now(), type: "member-register", status: "pending", submittedAt: new Date().toISOString(), name, contact, requestedPinHash: await hashPin(pin) };
  await writeField(env.KV, "adminRequests", [...list, req]);
  const { value: groupId } = await readField(env.KV, "lineGroupId");
  if (groupId) await notifyGroup(env, groupId, `🙋 New crew request / มีคนขอเข้าทีม: ${name}\n📱 ${contact}\nApprove in Pick Shoot Return > Dashboard > Approvals / อนุมัติได้ที่หน้า Dashboard`);
  return Response.json({ ok: true, id: req.id, name });
}
