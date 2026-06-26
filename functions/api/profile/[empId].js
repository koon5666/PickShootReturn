const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet({ env, params }) {
  const photo = await env.KV.get(`profile_${params.empId}`);
  if (!photo) return new Response(null, { status: 404, headers: CORS });
  return Response.json({ photo }, { headers: CORS });
}

export async function onRequestPut({ request, env, params }) {
  const { photo } = await request.json();
  if (photo) {
    await env.KV.put(`profile_${params.empId}`, photo);
  } else {
    await env.KV.delete(`profile_${params.empId}`);
  }
  return Response.json({ ok: true }, { headers: CORS });
}
