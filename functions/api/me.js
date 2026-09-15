// GET /api/me -> { user } for a valid session cookie, { user: null } without one
// (200, not 401: a logged-out visit is the normal state, not an error to log).
// Re-issues the cookie when less than SESSION_REFRESH_S of its life remains
// (sliding 30-day sessions for a phone that opens the app every few days).
import { getSession, secretMissing, secretMissingResponse, publicUser, signToken, sessionPayload, sessionCookie, isSecureRequest, SESSION_REFRESH_S } from "../_lib/auth.js";

export async function onRequestGet({ request, env }) {
  if (secretMissing(env)) return secretMissingResponse();
  const s = await getSession(request, env);
  const headers = { "Cache-Control": "no-store" };
  if (!s) return Response.json({ ok: true, user: null }, { headers });
  if ((s.exp - Math.floor(Date.now() / 1000)) < SESSION_REFRESH_S) {
    const fresh = sessionPayload(s);
    headers["Set-Cookie"] = sessionCookie(await signToken(fresh, env.SESSION_SECRET), { secure: isSecureRequest(request) });
  }
  return Response.json({ ok: true, user: publicUser(s), exp: s.exp }, { headers });
}
