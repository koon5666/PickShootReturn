// LINE push helper shared by server-side notifications (register / approve).
// Best effort: a missing token or a LINE error never fails the caller. The
// monthly push quota is shared with every other sender on the account, so keep
// server-side pushes to the few that matter.
// LINE_API_BASE points a local rig at a fake LINE; prod never sets it.
const lineApi = (env) => (env && env.LINE_API_BASE) || "https://api.line.me";

export async function notifyGroup(env, to, text) {
  const token = env && env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token || !to || !text) return { ok: false, skipped: true };
  try {
    const res = await fetch(`${lineApi(env)}/v2/bot/message/push`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ to, messages: [{ type: "text", text: String(text).slice(0, 5000) }] }),
    });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

// What a group push costs and what is left this month, for the Dashboard confirm:
// LINE counts one message per person in the group. Read only and best effort, a
// number LINE does not give comes back null. left stays null on an unlimited plan.
export async function lineQuota(env, groupId) {
  const token = env && env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token || !groupId) return { members: null, left: null };
  const get = (path) => fetch(`${lineApi(env)}/v2/bot/${path}`, { headers: { "Authorization": `Bearer ${token}` } })
    .then(r => r.ok ? r.json() : null).catch(() => null);
  const [quota, used, group] = await Promise.all([get("message/quota"), get("message/quota/consumption"), get(`group/${encodeURIComponent(groupId)}/members/count`)]);
  const limited = quota && quota.type === "limited" && used && typeof used.totalUsage === "number";
  return {
    members: group && typeof group.count === "number" ? group.count : null,
    left: limited ? Math.max(0, quota.value - used.totalUsage) : null,
  };
}
