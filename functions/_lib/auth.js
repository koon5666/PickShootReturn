// Interim admin guard for destructive endpoints (migrate photos, clear history,
// restore a backup, delete a record). Compares `adminPin` from the request body
// with the PIN in KV (same default the app uses when KV has none). The auth track
// (P0-2) replaces this with a server session; keep the call sites on
// `requireAdmin(env, body)` so the swap is one function.
export async function requireAdmin(env, body) {
  const kvPin = (await env.KV.get("adminPin", "json")) ?? "1234";
  const sent = body && body.adminPin != null ? String(body.adminPin) : "";
  if (!sent || sent !== String(kvPin)) {
    return { ok: false, response: Response.json({ ok: false, error: "admin PIN required" }, { status: 403, headers: CORS_ANY }) };
  }
  return { ok: true };
}

export const CORS_ANY = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function readJson(request) {
  try { return await request.json(); } catch { return {}; }
}
