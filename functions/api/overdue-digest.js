// Overdue-gear digest (P1-11).
//   GET  /api/overdue-digest              admin session: preview (what would be sent, to whom)
//   POST /api/overdue-digest              send it: the cron worker with header X-Digest-Token:
//                                         <DIGEST_TOKEN> (Pages secret), or an admin session
//                                         ({ force: true } resends today)
// Pushes to the house group (lineGroupId) and to every LINE-linked crew member
// who still holds overdue gear (functions/_lib/linelink.js). One send per tenant
// day (KV `digest:overdue`), so a retried cron cannot double-post.
// Schedule: presence-worker/index.js `scheduled` at 02:00 UTC = 09:00 Bangkok.
import { requireAdmin, readJson } from "../_lib/auth.js";
import { readAllFields } from "../_lib/store.js";
import { buildOverdueDigest, digestAlreadySent, todayIn } from "../_lib/digest.js";
import { notifyGroup } from "../_lib/line.js";
import { resolveLineUserIds } from "../_lib/linelink.js";

async function compose(env) {
  const { values } = await readAllFields(env.KV);
  const tz = typeof values.timezone === "string" && values.timezone ? values.timezone : "Asia/Bangkok";
  const today = todayIn(tz);
  const digest = buildOverdueDigest({ jobs: values.jobs, equipment: values.equipment, checkouts: values.checkouts, equipmentRequests: values.equipmentRequests, employees: values.employees, today, tz, companyName: values.companyName });
  const userIds = resolveLineUserIds(Array.isArray(values.employees) ? values.employees : [], digest.employeeIds);
  return { digest, today, groupId: typeof values.lineGroupId === "string" ? values.lineGroupId : null, userIds };
}

export async function onRequestGet(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) return auth.response;
  const { digest, today, groupId, userIds } = await compose(context.env);
  const last = await context.env.KV.get("digest:overdue", "json");
  return Response.json({ ok: true, today, count: digest.count, text: digest.text, group: !!groupId, linkedCrew: userIds.length, sentToday: digestAlreadySent(last, today), last: last || null });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  const token = request.headers.get("X-Digest-Token") || "";
  const cron = !!(env.DIGEST_TOKEN && token && token === env.DIGEST_TOKEN);
  let force = false;
  if (!cron) {
    const auth = await requireAdmin(context);
    if (!auth.ok) return auth.response;
    force = !!(await readJson(request)).force;
  }
  const { digest, today, groupId, userIds } = await compose(env);
  const last = await env.KV.get("digest:overdue", "json");
  if (!force && digestAlreadySent(last, today)) return Response.json({ ok: true, skipped: "already sent today", today, last });
  if (!digest.text) {
    await env.KV.put("digest:overdue", JSON.stringify({ day: today, at: Date.now(), count: 0, sent: 0 }));
    return Response.json({ ok: true, today, count: 0, sent: 0 });
  }
  const targets = [...(groupId ? [groupId] : []), ...userIds.filter(u => u !== groupId)];
  const results = [];
  for (const to of targets) results.push(await notifyGroup(env, to, digest.text));
  const sent = results.filter(r => r.ok).length;
  // No LINE token configured: nothing went out, so do not mark the day as sent.
  if (targets.length && results.every(r => r.skipped)) return Response.json({ ok: false, error: "LINE_CHANNEL_ACCESS_TOKEN not configured", today, count: digest.count, targets: targets.length }, { status: 500 });
  await env.KV.put("digest:overdue", JSON.stringify({ day: today, at: Date.now(), count: digest.count, sent, targets: targets.length }));
  return Response.json({ ok: true, today, count: digest.count, targets: targets.length, sent });
}
