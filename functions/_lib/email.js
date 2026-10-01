// Email notifications (2026-10-01). Every event that used to push to LINE one
// by one (job add / edit / declined / cancelled, gear requests and approvals,
// early pickup / return, returns waiting for approval, damage reports, crew
// sign-ups, invoices) is now an email; LINE carries only the 08:00 group
// summary (functions/api/daily-summary.js), which keeps the 300 / month LINE cap.
//
// The client sends a STRUCTURED message (heading, sections of label/value rows,
// lists, one link), never HTML: this module escapes everything and renders the
// one template, so a crafted request cannot put markup or a foreign link in a
// mail that leaves under the house's name.
//
// Transport: Resend (RESEND_API_KEY, the WAYN account, send-only key). Its free
// plan allows 100 emails a day across the WHOLE account (WAYN sends too), so a
// daily cap (EMAIL_DAILY_CAP, default 50) stops this app from eating WAYN's share.
// Local / testing: EMAIL_DRY_RUN=1 stores every mail in KV (outbox:*) instead of
// sending (see functions/api/email-outbox.js); EMAIL_REDIRECT_TO=<addr> sends
// everything to one inbox with the real recipient in the subject.

export const APP_URL = "https://pickshootreturn.pages.dev";
export const DEFAULT_FROM = "Pick Shoot Return <pickshootreturn@wayn-industry.com>";
export const DEFAULT_DAILY_CAP = 50;
export const CREW_HOURLY_LIMIT = 30;

const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/;
export const isEmail = (s) => typeof s === "string" && s.length <= 254 && EMAIL_RE.test(s.trim());
export const cleanEmail = (s) => (isEmail(s) ? s.trim().toLowerCase() : "");

// ── message shape ───────────────────────────────────────────────────────────
const str = (v, max) => String(v == null ? "" : v).replace(/\r\n?/g, "\n").trim().slice(0, max);
const TONES = new Set(["info", "good", "bad", "warn"]);

// Coerce whatever the client sent into the one shape the template knows.
// Returns null when there is nothing worth sending (no subject or no content).
export function normalizeMessage(input, { appUrl = APP_URL } = {}) {
  if (!input || typeof input !== "object") return null;
  const subject = str(input.subject, 200).replace(/\n+/g, " ");
  const heading = str(input.heading, 200) || subject;
  const intro = str(input.intro, 1500);
  const tone = TONES.has(input.tone) ? input.tone : "info";
  const sections = (Array.isArray(input.sections) ? input.sections : []).slice(0, 12).map(s => {
    if (!s || typeof s !== "object") return null;
    const rows = (Array.isArray(s.rows) ? s.rows : []).slice(0, 60)
      .map(r => Array.isArray(r) ? [str(r[0], 80), str(r[1], 2000)] : null)
      .filter(r => r && (r[0] || r[1]));
    const items = (Array.isArray(s.items) ? s.items : []).slice(0, 100).map(x => str(x, 500)).filter(Boolean);
    const title = str(s.title, 120);
    return rows.length || items.length ? { title, rows, items } : null;
  }).filter(Boolean);
  if (!subject || (!intro && !sections.length)) return null;
  return { subject, heading, intro, tone, sections, link: safeLink(input.link, appUrl) };
}

// Only links into this app (the configured origin or production) survive; a
// relative path is made absolute. Anything else falls back to the app home.
export function safeLink(link, appUrl = APP_URL) {
  const label = str(link && link.label, 80) || "Open Pick Shoot Return";
  const raw = str(link && link.url, 500);
  const origins = [...new Set([appUrl, APP_URL].map(u => String(u || "").replace(/\/+$/, "")).filter(Boolean))];
  let url = origins[0] + "/";
  if (raw.startsWith("/") && !raw.startsWith("//")) url = origins[0] + raw;
  else if (origins.some(o => raw === o || raw.startsWith(o + "/") || raw.startsWith(o + "?"))) url = raw;
  return { url, label };
}

// ── rendering ───────────────────────────────────────────────────────────────
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const br = (s) => esc(s).replace(/\n/g, "<br>");
const TONE_COLOR = { info: "#2563EB", good: "#2F855A", bad: "#C53030", warn: "#B7791F" };

export function renderEmail(msg, { companyName = "Pick Shoot Return" } = {}) {
  const color = TONE_COLOR[msg.tone] || TONE_COLOR.info;
  const font = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Noto Sans Thai',Tahoma,Arial,sans-serif";
  const sectionHtml = msg.sections.map(s => {
    const title = s.title ? `<tr><td style="padding:18px 0 6px;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#5F7A91">${esc(s.title)}</td></tr>` : "";
    const rows = s.rows.length ? `<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #D8E1EC;border-radius:8px">${s.rows.map(([k, v], i) =>
      `<tr><td valign="top" style="padding:9px 12px;width:36%;font-size:13px;color:#5F7A91;${i ? "border-top:1px solid #E8EEF5;" : ""}">${br(k)}</td><td valign="top" style="padding:9px 12px;font-size:14px;color:#16324A;font-weight:600;${i ? "border-top:1px solid #E8EEF5;" : ""}">${br(v || "-")}</td></tr>`).join("")}</table></td></tr>` : "";
    const items = s.items.length ? `<tr><td style="padding:2px 0 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #D8E1EC;border-radius:8px">${s.items.map((x, i) =>
      `<tr><td style="padding:8px 12px;font-size:14px;color:#16324A;${i ? "border-top:1px solid #E8EEF5;" : ""}">${br(x)}</td></tr>`).join("")}</table></td></tr>` : "";
    return title + rows + items;
  }).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="format-detection" content="telephone=no,date=no,address=no,email=no"><title>${esc(msg.subject)}</title></head>
<body style="margin:0;padding:0;background:#F4F7FB;${font}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F7FB"><tr><td align="center" style="padding:20px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#FFFFFF;border:1px solid #D8E1EC;border-radius:12px;${font}">
<tr><td style="height:6px;background:${color};border-radius:12px 12px 0 0;font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="padding:20px 22px 22px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="font-size:12px;color:#5F7A91;padding-bottom:6px">${esc(companyName)}</td></tr>
<tr><td style="font-size:20px;line-height:1.3;font-weight:700;color:#16324A">${br(msg.heading)}</td></tr>
${msg.intro ? `<tr><td style="padding-top:10px;font-size:14px;line-height:1.55;color:#16324A">${br(msg.intro)}</td></tr>` : ""}
${sectionHtml}
<tr><td style="padding-top:22px"><a href="${esc(msg.link.url)}" style="display:inline-block;background:${color};color:#FFFFFF;text-decoration:none;font-size:14px;font-weight:700;padding:12px 20px;border-radius:8px">${esc(msg.link.label)}</a></td></tr>
<tr><td style="padding-top:10px;font-size:12px;color:#7B8FA3;word-break:break-all">${esc(msg.link.url)}</td></tr>
</table></td></tr></table>
<p style="font-size:11px;color:#7B8FA3;margin:12px 0 0">Sent automatically by Pick Shoot Return.</p>
</td></tr></table></body></html>`;
  const text = [
    companyName, "", msg.heading, ...(msg.intro ? ["", msg.intro] : []),
    ...msg.sections.flatMap(s => ["", ...(s.title ? [s.title.toUpperCase()] : []), ...s.rows.map(([k, v]) => `${k}: ${v || "-"}`), ...s.items.map(x => `- ${x}`)]),
    "", `${msg.link.label}: ${msg.link.url}`,
  ].join("\n");
  return { html, text };
}

// ── who receives it ─────────────────────────────────────────────────────────
// Crew may write to the house and to themselves; only an admin may write to
// another crew member or to the whole crew.
export function allowedTargets(to, session) {
  const t = to && typeof to === "object" ? to : {};
  const isAdmin = session && session.role === "admin";
  const ids = (Array.isArray(t.employeeIds) ? t.employeeIds : []).map(String).filter(Boolean);
  return {
    admin: !!t.admin,
    allCrew: isAdmin && !!t.allCrew,
    employeeIds: isAdmin ? ids : ids.filter(id => session && id === String(session.id)),
  };
}

// Index key holding one crew member's email, written on every profile save so
// a send never has to read the multi-MB profile blobs.
export const emailKey = (empId) => `pemail:${empId}`;

export async function emailOf(kv, empId) {
  const id = String(empId || "");
  if (!id) return "";
  const idx = await kv.get(emailKey(id));
  if (idx != null) return cleanEmail(idx);
  // Not indexed yet (profile saved before this feature): read the profile once and index it.
  const raw = await kv.get(`profile_${id}`);
  let addr = "";
  try { addr = cleanEmail(JSON.parse(raw || "{}").email); } catch { addr = ""; }
  await kv.put(emailKey(id), addr);
  return addr;
}

export async function indexProfileEmail(kv, empId, profile) {
  await kv.put(emailKey(String(empId)), cleanEmail(profile && profile.email));
}

const liveEmployees = (list) => (Array.isArray(list) ? list : []).filter(e => e && e.id != null && !e._deleted && e.id !== "admin");

// [{ email, name, id }] for the allowed targets, deduped by address, plus the
// people who could not be reached and why.
export async function resolveRecipients(kv, targets, { employees, adminEmail }) {
  const out = [], skipped = [], seen = new Set();
  const add = (email, who) => {
    if (!email) { skipped.push({ ...who, reason: "no email" }); return; }
    if (seen.has(email)) return;
    seen.add(email); out.push({ email, ...who });
  };
  if (targets.admin) add(cleanEmail(adminEmail), { id: "admin", name: "Admin" });
  const emps = liveEmployees(employees);
  const byId = new Map(emps.map(e => [String(e.id), e]));
  const ids = targets.allCrew ? emps.map(e => String(e.id)) : targets.employeeIds.filter(id => byId.has(id));
  for (const id of [...new Set(ids)]) add(await emailOf(kv, id), { id, name: byId.get(id)?.name || id });
  return { recipients: out, skipped };
}

// ── limits ──────────────────────────────────────────────────────────────────
const dayKey = (now) => `email:day:${new Date(now).toISOString().slice(0, 10)}`;
export const dailyCap = (env) => { const n = parseInt(env && env.EMAIL_DAILY_CAP, 10); return n > 0 ? n : DEFAULT_DAILY_CAP; };
export async function sentToday(kv, now = Date.now()) {
  return parseInt(await kv.get(dayKey(now)), 10) || 0;
}
async function bumpToday(kv, n, now) {
  const count = (await sentToday(kv, now)) + n;
  await kv.put(dayKey(now), String(count), { expirationTtl: 3 * 86400 });
  return count;
}
// Crew sessions: CREW_HOURLY_LIMIT mails an hour each (a stuck retry loop or a
// curious crew member cannot drain the shared daily allowance).
export async function crewHourlyOk(kv, sessionId, n, now = Date.now()) {
  const key = `email:rl:${sessionId}:${new Date(now).toISOString().slice(0, 13)}`;
  const used = parseInt(await kv.get(key), 10) || 0;
  if (used + n > CREW_HOURLY_LIMIT) return false;
  await kv.put(key, String(used + n), { expirationTtl: 7200 });
  return true;
}

export const providerOf = (env) => (env && env.EMAIL_DRY_RUN === "1" ? "dry-run" : env && env.RESEND_API_KEY ? "resend" : "none");

// ── transport ───────────────────────────────────────────────────────────────
// mails: [{ to, subject, html, text, replyTo? }]. One mail per recipient so no
// one sees anyone else's address. Returns { ok, sent, error?, dryRun? }.
export async function sendMails(env, mails, now = Date.now()) {
  if (!mails.length) return { ok: true, sent: 0 };
  const provider = providerOf(env);
  if (provider === "none") return { ok: false, sent: 0, error: "email not configured (RESEND_API_KEY missing)" };
  const cap = dailyCap(env);
  const used = await sentToday(env.KV, now);
  if (used + mails.length > cap) return { ok: false, sent: 0, error: `daily email limit reached (${used}/${cap})`, capped: true };
  const from = (env.EMAIL_FROM || DEFAULT_FROM).trim();
  const redirect = cleanEmail(env.EMAIL_REDIRECT_TO);
  const prepared = mails.map(m => ({
    from,
    to: [redirect || m.to],
    subject: redirect ? `[for ${m.to}] ${m.subject}` : m.subject,
    html: m.html,
    text: m.text,
    ...(m.replyTo ? { reply_to: m.replyTo } : {}),
  }));
  if (provider === "dry-run") {
    let i = 0;
    for (const p of prepared) {
      const id = `${now}-${String(i++).padStart(3, "0")}`;
      await env.KV.put(`outbox:${id}`, JSON.stringify({ id, at: now, ...p }), { expirationTtl: 7 * 86400 });
    }
    await bumpToday(env.KV, prepared.length, now);
    return { ok: true, sent: prepared.length, dryRun: true };
  }
  let sent = 0;
  for (let i = 0; i < prepared.length; i += 100) {
    const chunk = prepared.slice(i, i + 100);
    let res;
    try {
      res = await fetch("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify(chunk),
      });
    } catch (e) {
      if (sent) await bumpToday(env.KV, sent, now);
      return { ok: false, sent, error: `email service unreachable: ${String(e && e.message || e).slice(0, 200)}` };
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      if (sent) await bumpToday(env.KV, sent, now);
      return { ok: false, sent, error: `Resend ${res.status}: ${detail.slice(0, 300)}` };
    }
    sent += chunk.length;
  }
  await bumpToday(env.KV, sent, now);
  return { ok: true, sent };
}

// The whole send: render once, one mail per recipient.
export async function deliver(env, msg, recipients, { companyName, replyTo } = {}) {
  const { html, text } = renderEmail(msg, { companyName });
  const reply = cleanEmail(replyTo);
  const mails = recipients.map(r => ({ to: r.email, subject: msg.subject, html, text, ...(reply && reply !== r.email ? { replyTo: reply } : {}) }));
  return sendMails(env, mails);
}
