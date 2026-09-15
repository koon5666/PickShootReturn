// POST /api/history-clear  (P0-5; admin session, P0-2)
// "Clear pickup/return history", server-side: takes a safety backup version
// first (Settings > Backups shows it, restorable), then empties `checkouts` and
// deletes every photo:checkouts:* key. Returns the new field version so the
// calling client can adopt it; other open clients get a 409 on their next save
// and re-sync. Used to be a client-only setCheckouts([]) that the KV merge undid.
import { createBackup } from "../_lib/backup.js";
import { readField, writeField, deletePhotoPrefix } from "../_lib/store.js";
import { requireAdmin } from "../_lib/auth.js";
import { appendAudit } from "../_lib/audit.js";

const CORS = {};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) return auth.response;
  const { env } = context;
  const by = auth.session.name || "Admin";
  try {
    const { value } = await readField(env.KV, "checkouts");
    const removed = Array.isArray(value) ? value.length : 0;
    const snap = await createBackup(env.KV, { kind: "safety", label: `before clear history (by ${by})` });
    // clearedAt: a stale device re-saving records from before this moment can
    // not bring them back (functions/_lib/merge.js mergePhotoArray).
    const v = await writeField(env.KV, "checkouts", [], { clearedAt: Date.now() });
    const photos = await deletePhotoPrefix(env.KV, "checkouts");
    await appendAudit(env.KV, auth.session, { action: "history.clear", detail: `${removed} events, ${photos} photos, safety ${snap.id}` });
    return Response.json({ ok: true, removed, photosRemoved: photos, safetyId: snap.id, _v: { checkouts: v } }, { headers: CORS });
  } catch (err) {
    return Response.json({ ok: false, error: String(err && err.message || err) }, { status: 500, headers: CORS });
  }
}
