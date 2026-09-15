// Verify LINE's X-Line-Signature = base64(HMAC-SHA256(channelSecret, rawBody)).
// LINE_CHANNEL_SECRET is REQUIRED (P0-2): without it anyone could POST here and
// point every notification at their own group. Set it as a Pages secret (LINE
// Developers console > Messaging API > Channel secret); until then the webhook
// answers 500 and LINE's "Verify" button fails loudly instead of silently trusting.
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
    if (!env.LINE_CHANNEL_SECRET) {
      return Response.json({ ok: false, error: "LINE_CHANNEL_SECRET not configured: set it as a Pages secret before connecting the LINE webhook" }, { status: 500 });
    }
    const raw = await request.text();
    const ok = await signatureValid(env.LINE_CHANNEL_SECRET, raw, request.headers.get("X-Line-Signature"));
    if (!ok) return new Response("bad signature", { status: 403 });
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
