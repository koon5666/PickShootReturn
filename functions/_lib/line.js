// LINE push helper shared by server-side notifications (register / approve).
// Best effort: a missing token or a LINE error never fails the caller. The
// monthly push quota is shared with every other sender on the account, so keep
// server-side pushes to the few that matter.
export async function notifyGroup(env, to, text) {
  const token = env && env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token || !to || !text) return { ok: false, skipped: true };
  try {
    const res = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ to, messages: [{ type: "text", text: String(text).slice(0, 4000) }] }),
    });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}
