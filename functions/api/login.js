// POST /api/login { role: "admin"|"employee", empId?, staffId?, pin }  (P0-2)
// Verifies the PIN server-side (functions/_lib/accounts.js: hashed, legacy
// plaintext upgraded on first success) and issues the httpOnly session cookie.
// 5 failures per 60 s per IP + account -> 429 with Retry-After (KV backed).
// The response never carries a credential; the cookie is the session.
import { secretMissing, secretMissingResponse, originOk, signToken, sessionPayload, sessionCookie, isSecureRequest, publicUser, readJson, clientIp, PIN_RE, OWNER_STAFF_ID } from "../_lib/auth.js";
import { rateCheck, rateFail, rateClear, rateKey } from "../_lib/ratelimit.js";
import { verifyOwnerPin, verifyStaffPin, verifyEmployeePin, ownerSession, staffSession, employeeSession, ownerName, ensureCalendarToken } from "../_lib/accounts.js";

export async function onRequestOptions() { return new Response(null, { status: 204 }); }

export async function onRequestPost({ request, env }) {
  if (secretMissing(env)) return secretMissingResponse();
  if (!originOk(request)) return Response.json({ ok: false, error: "cross-origin request refused" }, { status: 403 });
  const body = await readJson(request);
  const role = body.role === "admin" ? "admin" : body.role === "employee" ? "employee" : null;
  const pin = typeof body.pin === "string" ? body.pin : String(body.pin ?? "");
  if (!role || !PIN_RE.test(pin)) return Response.json({ ok: false, error: "role and a 4-6 digit pin are required" }, { status: 400 });
  const account = role === "admin" ? String(body.staffId || OWNER_STAFF_ID) : String(body.empId || "");
  if (role === "employee" && !account) return Response.json({ ok: false, error: "empId required" }, { status: 400 });

  const key = rateKey(clientIp(request), role, account);
  const gate = await rateCheck(env.KV, key);
  if (gate.blocked) {
    return Response.json({ ok: false, error: "too many attempts", retryAfter: gate.retryAfter }, { status: 429, headers: { "Retry-After": String(gate.retryAfter) } });
  }

  let session = null;
  if (role === "employee") {
    const r = await verifyEmployeePin(env.KV, account, pin);
    if (r.ok) session = employeeSession(r.employee);
  } else if (account === OWNER_STAFF_ID) {
    const r = await verifyOwnerPin(env.KV, pin);
    if (r.ok) session = ownerSession(await ownerName(env.KV));
  } else {
    const r = await verifyStaffPin(env.KV, account, pin);
    if (r.ok) session = staffSession(r.staff);
  }

  if (!session) {
    const after = await rateFail(env.KV, key);
    if (after.blocked) {
      return Response.json({ ok: false, error: "too many attempts", retryAfter: after.retryAfter }, { status: 429, headers: { "Retry-After": String(after.retryAfter) } });
    }
    return Response.json({ ok: false, error: "incorrect pin", attemptsLeft: Math.max(0, 5 - after.fails.length) }, { status: 401 });
  }
  await rateClear(env.KV, key);
  await ensureCalendarToken(env.KV); // per-tenant calendar feed token exists from the first login on
  const payload = sessionPayload(session);
  const token = await signToken(payload, env.SESSION_SECRET);
  return Response.json({ ok: true, user: publicUser(payload) }, {
    headers: { "Set-Cookie": sessionCookie(token, { secure: isSecureRequest(request) }), "Cache-Control": "no-store" },
  });
}

// GET /api/login is not a thing; make the mistake obvious.
export async function onRequestGet() {
  return Response.json({ ok: false, error: "POST { role, empId | staffId, pin }" }, { status: 405 });
}
