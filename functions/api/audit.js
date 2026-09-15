// Actor log (P2-6).
//   POST /api/audit { action, recordId?, name?, detail? }  any session; the server
//        stamps who/when. The client uses it for changes that do not pass through
//        a session-aware endpoint (a job delete is a whole-array PUT).
//   GET  /api/audit?limit=100   admin: newest first.
import { requireSession, requireAdmin, readJson } from "../_lib/auth.js";
import { appendAudit } from "../_lib/audit.js";
import { readField } from "../_lib/store.js";

const ACTIONS = new Set(["job.delete", "equipment.delete", "employee.delete", "company.delete", "invoice.delete", "report.delete", "request.delete", "kpi.deduct", "kpi.undo", "receive", "approve", "reject"]);

export async function onRequestPost(context) {
  const auth = await requireSession(context);
  if (!auth.ok) return auth.response;
  const body = await readJson(context.request);
  const action = String(body.action || "");
  if (!ACTIONS.has(action)) return Response.json({ ok: false, error: "unknown action" }, { status: 400 });
  const entry = await appendAudit(context.env.KV, auth.session, { action, recordId: body.recordId, name: body.name, detail: body.detail });
  return Response.json({ ok: !!entry, entry });
}

export async function onRequestGet(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) return auth.response;
  const url = new URL(context.request.url);
  const limit = Math.max(1, Math.min(500, parseInt(url.searchParams.get("limit"), 10) || 100));
  const { value } = await readField(context.env.KV, "auditLog");
  const log = Array.isArray(value) ? value : [];
  return Response.json({ ok: true, entries: log.slice(-limit).reverse() });
}
