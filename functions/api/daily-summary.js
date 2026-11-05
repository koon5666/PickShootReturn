// 08:00 daily summary (2026-10-01), see functions/_lib/dailySummary.js.
//   GET  /api/daily-summary          admin: preview (the text, skipped or not, who gets an overdue email)
//                                    ?manual=1 previews the Dashboard push, with its LINE cost and the last push
//   POST /api/daily-summary          the cron worker (header X-Digest-Token: <DIGEST_TOKEN>) or an admin
//                                    ({ manual: true } = Dashboard "Push to LINE group", see pushManual)
//   PUT  /api/daily-summary          admin: { enabled } turns the LINE post on or off for the whole house
// One LINE group post per tenant day (KV `digest:daily`), so a retried cron cannot
// double-post. Crew holding overdue / due-today gear get it by EMAIL, never LINE.
// Schedule: presence-worker/index.js `scheduled` at 01:00 UTC = 08:00 Bangkok.
import { requireAdmin, readJson } from "../_lib/auth.js";
import { appendAudit } from "../_lib/audit.js";
import { readAllFields, writeField } from "../_lib/store.js";
import { todayIn } from "../_lib/digest.js";
import { buildDailySummary, buildManualPush, pushBudget, overdueEmailMessage, summaryAlreadySent } from "../_lib/dailySummary.js";
import { notifyGroup, lineQuota } from "../_lib/line.js";
import { sweepExpiredPencils } from "../_lib/pencilSweep.js";
import { normalizeMessage, emailOf, deliver, cleanEmail, APP_URL } from "../_lib/email.js";

const LAST_KEY = "digest:daily";
const MANUAL_KEY = "digest:manual";

async function readHouse(env) {
  const { values } = await readAllFields(env.KV);
  const tz = typeof values.timezone === "string" && values.timezone ? values.timezone : "Asia/Bangkok";
  return {
    values, tz, today: todayIn(tz),
    companyName: typeof values.companyName === "string" && values.companyName.trim() ? values.companyName.trim() : "Pick Shoot Return",
    groupId: typeof values.lineGroupId === "string" && values.lineGroupId ? values.lineGroupId : null,
    enabled: !(values.lineSummary && values.lineSummary.enabled === false),
  };
}

async function compose(env, appUrl) {
  const house = await readHouse(env);
  const { values, tz, today, companyName } = house;
  const summary = buildDailySummary({ jobs: values.jobs, equipment: values.equipment, checkouts: values.checkouts, equipmentRequests: values.equipmentRequests, employees: values.employees, today, tz, companyName, appUrl });
  return {
    ...house, summary,
    employees: Array.isArray(values.employees) ? values.employees : [],
    adminEmail: cleanEmail(values.adminEmail),
  };
}

async function composePush(env) {
  const house = await readHouse(env);
  return { ...house, push: buildManualPush({ jobs: house.values.jobs, today: house.today, companyName: house.companyName, appUrl: env.APP_URL || APP_URL }) };
}

export async function onRequestGet(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) return auth.response;
  const { env, request } = context;
  if (new URL(request.url).searchParams.get("manual") === "1") {
    const { push, today, groupId, enabled } = await composePush(env);
    const [quota, last, daily] = await Promise.all([lineQuota(env, groupId), env.KV.get(MANUAL_KEY, "json"), env.KV.get(LAST_KEY, "json")]);
    const budget = pushBudget({ ...quota, today, dailySentToday: summaryAlreadySent(daily, today), dailyEnabled: enabled });
    return Response.json({ ok: true, group: !!groupId, text: push.text, skipped: push.skipped, budget, last: last || null }, { headers: { "Cache-Control": "no-store" } });
  }
  const { summary, today, groupId, enabled } = await compose(env, env.APP_URL || APP_URL);
  const last = await env.KV.get(LAST_KEY, "json");
  return Response.json({
    ok: true, today, enabled, group: !!groupId,
    text: summary.text, skipped: summary.skipped, counts: summary.counts,
    overdueCrew: Object.keys(summary.overdueByEmployee).length,
    sentToday: summaryAlreadySent(last, today), last: last || null,
  }, { headers: { "Cache-Control": "no-store" } });
}

// Dashboard "Push to LINE group" (2026-11-05): the calendar and booking stats, now.
// LINE only on purpose: `digest:daily` stays untouched so the 08:00 post still goes
// that morning, and the overdue emails stay with the 08:00 run. The Settings switch
// is about the automatic post, so it does not stop an admin pressing this.
async function pushManual(env, session) {
  const { push, groupId } = await composePush(env);
  if (!push.text) return Response.json({ ok: true, posted: false, lineReason: push.skipped });
  if (!groupId) return Response.json({ ok: true, posted: false, lineReason: "no LINE group connected" });
  const r = await notifyGroup(env, groupId, push.text);
  if (r.skipped) return Response.json({ ok: false, error: "LINE_CHANNEL_ACCESS_TOKEN not configured" }, { status: 500 });
  if (!r.ok) return Response.json({ ok: false, error: r.status === 429 ? "LINE monthly message limit reached" : `LINE ${r.status || r.error || "error"}` }, { status: 502 });
  const record = { at: Date.now(), by: session.name || "Admin" };
  await env.KV.put(MANUAL_KEY, JSON.stringify(record));
  await appendAudit(env.KV, session, { action: "line.push" });
  return Response.json({ ok: true, posted: true, ...record });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  const token = request.headers.get("X-Digest-Token") || "";
  const cron = !!(env.DIGEST_TOKEN && token && token === env.DIGEST_TOKEN);
  if (!cron) {
    const auth = await requireAdmin(context);
    if (!auth.ok) return auth.response;
    if ((await readJson(request)).manual) return pushManual(env, auth.session);
  }
  const appUrl = env.APP_URL || APP_URL;
  // Expired pencils turn Declined before the summary is composed (2026-10-20).
  let pencils = null;
  try { pencils = await sweepExpiredPencils(env.KV); } catch (e) { pencils = { error: String(e && e.message || e) }; }
  const { summary, today, groupId, enabled, employees, adminEmail, companyName } = await compose(env, appUrl);
  const last = await env.KV.get(LAST_KEY, "json");
  if (summaryAlreadySent(last, today)) return Response.json({ ok: true, skipped: "already sent today", today, last, pencils });

  // LINE: the one group post.
  let line = { posted: false, reason: null };
  if (!summary.text) line.reason = summary.skipped;
  else if (!enabled) line.reason = "LINE summary turned off in Settings";
  else if (!groupId) line.reason = "no LINE group connected";
  else {
    const r = await notifyGroup(env, groupId, summary.text);
    if (r.skipped) return Response.json({ ok: false, error: "LINE_CHANNEL_ACCESS_TOKEN not configured", today }, { status: 500 });
    line = { posted: !!r.ok, reason: r.ok ? null : `LINE ${r.status || r.error || "error"}` };
  }

  // Email: each crew member holding overdue / due-today gear, once a day.
  let emailed = 0;
  const emailErrors = [];
  const alreadyEmailed = last && last.day === today && last.emailedDay === today;
  if (!alreadyEmailed) {
    const byId = new Map(employees.filter(e => e && e.id != null).map(e => [String(e.id), e]));
    for (const [empId, rows] of Object.entries(summary.overdueByEmployee)) {
      const addr = await emailOf(env.KV, empId);
      if (!addr) continue;
      const msg = normalizeMessage(overdueEmailMessage(rows, { name: byId.get(empId)?.name, today, appUrl }), { appUrl });
      if (!msg) continue;
      const r = await deliver(env, msg, [{ email: addr, id: empId }], { companyName, replyTo: adminEmail });
      if (r.ok) emailed += r.sent; else emailErrors.push(r.error);
    }
  }

  const record = { day: today, at: Date.now(), posted: line.posted, lineReason: line.reason, emailed, emailedDay: alreadyEmailed || emailed || !Object.keys(summary.overdueByEmployee).length ? today : (last && last.emailedDay) || null, counts: summary.counts };
  await env.KV.put(LAST_KEY, JSON.stringify(record));
  return Response.json({ ok: true, today, ...record, emailErrors, pencils });
}

export async function onRequestPut(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) return auth.response;
  const body = await readJson(context.request);
  const enabled = body.enabled !== false;
  await writeField(context.env.KV, "lineSummary", { enabled });
  return Response.json({ ok: true, enabled });
}
