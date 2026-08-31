export async function onRequestGet({ env, params }) {
  // Only shared-invoice keys are readable here. Without this guard the endpoint
  // is an arbitrary KV read (adminPin, profiles, backups, checkouts, …).
  if (!/^inv_share_/.test(params.key || "")) {
    return new Response("Invoice not found or link has expired.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  const html = await env.KV.get(params.key);
  if (!html) {
    return new Response("Invoice not found or link has expired.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*" } });
}
