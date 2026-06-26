const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet({ env, params }) {
  const raw = await env.KV.get(`profile_${params.empId}`);
  if (!raw) return new Response(null, { status: 404, headers: CORS });
  try {
    const parsed = JSON.parse(raw);
    return Response.json(parsed, { headers: CORS });
  } catch {
    // Legacy: raw value was just the photo base64 string
    return Response.json({ photo: raw }, { headers: CORS });
  }
}

export async function onRequestPut({ request, env, params }) {
  const body = await request.json();
  await env.KV.put(`profile_${params.empId}`, JSON.stringify(body));
  return Response.json({ ok: true }, { headers: CORS });
}
