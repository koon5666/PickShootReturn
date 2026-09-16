// 09:00 overdue-gear digest (P1-11). Pure composer, unit-tested in
// digest.test.js; the route (functions/api/overdue-digest.js) reads KV and
// pushes, the cron lives in presence-worker (Pages has no scheduled trigger).
// The rows come from the same still-out model the dashboard uses
// (src/logic/availability.js stillOutList), so the LINE list and the Not
// Returned card never disagree.
import { stillOutList } from "../../src/logic/availability.js";

const fmtDate = (ds, tz) => {
  try { return new Intl.DateTimeFormat("en-GB", { timeZone: tz || "Asia/Bangkok", day: "numeric", month: "short" }).format(new Date(ds + "T12:00:00Z")); }
  catch { return ds; }
};
export const todayIn = (tz, now = Date.now()) => {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "Asia/Bangkok" }).format(new Date(now)); }
  catch { return new Date(now).toISOString().slice(0, 10); }
};

// { rows, text, employeeIds, count }; text is null when nothing is overdue.
export function buildOverdueDigest({ jobs, equipment, checkouts, equipmentRequests, employees, today, tz, companyName, appUrl = "https://pickshootreturn.pages.dev" } = {}) {
  const t = today || todayIn(tz);
  const rows = stillOutList({ checkouts: checkouts || [], jobs: jobs || [], equipment: equipment || [], equipmentRequests: equipmentRequests || [], today: t, tz })
    .filter(r => r.overdue || r.dueToday);
  const overdue = rows.filter(r => r.overdue);
  const dueToday = rows.filter(r => r.dueToday);
  if (!rows.length) return { rows, overdue, dueToday, text: null, employeeIds: [], count: 0 };
  const emps = new Map((employees || []).filter(e => e && e.id != null).map(e => [e.id, e]));
  const who = (r) => r.pickedBy || (r.pickedById && emps.get(r.pickedById) ? emps.get(r.pickedById).name : null) || "?";
  const line = (r) => `• ${r.qty} × ${r.eqName} · ${r.jobName}${r.jobGone ? " (job deleted)" : ""} · ${who(r)}${r.dueDate ? ` · due ${fmtDate(r.dueDate, tz)}` : ""}${r.overdue ? ` (${r.daysOverdue}d late)` : ""}`;
  const head = `⚠ Overdue gear / ของเกินกำหนดคืน · ${companyName || "Pick Shoot Return"} · ${fmtDate(t, tz)}`;
  const parts = [head];
  if (overdue.length) parts.push(`Overdue (${overdue.length}):`, ...overdue.map(line));
  if (dueToday.length) parts.push(`Due today (${dueToday.length}):`, ...dueToday.map(line));
  parts.push(`🔗 ${appUrl}`);
  const employeeIds = [...new Set(rows.map(r => r.pickedById).filter(Boolean))];
  return { rows, overdue, dueToday, text: parts.join("\n").slice(0, 4000), employeeIds, count: rows.length };
}

// One digest per calendar day (in the tenant timezone), whatever fires it.
export function digestAlreadySent(lastSent, today) {
  return !!lastSent && lastSent.day === today;
}
