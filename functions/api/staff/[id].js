// PUT    /api/staff/:id { name }  -> rename (":id" = "owner" sets the owner's display name)
// DELETE /api/staff/:id           -> remove a staff account (never the owner)
import { requireOwner, readJson, signToken, sessionPayload, sessionCookie, isSecureRequest, publicUser } from "../../_lib/auth.js";
import { renameStaff, removeStaff } from "../../_lib/accounts.js";
import { appendAudit } from "../../_lib/audit.js";

export async function onRequestPut(context) {
  const auth = await requireOwner(context);
  if (!auth.ok) return auth.response;
  const body = await readJson(context.request);
  try {
    const r = await renameStaff(context.env.KV, String(context.params.id || ""), body.name);
    if (!r) return Response.json({ ok: false, error: "unknown staff" }, { status: 404 });
    const id = String(context.params.id);
    const nm = String(body.name || "").trim();
    // Renaming yourself: re-issue the session so every later stamp carries the new name.
    const headers = {};
    let user;
    if ((auth.session.staffId || "owner") === id) {
      const fresh = sessionPayload({ ...auth.session, name: nm });
      headers["Set-Cookie"] = sessionCookie(await signToken(fresh, context.env.SESSION_SECRET), { secure: isSecureRequest(context.request) });
      user = publicUser(fresh);
      await appendAudit(context.env.KV, fresh, { action: "staff.rename", targetId: id, name: nm });
    } else {
      await appendAudit(context.env.KV, auth.session, { action: "staff.rename", targetId: id, name: nm });
    }
    return Response.json({ ok: true, staff: r.staff, _v: { staff: r.v }, ...(user ? { user } : {}) }, { headers });
  } catch (e) {
    return Response.json({ ok: false, error: String(e && e.message || e) }, { status: 400 });
  }
}

export async function onRequestDelete(context) {
  const auth = await requireOwner(context);
  if (!auth.ok) return auth.response;
  try {
    const r = await removeStaff(context.env.KV, String(context.params.id || ""));
    if (!r) return Response.json({ ok: false, error: "unknown staff" }, { status: 404 });
    await appendAudit(context.env.KV, auth.session, { action: "staff.remove", targetId: String(context.params.id) });
    return Response.json({ ok: true, staff: r.staff, _v: { staff: r.v } });
  } catch (e) {
    return Response.json({ ok: false, error: String(e && e.message || e) }, { status: 400 });
  }
}
