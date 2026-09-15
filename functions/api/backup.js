// Backups (P2-7): dated versions with list + pick, server-side restore.
//   GET  /api/backup?list=1      -> { backups: [meta...] } newest first (manual/auto/safety + legacy)
//   GET  /api/backup?id=<id>     -> the whole dataset of that version (photos inline, _profiles)
//   GET  /api/backup             -> latest manual version (compat with the old single slot)
//   PUT  /api/backup { label? }  -> create a manual version (snapshots full KV server-side)
//   POST /api/backup { id }       -> restore that version (safety snapshot first; owner only)
// Storage + rules: functions/_lib/backup.js. Admin session required (P0-2);
// the actor is stamped on the backup label and in the audit log (P2-6).
import { createBackup, listBackups, getBackup, restoreBackup } from "../_lib/backup.js";
import { requireAdmin, requireOwner, readJson } from "../_lib/auth.js";
import { appendAudit } from "../_lib/audit.js";

const CORS = {};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) return auth.response;
  const { env, request } = context;
  const url = new URL(request.url);
  if (url.searchParams.get("list") === "1") {
    return Response.json({ backups: await listBackups(env.KV) }, { headers: CORS });
  }
  let id = url.searchParams.get("id");
  if (!id) {
    const latest = (await listBackups(env.KV)).find(b => b.kind === "manual");
    if (!latest) return new Response(null, { status: 404, headers: CORS });
    id = latest.id;
  }
  const snap = await getBackup(env.KV, id);
  if (!snap) return new Response(null, { status: 404, headers: CORS });
  return Response.json(snap, { headers: CORS });
}

export async function onRequestPut(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) return auth.response;
  const { env, request } = context;
  try {
    const body = await readJson(request);
    const by = auth.session.name || "Admin";
    const meta = await createBackup(env.KV, { kind: "manual", label: (body.label ? String(body.label) + " " : "") + `(by ${by})` });
    await appendAudit(env.KV, auth.session, { action: "backup.create", recordId: meta.id, name: body.label || "" });
    return Response.json({ ok: true, savedAt: meta.savedAt, id: meta.id, backup: meta }, { headers: CORS });
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 500, headers: CORS });
  }
}

export async function onRequestPost(context) {
  const auth = await requireOwner(context);
  if (!auth.ok) return auth.response;
  const { env, request } = context;
  const body = await readJson(request);
  if (!body.id) return Response.json({ ok: false, error: "id required" }, { status: 400, headers: CORS });
  try {
    const res = await restoreBackup(env.KV, String(body.id));
    if (res.ok) await appendAudit(env.KV, auth.session, { action: "backup.restore", recordId: String(body.id) });
    return Response.json(res, { status: res.ok ? 200 : 404, headers: CORS });
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 500, headers: CORS });
  }
}
