import { readField, writeField } from "../_lib/store.js";
import { parseLinkCode, applyLinkCode } from "../_lib/linelink.js";

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

async function reply(env, replyToken, text) {
  const token = env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token || !replyToken) return;
  try {
    await fetch("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ replyToken, messages: [{ type: "text", text: String(text).slice(0, 1000) }] }),
    });
  } catch {}
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
    let groupSaved = false;
    for (const event of (body.events || [])) {
      const groupId = event.source?.groupId;
      if (groupId && !groupSaved) {
        await env.KV.put("lineGroupId", JSON.stringify(groupId));
        groupSaved = true;
        continue;
      }
      // 1:1 chat with the OA: a crew member sends the link code from Profile >
      // LINE notifications (P3-6). Pair the sender with that employee record.
      if (event.source?.type === "user" && event.type === "message" && event.message?.type === "text") {
        const code = parseLinkCode(event.message.text);
        if (!code) continue;
        const { value } = await readField(env.KV, "employees");
        const paired = applyLinkCode(Array.isArray(value) ? value : [], code, event.source.userId);
        if (!paired) { await reply(env, event.replyToken, "Link code not found or expired. Get a new one in the app: Profile > LINE notifications.\nไม่พบรหัสหรือรหัสหมดอายุ ขอรหัสใหม่ในแอปที่ โปรไฟล์ > แจ้งเตือนทาง LINE"); continue; }
        await writeField(env.KV, "employees", paired.employees);
        await reply(env, event.replyToken, `LINE linked to ${paired.employee.name || "your account"}. Approvals and reminders will come here.\nผูก LINE กับ ${paired.employee.name || "บัญชีของคุณ"} แล้ว ผลอนุมัติและการเตือนจะส่งมาที่นี่`);
      }
    }
  } catch {}
  // LINE requires 200 always
  return new Response("OK", { status: 200 });
}

export async function onRequestGet() {
  return new Response("OK", { status: 200 });
}
