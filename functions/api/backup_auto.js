// Daily auto-backup (from the admin session, once per 24 h). Same versioned
// storage as /api/backup, kind "auto" (functions/_lib/backup.js keeps the last
// RETENTION.auto versions). GET returns the latest auto version (compat).
import { createBackup, listBackups, getBackup } from "../_lib/backup.js";
import { CORS_ANY as CORS } from "../_lib/auth.js";

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet({ env }) {
  const latest = (await listBackups(env.KV)).find(b => b.kind === "auto");
  if (!latest) return new Response(null, { status: 404, headers: CORS });
  const snap = await getBackup(env.KV, latest.id);
  if (!snap) return new Response(null, { status: 404, headers: CORS });
  return Response.json(snap, { headers: CORS });
}

export async function onRequestPut({ env }) {
  try {
    const meta = await createBackup(env.KV, { kind: "auto", label: "daily auto-backup" });
    return Response.json({ ok: true, savedAt: meta.savedAt, id: meta.id }, { headers: CORS });
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 500, headers: CORS });
  }
}
