// Email notifications (2026-10-01), see functions/_lib/email.js.
//   POST /api/email { to: { admin?, employeeIds?, allCrew? }, message }   any session
//        crew may address the house and themselves; admin may address anyone
//   POST /api/email { test: true }                                          admin: one test mail to the admin address
//   GET  /api/email                                                         admin: status (provider, today's count, who has no email)
//   PUT  /api/email { adminEmail }                                          admin: where house emails go ("" clears it)
import { requireSession, requireAdmin, readJson } from "../_lib/auth.js";
import { readField, writeField } from "../_lib/store.js";
import { normalizeMessage, allowedTargets, resolveRecipients, deliver, emailOf, crewHourlyOk, providerOf, dailyCap, sentToday, cleanEmail, DEFAULT_FROM } from "../_lib/email.js";

async function context(env) {
  const [emps, admin, company] = await Promise.all([readField(env.KV, "employees"), readField(env.KV, "adminEmail"), readField(env.KV, "companyName")]);
  return {
    employees: Array.isArray(emps.value) ? emps.value : [],
    adminEmail: cleanEmail(admin.value),
    companyName: typeof company.value === "string" && company.value.trim() ? company.value.trim() : "Pick Shoot Return",
  };
}

export async function onRequestGet(ctx) {
  const auth = await requireAdmin(ctx);
  if (!auth.ok) return auth.response;
  const { env } = ctx;
  const { employees, adminEmail } = await context(env);
  const crew = [];
  for (const e of employees.filter(e => e && e.id != null && !e._deleted && e.id !== "admin")) {
    crew.push({ id: e.id, name: e.name || e.id, hasEmail: !!(await emailOf(env.KV, e.id)) });
  }
  return Response.json({
    ok: true,
    provider: providerOf(env),
    from: (env.EMAIL_FROM || DEFAULT_FROM).trim(),
    adminEmail: adminEmail || null,
    today: { count: await sentToday(env.KV), cap: dailyCap(env) },
    crew,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function onRequestPost(ctx) {
  const auth = await requireSession(ctx);
  if (!auth.ok) return auth.response;
  const { env, request } = ctx;
  const session = auth.session;
  const body = await readJson(request);
  const appUrl = new URL(request.url).origin;
  const { employees, adminEmail, companyName } = await context(env);

  if (body.test) {
    if (session.role !== "admin") return Response.json({ ok: false, error: "admin only" }, { status: 403 });
    if (!adminEmail) return Response.json({ ok: false, error: "Set the admin email in Settings first" }, { status: 400 });
    const msg = normalizeMessage({
      subject: "Test email from Pick Shoot Return",
      heading: "Email notifications are working",
      intro: "This is a test. Gear requests, approvals, job changes and the rest will arrive like this, with every detail in the email.\nนี่คืออีเมลทดสอบ การแจ้งเตือนทั้งหมดจะส่งมาแบบนี้ พร้อมรายละเอียดครบในอีเมล",
      tone: "good",
    }, { appUrl });
    const r = await deliver(env, msg, [{ email: adminEmail, id: "admin", name: "Admin" }], { companyName });
    return Response.json({ ...r, to: adminEmail }, { status: r.ok ? 200 : 502 });
  }

  const msg = normalizeMessage(body.message, { appUrl });
  if (!msg) return Response.json({ ok: false, error: "empty message" }, { status: 400 });
  const targets = allowedTargets(body.to, session);
  const { recipients, skipped } = await resolveRecipients(env.KV, targets, { employees, adminEmail });
  if (!recipients.length) return Response.json({ ok: true, sent: 0, skipped });
  if (session.role !== "admin" && !(await crewHourlyOk(env.KV, session.id, recipients.length))) {
    return Response.json({ ok: false, sent: 0, skipped, error: "too many emails this hour" }, { status: 429 });
  }
  // Replies go back to whoever caused the mail: the crew member, or the house.
  const replyTo = session.role === "admin" ? adminEmail : await emailOf(env.KV, session.id);
  const r = await deliver(env, msg, recipients, { companyName, replyTo });
  return Response.json({ ...r, skipped }, { status: r.ok ? 200 : (r.capped ? 429 : 502) });
}

export async function onRequestPut(ctx) {
  const auth = await requireAdmin(ctx);
  if (!auth.ok) return auth.response;
  const body = await readJson(ctx.request);
  const raw = String(body.adminEmail ?? "").trim();
  const adminEmail = cleanEmail(raw);
  if (raw && !adminEmail) return Response.json({ ok: false, error: "That does not look like an email address" }, { status: 400 });
  await writeField(ctx.env.KV, "adminEmail", adminEmail || null);
  return Response.json({ ok: true, adminEmail: adminEmail || null });
}
