// Server-side authentication (P0-2).
//
//  - PIN hashing: PBKDF2-SHA256, 100k iterations, per-user random salt (WebCrypto).
//    Stored as ONE string  "pbkdf2-sha256$<iterations>$<salt b64url>$<hash b64url>"
//    in `adminPinHash` (owner), `employees[].pinHash`, `staff[].pinHash`,
//    `adminRequests[].requestedPinHash` (member-register).
//  - Session: HMAC-SHA256 signed token "<b64url(payload)>.<b64url(mac)>" in an
//    httpOnly SameSite=Lax cookie `psr_session` (Secure on https). Payload
//    { role: "admin"|"employee", id, name, staffId?, staffRole?, iat, exp } with
//    a 30 day life, re-issued by /api/me when less than 15 days remain.
//  - Secret: env.SESSION_SECRET (a Pages secret in prod, .dev.vars locally). When
//    it is missing every protected function answers 500 with a clear message
//    instead of running unprotected.
//  - requireSession(context, opts) is the one gate every Pages Function calls.
//    Mutating requests must come from the page itself (Origin === own origin)
//    which, with SameSite=Lax, closes the cross-site request door.
//
// Pure helpers (hash / token / cookie / rate window) have no KV access and are
// unit-tested in auth.test.js. CORS: nothing here sets Access-Control-Allow-*;
// the API is same-origin only (the old `*` is gone on purpose).

export const COOKIE_NAME = "psr_session";
export const SESSION_TTL_S = 30 * 24 * 3600;      // 30 days
export const SESSION_REFRESH_S = 15 * 24 * 3600;  // re-issue when less than this remains
export const PBKDF2_ITERATIONS = 100_000;
export const PIN_RE = /^\d{4,6}$/;
export const ADMIN_ID = "admin";   // every admin session keeps id "admin" (house docs, presence, chat rely on it)
export const OWNER_STAFF_ID = "owner";

const enc = new TextEncoder();

// ── base64url ───────────────────────────────────────────────────────────────
export function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function unb64url(str) {
  const s = String(str || "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const bin = atob(s + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ── PIN hashing ─────────────────────────────────────────────────────────────
export async function hashPin(pin, { iterations = PBKDF2_ITERATIONS, salt } = {}) {
  const s = salt || crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", enc.encode(String(pin)), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: s, iterations }, key, 256);
  return `pbkdf2-sha256$${iterations}$${b64url(s)}$${b64url(new Uint8Array(bits))}`;
}
export function parsePinHash(stored) {
  if (typeof stored !== "string") return null;
  const [alg, iter, salt, hash] = stored.split("$");
  if (alg !== "pbkdf2-sha256" || !(+iter > 0) || !salt || !hash) return null;
  return { iterations: +iter, salt: unb64url(salt), hash: unb64url(hash) };
}
export async function verifyPin(pin, stored) {
  const p = parsePinHash(stored);
  if (!p || typeof pin !== "string" || !pin) return false;
  const again = await hashPin(pin, { iterations: p.iterations, salt: p.salt });
  return timingSafeEqual(unb64url(again.split("$")[3]), p.hash);
}
export const isPinHash = (s) => parsePinHash(s) !== null;

// ── session token ───────────────────────────────────────────────────────────
async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
export async function signToken(payload, secret) {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const mac = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(body));
  return `${body}.${b64url(new Uint8Array(mac))}`;
}
// Returns the payload, or null when the signature is wrong, malformed or expired.
export async function verifyToken(token, secret, now = Date.now()) {
  if (typeof token !== "string" || !secret) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot), sig = token.slice(dot + 1);
  let mac;
  try { mac = unb64url(sig); } catch { return null; }
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(body)));
  if (!timingSafeEqual(mac, expected)) return null;
  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(unb64url(body))); } catch { return null; }
  if (!payload || typeof payload !== "object") return null;
  if (!(payload.exp > 0) || payload.exp * 1000 <= now) return null;
  if (payload.role !== "admin" && payload.role !== "employee") return null;
  return payload;
}
export function sessionPayload(user, now = Date.now()) {
  const iat = Math.floor(now / 1000);
  const base = { role: user.role, id: user.id, name: String(user.name || ""), iat, exp: iat + SESSION_TTL_S };
  if (user.role === "admin") { base.staffId = user.staffId || OWNER_STAFF_ID; base.staffRole = user.staffRole || "owner"; }
  return base;
}
// The client-facing view of a session (what /api/me and /api/login return).
export function publicUser(p) {
  if (!p) return null;
  const u = { role: p.role, id: p.id, name: p.name || "" };
  if (p.role === "admin") { u.staffId = p.staffId || OWNER_STAFF_ID; u.staffRole = p.staffRole || "owner"; }
  return u;
}
export const isOwner = (s) => !!s && s.role === "admin" && (s.staffRole || "owner") === "owner";

// ── cookie ──────────────────────────────────────────────────────────────────
export function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k) out[k] = part.slice(i + 1).trim();
  }
  return out;
}
export function isSecureRequest(request) {
  try { return new URL(request.url).protocol === "https:"; } catch { return false; }
}
export function sessionCookie(token, { secure = true, maxAge = SESSION_TTL_S } = {}) {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}
export function clearSessionCookie({ secure = true } = {}) {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

// ── request-level helpers ───────────────────────────────────────────────────
export async function readJson(request) {
  try { return await request.json(); } catch { return {}; }
}
export function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "local";
}
// A mutating request from another site is refused even if a cookie rode along.
export function originOk(request) {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;
  const origin = request.headers.get("Origin");
  if (!origin) return true; // same-origin fetch / curl: browsers always send Origin cross-site
  try { return origin === new URL(request.url).origin; } catch { return false; }
}
export function secretMissing(env) {
  return !env || typeof env.SESSION_SECRET !== "string" || env.SESSION_SECRET.length < 16;
}
const json = (obj, status) => Response.json(obj, { status });
export const secretMissingResponse = () => json({ ok: false, error: "SESSION_SECRET not configured: set it as a Pages secret (or in .dev.vars locally) before running" }, 500);

// Read + verify the session cookie. null when absent/invalid.
export async function getSession(request, env) {
  if (secretMissing(env)) return null;
  const token = parseCookies(request.headers.get("Cookie"))[COOKIE_NAME];
  if (!token) return null;
  return verifyToken(token, env.SESSION_SECRET);
}

// The gate. opts: { admin: true } admin only; { owner: true } owner only.
// Returns { ok: true, session } or { ok: false, response }.
export async function requireSession({ request, env }, opts = {}) {
  if (secretMissing(env)) return { ok: false, response: secretMissingResponse() };
  if (!originOk(request)) return { ok: false, response: json({ ok: false, error: "cross-origin request refused" }, 403) };
  const session = await getSession(request, env);
  if (!session) return { ok: false, response: json({ ok: false, error: "unauthorized" }, 401) };
  if ((opts.admin || opts.owner) && session.role !== "admin") return { ok: false, response: json({ ok: false, error: "admin only" }, 403) };
  if (opts.owner && !isOwner(session)) return { ok: false, response: json({ ok: false, error: "owner only" }, 403) };
  return { ok: true, session };
}
export const requireAdmin = (ctx) => requireSession(ctx, { admin: true });
export const requireOwner = (ctx) => requireSession(ctx, { owner: true });

// ── login rate limit (pure window logic; the KV part lives in ratelimit.js) ──
export const RATE = { max: 5, windowMs: 60_000 };
// state: { fails: [ts...] } -> { blocked, retryAfter (s), fails }
export function rateState(state, now = Date.now(), { max = RATE.max, windowMs = RATE.windowMs } = {}) {
  const fails = (state && Array.isArray(state.fails) ? state.fails : []).filter(t => typeof t === "number" && now - t < windowMs);
  if (fails.length >= max) {
    const oldest = Math.min(...fails);
    return { blocked: true, retryAfter: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)), fails };
  }
  return { blocked: false, retryAfter: 0, fails };
}
export function rateRecordFail(state, now = Date.now(), opts) {
  const { fails } = rateState(state, now, opts);
  return { fails: [...fails, now] };
}

// Strip every credential-bearing field from what goes to a client.
export function stripCredentials(data) {
  const out = { ...data };
  delete out.adminPin;
  delete out.adminPinHash;
  if (Array.isArray(out.employees)) out.employees = out.employees.map(stripEmployee);
  if (Array.isArray(out.staff)) out.staff = out.staff.map(stripStaff);
  if (Array.isArray(out.adminRequests)) out.adminRequests = out.adminRequests.map(stripRequest);
  return out;
}
export function stripEmployee(e) {
  if (!e || typeof e !== "object") return e;
  // Credentials and the LINE identity never reach a client; the client only
  // learns whether the member is linked (P3-6, functions/_lib/linelink.js).
  const { pin, pinHash, lineUserId, lineLinkCode, lineLinkCodeAt, lineLinkedAt, lineLinked, ...rest } = e;
  return lineUserId ? { ...rest, lineLinked: true } : rest;
}
export function stripStaff(s) {
  if (!s || typeof s !== "object") return s;
  const { pin, pinHash, ...rest } = s;
  return rest;
}
export function stripRequest(r) {
  if (!r || typeof r !== "object") return r;
  const { requestedPin, requestedPinHash, ...rest } = r;
  return rest;
}
