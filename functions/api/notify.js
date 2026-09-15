// LINE push relay. Session required (P0-2): it used to be an open relay that
// anyone could burn the shared monthly push quota through.
import { requireSession } from "../_lib/auth.js";

const CORS = {};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost(context) {
  const auth = await requireSession(context);
  if (!auth.ok) return auth.response;
  const { request, env } = context;
  const token = env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) {
    return Response.json({ ok: false, error: "LINE_CHANNEL_ACCESS_TOKEN not configured" }, { status: 500, headers: CORS });
  }

  let userIds, message;
  try { ({ userIds, message } = await request.json()); } catch { return Response.json({ ok: false, error: "invalid JSON body" }, { status: 400, headers: CORS }); }
  if (!userIds?.length || !message) {
    return Response.json({ ok: false, error: "Missing userIds or message" }, { status: 400, headers: CORS });
  }

  const results = await Promise.allSettled(
    userIds.map(async (userId) => {
      const res = await fetch("https://api.line.me/v2/bot/message/push", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: userId,
          messages: [{ type: "text", text: message }],
        }),
      });
      // LINE returns 200 on success; anything else is a real failure (bad token,
      // bad recipient id, monthly quota exceeded, …) — surface it.
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`LINE ${res.status} for ${userId}: ${detail.slice(0, 300)}`);
      }
      return userId;
    })
  );

  const errors = results.filter(r => r.status === "rejected").map(r => String(r.reason?.message || r.reason));
  return Response.json({
    ok: errors.length === 0,
    sent: results.filter(r => r.status === "fulfilled").length,
    failed: errors.length,
    errors,
  }, { headers: CORS });
}
