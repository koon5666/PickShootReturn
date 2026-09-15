// Daily auto-backup (from the admin session, once per 24 h). Same versioned
// storage as /api/backup, kind "auto" (functions/_lib/backup.js keeps the last
// RETENTION.auto versions). GET returns the latest auto version (compat).
import { createBackup, listBackups, getBackup } from "../_lib/backup.js";
import { requireAdmin } from "../_lib/auth.js";

const CORS = {};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) return auth.response;
  const { env } = context;
  const latest = (await listBackups(env.KV)).find(b => b.kind === "auto");
  if (!latest) return new Response(null, { status: 404, headers: CORS });
  const snap = await getBackup(env.KV, latest.id);
  if (!snap) return new Response(null, { status: 404, headers: CORS });
  return Response.json(snap, { headers: CORS });
}

export async function onRequestPut(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) return auth.response;
  const { env } = context;
  try {
    const meta = await createBackup(env.KV, { kind: "auto", label: "daily auto-backup" });
    return Response.json({ ok: true, savedAt: meta.savedAt, id: meta.id }, { headers: CORS });
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 500, headers: CORS });
  }
}
