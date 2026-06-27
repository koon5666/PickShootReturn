export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    for (const event of (body.events || [])) {
      const groupId = event.source?.groupId;
      if (groupId) {
        await env.KV.put("lineGroupId", JSON.stringify(groupId));
        break;
      }
    }
  } catch {}
  // LINE requires 200 always
  return new Response("OK", { status: 200 });
}

export async function onRequestGet() {
  return new Response("OK", { status: 200 });
}
