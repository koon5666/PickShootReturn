// Per-user LINE link (P3-6, functions/_lib/linelink.js).
//   GET    /api/line-link            -> { ok, linked, code, expiresAt }  (own record; admin: ?employeeId=)
//   POST   /api/line-link            -> mint a fresh code for the session's employee (admin: { employeeId })
//   DELETE /api/line-link            -> unlink (own record; admin: ?employeeId=)
// The crew member sends the code to the house's LINE Official Account in a
// 1:1 chat; the webhook (functions/api/webhook.js) pairs the sender.
import { requireSession, readJson } from "../_lib/auth.js";
import { readField, writeField } from "../_lib/store.js";
import { appendAudit } from "../_lib/audit.js";
import { issueLinkCode, unlinkEmployee, linkStatus } from "../_lib/linelink.js";

const CORS = {};
const targetOf = (session, given) => session.role === "admin" ? String(given || "") : session.id;

export async function onRequestGet(context) {
  const auth = await requireSession(context);
  if (!auth.ok) return auth.response;
  const url = new URL(context.request.url);
  const id = targetOf(auth.session, url.searchParams.get("employeeId"));
  if (!id) return Response.json({ ok: false, error: "employeeId required" }, { status: 400, headers: CORS });
  const { value } = await readField(context.env.KV, "employees");
  const emp = (Array.isArray(value) ? value : []).find(e => e && e.id === id);
  if (!emp) return Response.json({ ok: false, error: "unknown employee" }, { status: 404, headers: CORS });
  return Response.json({ ok: true, ...linkStatus(emp) }, { headers: CORS });
}

export async function onRequestPost(context) {
  const auth = await requireSession(context);
  if (!auth.ok) return auth.response;
  const body = await readJson(context.request);
  const id = targetOf(auth.session, body.employeeId);
  if (!id) return Response.json({ ok: false, error: "employeeId required" }, { status: 400, headers: CORS });
  const { value } = await readField(context.env.KV, "employees");
  const r = issueLinkCode(Array.isArray(value) ? value : [], id);
  if (!r) return Response.json({ ok: false, error: "unknown employee" }, { status: 404, headers: CORS });
  const v = await writeField(context.env.KV, "employees", r.employees);
  return Response.json({ ok: true, linked: false, code: r.code, expiresAt: r.expiresAt, _v: { employees: v } }, { headers: CORS });
}

export async function onRequestDelete(context) {
  const auth = await requireSession(context);
  if (!auth.ok) return auth.response;
  const url = new URL(context.request.url);
  const id = targetOf(auth.session, url.searchParams.get("employeeId"));
  if (!id) return Response.json({ ok: false, error: "employeeId required" }, { status: 400, headers: CORS });
  const { value } = await readField(context.env.KV, "employees");
  const list = Array.isArray(value) ? value : [];
  if (!list.some(e => e && e.id === id)) return Response.json({ ok: false, error: "unknown employee" }, { status: 404, headers: CORS });
  const v = await writeField(context.env.KV, "employees", unlinkEmployee(list, id));
  await appendAudit(context.env.KV, auth.session, { action: "line.unlink", targetId: id });
  return Response.json({ ok: true, linked: false, code: null, expiresAt: null, _v: { employees: v } }, { headers: CORS });
}
