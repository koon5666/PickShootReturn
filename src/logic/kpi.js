// KPI scoring (P3-2). Pure: no React, no globals. Everyone starts each period at
// `maxPoints`; events move the score. An event is a DEDUCTION unless it carries
// kind:"add" (a positive adjustment such as "returned early, clean"), so every
// record written before positive events existed keeps its meaning.
//
//   event = { id, employeeId, points (magnitude, >0), kind?: "deduct" | "add", reason, ts, by }
//   config = { startDate?: "YYYY-MM-DD", resetMonths?: number, maxPoints?: number }
export const KPI_MAX_DEFAULT = 100; // 100 pts == 5 stars

export const kpiAddMonths = (d, m) => { const x = new Date(d); x.setMonth(x.getMonth() + m); return x; };
export const kpiMax = (config) => parseFloat(config && config.maxPoints) || KPI_MAX_DEFAULT;

// Signed effect of one event on the score.
export function kpiDelta(ev) {
  const pts = Math.abs(parseFloat(ev && ev.points) || 0);
  return ev && ev.kind === "add" ? pts : -pts;
}
export const isKpiAdd = (ev) => !!ev && ev.kind === "add";

// Current scoring window [start, end) from config.startDate (default Jan 1 of the
// `today` year) + resetMonths. `todayStr` = "YYYY-MM-DD" in the app timezone.
export function kpiPeriod(config, todayStr) {
  const now = new Date((todayStr || new Date().toISOString().slice(0, 10)) + "T00:00:00");
  const startStr = (config && config.startDate) || `${now.getFullYear()}-01-01`;
  const start = new Date(startStr + "T00:00:00");
  const months = Math.max(1, parseInt(config && config.resetMonths) || 12);
  if (now < start) return { start, end: kpiAddMonths(start, months) };
  let s = new Date(start), guard = 0;
  while (guard++ < 4000) { const e = kpiAddMonths(s, months); if (now < e) return { start: s, end: e }; s = e; }
  return { start, end: kpiAddMonths(start, months) };
}

// Events of one employee inside the current period, newest first.
export function kpiEventsInPeriod(employeeId, kpiEvents, config, todayStr) {
  const { start, end } = kpiPeriod(config, todayStr);
  return (kpiEvents || [])
    .filter(ev => ev && ev.employeeId === employeeId && ev.ts >= start.getTime() && ev.ts < end.getTime())
    .sort((a, b) => b.ts - a.ts);
}

// Points this period: start at max, apply the signed deltas in the order they
// happened, clamping to [0, max] after EVERY event. A positive adjustment at full
// score is therefore worth nothing (it cannot bank above the max and soften a
// later deduction), and a deduction below zero does not build a debt.
export function kpiScore(employeeId, kpiEvents, config, todayStr) {
  const max = kpiMax(config);
  const chrono = kpiEventsInPeriod(employeeId, kpiEvents, config, todayStr).slice().reverse();
  return chrono.reduce((score, ev) => Math.max(0, Math.min(max, score + kpiDelta(ev))), max);
}
export const kpiStars = (score, config) => { const max = kpiMax(config); return max > 0 ? (score / max) * 5 : 0; };

// Build an event from the admin form. Returns { ok, event } or { ok:false, error }.
export function buildKpiEvent({ employeeId, points, reason, kind = "deduct", ruleId = null, by = "admin", now = Date.now() }) {
  const pts = Math.abs(parseFloat(points) || 0);
  if (!(pts > 0)) return { ok: false, error: "points" };
  const r = (reason || "").trim();
  if (!r) return { ok: false, error: "reason" };
  return { ok: true, event: { id: "kpi" + now, employeeId, points: pts, kind: kind === "add" ? "add" : "deduct", reason: r, punishmentId: ruleId || null, ts: now, by } };
}

// Deduction rules as shown to crew: only complete rows (label + points > 0).
export function visibleKpiRules(rules) {
  return (rules || []).filter(r => r && (r.label || "").trim() && (parseFloat(r.points) || 0) > 0);
}
