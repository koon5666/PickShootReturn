// Shared-invoice link rules for /api/invoice-share and /api/invoice-view
// (review item P0-7). Pure helpers, no KV access: unit-tested in share.test.js.
//
// A share is stored under `inv_share_<key>` as a JSON envelope
//   { v: 1, html, createdAt, expiresAt, token, views }
// with a KV TTL. Older shares (plain HTML string, 30-day TTL) are still served
// until they expire but cannot be revoked or counted.

export const SHARE_TTL_SECONDS = 60 * 60 * 72; // 72 h (was 30 days)
export const SHARE_PREFIX = "inv_share_";

export const isShareKey = (key) => typeof key === "string" && /^inv_share_[A-Za-z0-9_]+$/.test(key);

// Random key + revoke token. `rand` is injectable for tests.
export function newShareKey(now = Date.now(), rand = Math.random) {
  return `${SHARE_PREFIX}${now}_${rand().toString(36).slice(2, 9)}`;
}
export function newRevokeToken(rand = Math.random) {
  return (rand().toString(36).slice(2) + rand().toString(36).slice(2)).slice(0, 24);
}

export function makeEnvelope({ html, now = Date.now(), ttlSeconds = SHARE_TTL_SECONDS, token }) {
  return { v: 1, html: String(html || ""), createdAt: now, expiresAt: now + ttlSeconds * 1000, token, views: 0 };
}

// Parse a stored value: JSON envelope → object; legacy raw HTML → { html, legacy: true }.
export function parseStored(raw) {
  if (raw == null) return null;
  const s = String(raw);
  if (s.startsWith("{")) {
    try { const o = JSON.parse(s); if (o && typeof o.html === "string") return o; } catch { /* fall through */ }
  }
  return { v: 0, html: s, legacy: true, views: 0 };
}

export const isExpired = (env, now = Date.now()) => !!(env && env.expiresAt && now >= env.expiresAt);

// Remaining TTL in seconds for a KV put (min 60 so the write is accepted).
export function remainingTtl(env, now = Date.now()) {
  if (!env || !env.expiresAt) return SHARE_TTL_SECONDS;
  return Math.max(60, Math.ceil((env.expiresAt - now) / 1000));
}

// Public view of a share for the owner (never leaks the html or the token).
export function shareStatus(env, now = Date.now()) {
  if (!env) return { found: false };
  return { found: true, views: env.views || 0, createdAt: env.createdAt || null, expiresAt: env.expiresAt || null, expired: isExpired(env, now), legacy: !!env.legacy };
}

export const tokenMatches = (env, token) => !!(env && env.token && token && env.token === token);
