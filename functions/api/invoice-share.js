// Shared invoice links (review item P0-7).
//   POST   body = HTML            → { key, token, expiresAt }   72 h TTL
//   GET    ?key=&token=           → { found, views, createdAt, expiresAt, expired }  (owner status)
//   DELETE ?key=&token=           → { ok }                      revoke (deletes the KV entry)
// The revoke token is returned once at creation and must be presented for
// GET/DELETE, so only the device that created the link can inspect or kill it.
// The public reader is /api/invoice-view/<key> (no token, counts views).
import { SHARE_TTL_SECONDS, isShareKey, newShareKey, newRevokeToken, makeEnvelope, parseStored, isExpired, shareStatus, tokenMatches } from "../_lib/share.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost({ request, env }) {
  try {
    const html = await request.text();
    if (!html || html.length > 4_000_000) return Response.json({ error: "bad body" }, { status: 400, headers: CORS });
    const key = newShareKey();
    const token = newRevokeToken();
    const envelope = makeEnvelope({ html, token });
    await env.KV.put(key, JSON.stringify(envelope), { expirationTtl: SHARE_TTL_SECONDS });
    return Response.json({ key, token, expiresAt: envelope.expiresAt, ttlSeconds: SHARE_TTL_SECONDS }, { headers: CORS });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500, headers: CORS });
  }
}

async function loadOwned(request, env) {
  const url = new URL(request.url);
  const key = url.searchParams.get("key") || "";
  const token = url.searchParams.get("token") || "";
  if (!isShareKey(key)) return { status: 404 };
  const stored = parseStored(await env.KV.get(key));
  if (!stored) return { status: 404 };
  if (!tokenMatches(stored, token)) return { status: 403 };
  return { key, stored };
}

export async function onRequestGet({ request, env }) {
  const r = await loadOwned(request, env);
  if (r.status) return Response.json({ found: false }, { status: r.status, headers: CORS });
  return Response.json(shareStatus(r.stored), { headers: CORS });
}

export async function onRequestDelete({ request, env }) {
  const r = await loadOwned(request, env);
  if (r.status) return Response.json({ ok: false }, { status: r.status, headers: CORS });
  await env.KV.delete(r.key);
  return Response.json({ ok: true, revoked: true, expired: isExpired(r.stored) }, { headers: CORS });
}
