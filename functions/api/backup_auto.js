const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet({ env }) {
  const raw = await env.KV.get("backup_auto");
  if (!raw) return new Response(null, { status: 404, headers: CORS });
  return new Response(raw, { headers: { ...CORS, "Content-Type": "application/json" } });
}

export async function onRequestPut({ request, env }) {
  try {
    const text = await request.text();
    await env.KV.put("backup_auto", text);
    return Response.json({ ok: true }, { headers: CORS });
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 500, headers: CORS });
  }
}
