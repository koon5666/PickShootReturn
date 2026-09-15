// POST /api/history-clear { adminPin }  (P0-5)
// "Clear pickup/return history", server-side: takes a safety backup version
// first (Settings > Backups shows it, restorable), then empties `checkouts` and
// deletes every photo:checkouts:* key. Returns the new field version so the
// calling client can adopt it; other open clients get a 409 on their next save
// and re-sync. Used to be a client-only setCheckouts([]) that the KV merge undid.
import { createBackup } from "../_lib/backup.js";
import { readField, writeField, deletePhotoPrefix } from "../_lib/store.js";
import { requireAdmin, readJson, CORS_ANY as CORS } from "../_lib/auth.js";

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost({ env, request }) {
  const body = await readJson(request);
  const auth = await requireAdmin(env, body);
  if (!auth.ok) return auth.response;
  try {
    const { value } = await readField(env.KV, "checkouts");
    const removed = Array.isArray(value) ? value.length : 0;
    const snap = await createBackup(env.KV, { kind: "safety", label: "before clear history" });
    const v = await writeField(env.KV, "checkouts", []);
    const photos = await deletePhotoPrefix(env.KV, "checkouts");
    return Response.json({ ok: true, removed, photosRemoved: photos, safetyId: snap.id, _v: { checkouts: v } }, { headers: CORS });
  } catch (err) {
    return Response.json({ ok: false, error: String(err && err.message || err) }, { status: 500, headers: CORS });
  }
}
