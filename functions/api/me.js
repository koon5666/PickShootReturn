// GET /api/me -> { user } for a valid session cookie, 401 otherwise. Re-issues
// the cookie when less than SESSION_REFRESH_S of its life remains (sliding
// 30-day sessions for a phone that opens the app every few days).
import { requireSession, publicUser, signToken, sessionPayload, sessionCookie, isSecureRequest, SESSION_REFRESH_S } from "../_lib/auth.js";

export async function onRequestGet(context) {
  const auth = await requireSession(context);
  if (!auth.ok) return auth.response;
  const s = auth.session;
  const headers = { "Cache-Control": "no-store" };
  if ((s.exp - Math.floor(Date.now() / 1000)) < SESSION_REFRESH_S) {
    const fresh = sessionPayload(s);
    headers["Set-Cookie"] = sessionCookie(await signToken(fresh, context.env.SESSION_SECRET), { secure: isSecureRequest(context.request) });
  }
  return Response.json({ ok: true, user: publicUser(s), exp: s.exp }, { headers });
}
