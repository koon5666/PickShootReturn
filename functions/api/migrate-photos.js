// POST /api/migrate-photos { adminPin, limit? }  (P0-1)
// Moves inline base64 photos out of the field arrays into their own keys
// (photo:<field>:<id>, functions/_lib/photos.js). Idempotent, batched and
// resumable: each call moves up to `limit` photos (default 20) and reports what
// is left; call again until every `remaining` is 0. Safe to run while the app is
// in use: photo keys are written before the array, the field version is kept,
// and /api/photo serves inline photos as a fallback for anything not moved yet.
// GET /api/migrate-photos -> progress only (no writes).
import { migrateField, readField, PHOTO_FIELD_NAMES } from "../_lib/store.js";
import { countInline } from "../_lib/photos.js";
import { requireAdmin, readJson, CORS_ANY as CORS } from "../_lib/auth.js";

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

async function progress(env) {
  const out = {};
  for (const f of PHOTO_FIELD_NAMES) {
    const { raw, value } = await readField(env.KV, f);
    out[f] = { records: Array.isArray(value) ? value.length : 0, inline: countInline(f, value), bytes: raw ? raw.length : 0 };
  }
  return out;
}

export async function onRequestGet({ env }) {
  return Response.json({ ok: true, fields: await progress(env) }, { headers: CORS });
}

export async function onRequestPost({ env, request }) {
  const body = await readJson(request);
  const auth = await requireAdmin(env, body);
  if (!auth.ok) return auth.response;
  const limit = Math.max(1, Math.min(100, parseInt(body.limit, 10) || 20));
  const results = [];
  let budget = limit;
  try {
    for (const f of PHOTO_FIELD_NAMES) {
      if (budget <= 0) break;
      const r = await migrateField(env.KV, f, budget);
      budget -= r.moved;
      results.push(r);
    }
  } catch (err) {
    return Response.json({ ok: false, error: String(err && err.message || err), results }, { status: err && err.size ? 413 : 500, headers: CORS });
  }
  const fields = await progress(env);
  const remaining = Object.values(fields).reduce((n, f) => n + f.inline, 0);
  return Response.json({ ok: true, moved: results.reduce((n, r) => n + r.moved, 0), remaining, results, fields }, { headers: CORS });
}
