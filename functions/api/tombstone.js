// POST /api/tombstone { field, id, adminPin }  (P0-5)
// Marks one record deleted on the server: { ...record, _deleted: true, deletedAt }.
// Every merge in functions/_lib/merge.js keeps a KV tombstone over an incoming
// live copy, so the delete sticks even when another device that still has the
// record re-saves its array; GET /api/data strips tombstones for these fields.
// If the record is already gone from KV a stub tombstone is written so a stale
// re-save cannot bring it back. Photo keys of the record are removed.
import { readField, writeField } from "../_lib/store.js";
import { tombstoneOf, isTombstone } from "../_lib/merge.js";
import { photoKeysOf } from "../_lib/photos.js";
import { requireAdmin, readJson, CORS_ANY as CORS } from "../_lib/auth.js";

const ALLOWED = new Set(["equipmentRequests", "adminRequests", "checkouts"]);

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost({ env, request }) {
  const body = await readJson(request);
  const auth = await requireAdmin(env, body);
  if (!auth.ok) return auth.response;
  const { field, id } = body;
  if (!ALLOWED.has(field) || id == null || id === "") {
    return Response.json({ ok: false, error: "bad field or id" }, { status: 400, headers: CORS });
  }
  const { value } = await readField(env.KV, field);
  const arr = Array.isArray(value) ? value : [];
  const idx = arr.findIndex(e => e && e.id === id);
  const target = idx >= 0 ? arr[idx] : { id };
  if (isTombstone(target)) return Response.json({ ok: true, already: true }, { headers: CORS });
  await Promise.all(photoKeysOf(field, [target]).map(k => env.KV.delete(k)));
  const next = idx >= 0 ? arr.map((e, i) => (i === idx ? tombstoneOf(e) : e)) : [...arr, tombstoneOf(target)];
  const v = await writeField(env.KV, field, next);
  return Response.json({ ok: true, _v: { [field]: v } }, { headers: CORS });
}
