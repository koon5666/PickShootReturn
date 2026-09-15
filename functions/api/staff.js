// Staff accounts (P2-6), owner only.
//   GET  /api/staff                -> { staff: [{ id, name, role }] }  (no credentials)
//   POST /api/staff { name, role, pin } -> add a counter / owner account
// /api/staff/:id (PUT rename, DELETE) and /api/staff/:id/pin live next to this file.
import { requireOwner, readJson } from "../_lib/auth.js";
import { addStaff, readStaff } from "../_lib/accounts.js";
import { stripStaff } from "../_lib/auth.js";
import { appendAudit } from "../_lib/audit.js";

export async function onRequestGet(context) {
  const auth = await requireOwner(context);
  if (!auth.ok) return auth.response;
  return Response.json({ ok: true, staff: (await readStaff(context.env.KV)).map(stripStaff) });
}

export async function onRequestPost(context) {
  const auth = await requireOwner(context);
  if (!auth.ok) return auth.response;
  const body = await readJson(context.request);
  try {
    const r = await addStaff(context.env.KV, { name: body.name, role: body.role, pin: String(body.pin ?? "") });
    await appendAudit(context.env.KV, auth.session, { action: "staff.add", targetId: r.entry.id, name: r.entry.name, detail: r.entry.role });
    return Response.json({ ok: true, staff: r.staff, entry: r.entry, _v: { staff: r.v } });
  } catch (e) {
    return Response.json({ ok: false, error: String(e && e.message || e) }, { status: 400 });
  }
}
