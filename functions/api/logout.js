// POST /api/logout -> clears the session cookie (always 200, even without one).
import { clearSessionCookie, isSecureRequest, originOk } from "../_lib/auth.js";

export async function onRequestPost({ request }) {
  if (!originOk(request)) return Response.json({ ok: false, error: "cross-origin request refused" }, { status: 403 });
  return Response.json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookie({ secure: isSecureRequest(request) }), "Cache-Control": "no-store" } });
}
