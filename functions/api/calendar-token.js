// POST /api/calendar-token { rotate? } (admin) -> { token }
// The per-tenant token the iCal feed URL carries (/api/calendar?token=...).
// Created on first login; rotate invalidates every subscribed calendar.
import { requireAdmin, readJson } from "../_lib/auth.js";
import { ensureCalendarToken, rotateCalendarToken } from "../_lib/accounts.js";
import { appendAudit } from "../_lib/audit.js";

export async function onRequestPost(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) return auth.response;
  const body = await readJson(context.request);
  const token = body.rotate ? await rotateCalendarToken(context.env.KV) : await ensureCalendarToken(context.env.KV);
  if (body.rotate) await appendAudit(context.env.KV, auth.session, { action: "calendar.rotate" });
  return Response.json({ ok: true, token, rotated: !!body.rotate });
}
