// 08:00 daily LINE summary (2026-10-01): the ONLY thing this app still posts to
// LINE. Everything else is email (functions/_lib/email.js). One group post a day
// costs one message per person in the group, so a group of up to 9 stays under
// the free 300 / month even on a 31-day month, and empty days are skipped.
//
// The post: what happens today and tomorrow (shoot days, gear pickups, gear
// returns), overdue gear and gear due back today, then Koon's job summary
// calendar (src/logic/roster.js jobSummaryBlocks, same format as before).
// Skipped when nothing happens today or tomorrow and nothing is overdue or due.
// Pure composer, unit-tested in dailySummary.test.js.
import { buildOverdueDigest } from "./digest.js";
import { jobSummaryBlocks, fitRecapBlocks, normalizeCrew } from "../../src/logic/roster.js";
import { addDays, effPickupDate, effReturnDate } from "../../src/logic/availability.js";

const LIVE = new Set(["Confirmed", "Pencil"]);
const MARK = { Confirmed: "✅", Pencil: "✏️" };
export const LINE_MAX = 4800; // LINE refuses a text over 5000 characters

const fmtDay = (ds) => {
  try { return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(ds + "T12:00:00Z")).replace(",", ""); }
  catch { return ds; }
};

// What one job does on one day: shoot, pickup, return (a 1-day job can be all three).
export function jobEventsOn(job, ds) {
  if (!job || !LIVE.has(job.status)) return [];
  const out = [];
  const dates = (job.dates || []).filter(Boolean);
  if (!dates.length) return out;
  const pickup = effPickupDate(job), ret = effReturnDate(job);
  if (pickup === ds && !dates.includes(ds)) out.push("gear pickup");
  if (dates.includes(ds)) out.push("shoot day");
  if (ret === ds && !dates.includes(ds)) out.push("gear return");
  return out;
}

function dayLines(jobs, ds, employees) {
  const byId = new Map((employees || []).filter(e => e && e.id != null).map(e => [String(e.id), e]));
  const rows = [];
  for (const job of jobs || []) {
    const ev = jobEventsOn(job, ds);
    if (!ev.length) continue;
    const ov = (job.dateOverrides || {})[ds] || {};
    const loc = [ov.location || job.location, ov.locationCity || job.locationCity].filter(v => String(v || "").trim()).join(" · ");
    const time = ov.shootTime || job.shootTime;
    const head = `• ${[job.production || "TBA", job.name || "TBA"].join(", ")} ${MARK[job.status] || ""}`.trimEnd();
    const detail = [ev.join(" + "), loc ? `📍 ${loc}` : "", ev.includes("shoot day") && time ? time : ""].filter(Boolean).join(" · ");
    const crew = normalizeCrew(job.crew).map(r => {
      const name = byId.get(r.employeeId)?.name || r.employeeId;
      const bits = [r.role, r.callTime ? `call ${r.callTime}` : "", r.pickupTime ? `pickup ${r.pickupTime}` : ""].filter(Boolean).join(", ");
      return bits ? `${name} (${bits})` : name;
    });
    rows.push({ first: (job.dates || []).slice().sort()[0] || "", lines: [head, `   ${detail}`, ...(crew.length ? [`   👥 ${crew.join(", ")}`] : [])] });
  }
  return rows.sort((a, b) => a.first.localeCompare(b.first)).flatMap(r => r.lines);
}

// { text|null, skipped: reason|null, today, counts, overdueByEmployee: { empId: rows[] } }
export function buildDailySummary({ jobs, equipment, checkouts, equipmentRequests, employees, today, tz, companyName, appUrl = "https://pickshootreturn.pages.dev" } = {}) {
  const tomorrow = addDays(today, 1);
  const todayLines = dayLines(jobs, today, employees);
  const tomorrowLines = dayLines(jobs, tomorrow, employees);
  const digest = buildOverdueDigest({ jobs, equipment, checkouts, equipmentRequests, employees, today, tz, companyName, appUrl });
  const emps = new Map((employees || []).filter(e => e && e.id != null).map(e => [e.id, e]));
  const who = (r) => r.pickedBy || (r.pickedById && emps.get(r.pickedById) ? emps.get(r.pickedById).name : null) || "?";
  const gear = (r) => `• ${r.qty} × ${r.eqName} · ${r.jobName}${r.jobGone ? " (job deleted)" : ""} · ${who(r)}${r.dueDate ? ` · due ${fmtDay(r.dueDate)}` : ""}${r.overdue ? ` (${r.daysOverdue}d late)` : ""}`;
  const overdueByEmployee = {};
  for (const r of digest.rows) if (r.pickedById) (overdueByEmployee[r.pickedById] ||= []).push(r);
  const counts = { today: todayLines.filter(l => l.startsWith("•")).length, tomorrow: tomorrowLines.filter(l => l.startsWith("•")).length, overdue: digest.overdue.length, dueToday: digest.dueToday.length };
  const base = { today, counts, overdueByEmployee, rows: digest.rows };
  if (!counts.today && !counts.tomorrow && !counts.overdue && !counts.dueToday) return { ...base, text: null, skipped: "nothing today or tomorrow, nothing overdue" };

  const parts = [`☀️ Daily summary · ${fmtDay(today)}`, companyName || "Pick Shoot Return"];
  parts.push("", `TODAY / วันนี้`, ...(todayLines.length ? todayLines : ["• No shoot, pickup or return"]));
  parts.push("", `TOMORROW / พรุ่งนี้ (${fmtDay(tomorrow)})`, ...(tomorrowLines.length ? tomorrowLines : ["• No shoot, pickup or return"]));
  if (digest.overdue.length) parts.push("", `⚠ OVERDUE GEAR / ของเกินกำหนดคืน (${digest.overdue.length})`, ...digest.overdue.map(gear));
  if (digest.dueToday.length) parts.push("", `🔙 DUE BACK TODAY / ต้องคืนวันนี้ (${digest.dueToday.length})`, ...digest.dueToday.map(gear));
  const footer = `\n\n🔗 ${appUrl}`;
  let head = parts.join("\n");
  if (head.length + footer.length > LINE_MAX) head = head.slice(0, LINE_MAX - footer.length - 20).replace(/\n[^\n]*$/, "") + "\n…";
  const budget = LINE_MAX - head.length - footer.length - "\n\nJob summary\n".length;
  const blocks = jobSummaryBlocks(jobs, { today });
  const recap = budget > 200 && blocks.length ? fitRecapBlocks(blocks, budget) : [];
  const text = head + (recap.length ? `\n\nJob summary\n${recap.join("\n")}` : "") + footer;
  return { ...base, text, skipped: null };
}

// Personal email body for one crew member holding overdue / due-today gear.
export function overdueEmailMessage(rows, { name, today, appUrl } = {}) {
  const overdue = rows.filter(r => r.overdue), due = rows.filter(r => r.dueToday);
  const item = (r) => `${r.qty} × ${r.eqName} · ${r.jobName}${r.dueDate ? ` · due ${fmtDay(r.dueDate)}` : ""}${r.overdue ? ` (${r.daysOverdue} day${r.daysOverdue === 1 ? "" : "s"} late)` : ""}`;
  return {
    subject: overdue.length ? `Overdue gear: please return ${overdue.length === 1 ? "1 item" : `${overdue.length} items`}` : `Gear due back today (${due.length})`,
    heading: overdue.length ? "Gear past its return date / ของเกินกำหนดคืน" : "Gear due back today / ของที่ต้องคืนวันนี้",
    intro: `${name ? `Hi ${name}, ` : ""}our records show you still hold the gear below (as of ${fmtDay(today)}). Please bring it back, or tell the house if it is already returned.\nตามระบบ คุณยังถือของด้านล่างอยู่ กรุณานำมาคืน หรือแจ้งร้านถ้าคืนแล้ว`,
    tone: overdue.length ? "bad" : "warn",
    sections: [
      ...(overdue.length ? [{ title: "Overdue / เกินกำหนด", items: overdue.map(item) }] : []),
      ...(due.length ? [{ title: "Due today / คืนวันนี้", items: due.map(item) }] : []),
    ],
    link: { url: appUrl ? `${appUrl}/` : "/", label: "Open Pick Shoot Return" },
  };
}

export const summaryAlreadySent = (last, today) => !!last && last.day === today;
