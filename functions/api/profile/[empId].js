// Per-person profile blob (profile_<id>: photo, phone, ID card, bank, signature…).
// Session-keyed (P0-2): a crew member reads and writes ONLY their own profile
// (the URL id must equal the session id); an admin may read any and write any
// (the house profile is profile_admin). Same-origin only, no CORS headers.
import { requireSession } from "../../_lib/auth.js";

const MAX_BYTES = 4_000_000; // well under KV's 25 MiB; a profile with 3 images

function allowed(session, empId) {
  if (session.role === "admin") return true;
  return session.role === "employee" && session.id === empId;
}

export async function onRequestOptions() {
  return new Response(null, { status: 204 });
}

export async function onRequestGet(context) {
  const auth = await requireSession(context);
  if (!auth.ok) return auth.response;
  const { env, params } = context;
  const empId = String(params.empId || "");
  if (!allowed(auth.session, empId)) return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  const raw = await env.KV.get(`profile_${empId}`);
  if (!raw) return new Response(null, { status: 404 });
  try {
    return Response.json(JSON.parse(raw), { headers: { "Cache-Control": "no-store" } });
  } catch {
    // Legacy: raw value was just the photo base64 string
    return Response.json({ photo: raw }, { headers: { "Cache-Control": "no-store" } });
  }
}

export async function onRequestPut(context) {
  const auth = await requireSession(context);
  if (!auth.ok) return auth.response;
  const { request, env, params } = context;
  const empId = String(params.empId || "");
  if (!allowed(auth.session, empId)) return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  try {
    const text = await request.text();
    if (text.length > MAX_BYTES) return Response.json({ ok: false, error: "profile too large" }, { status: 413 });
    let parsed;
    try { parsed = JSON.parse(text); } catch { return Response.json({ ok: false, error: "invalid JSON body" }, { status: 400 }); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return Response.json({ ok: false, error: "profile must be an object" }, { status: 400 });
    await env.KV.put(`profile_${empId}`, text);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
