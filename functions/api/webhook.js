// Verify LINE's X-Line-Signature = base64(HMAC-SHA256(channelSecret, rawBody)).
// Enforced only when LINE_CHANNEL_SECRET is configured, so setting the secret in
// the Pages dashboard turns on webhook authenticity without any code change and
// its absence never breaks the existing group-id capture.
async function signatureValid(secret, rawBody, header) {
  if (!header) return false;
  try {
    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    );
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
    const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
    return expected === header;
  } catch {
    return false;
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const raw = await request.text();
    if (env.LINE_CHANNEL_SECRET) {
      const ok = await signatureValid(env.LINE_CHANNEL_SECRET, raw, request.headers.get("X-Line-Signature"));
      if (!ok) return new Response("OK", { status: 200 }); // reject forged events, but LINE needs 200
    }
    const body = JSON.parse(raw);
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
