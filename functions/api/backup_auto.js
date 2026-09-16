// Daily auto-backup (from the admin session, once per 24 h). Same versioned
// storage as /api/backup, kind "auto" (functions/_lib/backup.js keeps the last
// RETENTION.auto versions). GET returns the latest auto version (compat).
import { createBackup, listBackups, getBackup, autoBackupDue, exportBackup } from "../_lib/backup.js";
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
    // Server-side 20 h gate: a second admin device the same day reuses the
    // existing daily version instead of minting another one.
    const { due, latest } = autoBackupDue(await listBackups(env.KV));
    if (!due) return Response.json({ ok: true, skipped: true, savedAt: latest.savedAt, id: latest.id }, { headers: CORS });
    const meta = await createBackup(env.KV, { kind: "auto", label: "daily auto-backup" });
    const off = await exportBackup(env, env.KV, meta.id); // off-site copy when an R2 bucket is bound
    return Response.json({ ok: true, savedAt: meta.savedAt, id: meta.id, ...(off.ok ? { exported: off.key } : {}) }, { headers: CORS });
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 500, headers: CORS });
  }
}
