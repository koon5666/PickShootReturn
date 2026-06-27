const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost({ request, env }) {
  try {
    const html = await request.text();
    const key = `inv_share_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    await env.KV.put(key, html, { expirationTtl: 60 * 60 * 24 * 30 }); // 30 days
    return Response.json({ key }, { headers: CORS });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500, headers: CORS });
  }
}
