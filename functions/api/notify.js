const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost({ request, env }) {
  const token = env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) {
    return Response.json({ ok: false, error: "LINE_CHANNEL_ACCESS_TOKEN not configured" }, { status: 500, headers: CORS });
  }

  const { userIds, message } = await request.json();
  if (!userIds?.length || !message) {
    return Response.json({ ok: false, error: "Missing userIds or message" }, { status: 400, headers: CORS });
  }

  const results = await Promise.allSettled(
    userIds.map(userId =>
      fetch("https://api.line.me/v2/bot/message/push", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: userId,
          messages: [{ type: "text", text: message }],
        }),
      })
    )
  );

  return Response.json({
    ok: true,
    sent: results.filter(r => r.status === "fulfilled").length,
    failed: results.filter(r => r.status === "rejected").length,
  }, { headers: CORS });
}
