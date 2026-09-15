// Backups (P2-7): dated versions with list + pick, server-side restore.
//   GET  /api/backup?list=1      -> { backups: [meta...] } newest first (manual/auto/safety + legacy)
//   GET  /api/backup?id=<id>     -> the whole dataset of that version (photos inline, _profiles)
//   GET  /api/backup             -> latest manual version (compat with the old single slot)
//   PUT  /api/backup { label? }  -> create a manual version (snapshots full KV server-side)
//   POST /api/backup { id, adminPin } -> restore that version (safety snapshot first)
// Storage + rules: functions/_lib/backup.js.
import { createBackup, listBackups, getBackup, restoreBackup } from "../_lib/backup.js";
import { requireAdmin, readJson, CORS_ANY as CORS } from "../_lib/auth.js";

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet({ env, request }) {
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

export async function onRequestPut({ env, request }) {
  try {
    const body = await readJson(request);
    const meta = await createBackup(env.KV, { kind: "manual", label: body.label || "" });
    return Response.json({ ok: true, savedAt: meta.savedAt, id: meta.id, backup: meta }, { headers: CORS });
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 500, headers: CORS });
  }
}

export async function onRequestPost({ env, request }) {
  const body = await readJson(request);
  const auth = await requireAdmin(env, body);
  if (!auth.ok) return auth.response;
  if (!body.id) return Response.json({ ok: false, error: "id required" }, { status: 400, headers: CORS });
  try {
    const res = await restoreBackup(env.KV, String(body.id));
    return Response.json(res, { status: res.ok ? 200 : 404, headers: CORS });
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 500, headers: CORS });
  }
}
