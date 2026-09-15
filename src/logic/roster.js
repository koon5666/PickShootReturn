// Job crew roster (P1-10). A job carries `crew: [{ employeeId, role, callTime, pickupTime }]`.
// A job with NO roster is "open": legacy data and jobs the admin has not staffed yet
// keep behaving as before (every crew member sees it). Once a roster exists the job
// is "mine" for the people on it and "other" for everyone else. Pure functions,
// unit-tested in roster.test.js.

export const EMPTY_CREW_ROW = { employeeId: "", role: "", callTime: "", pickupTime: "" };

export function normalizeCrew(crew) {
  if (!Array.isArray(crew)) return [];
  const seen = new Set();
  const out = [];
  for (const r of crew) {
    if (!r || typeof r !== "object") continue;
    const employeeId = String(r.employeeId || "").trim();
    if (!employeeId || seen.has(employeeId)) continue;
    seen.add(employeeId);
    out.push({ employeeId, role: String(r.role || "").trim(), callTime: cleanTime(r.callTime), pickupTime: cleanTime(r.pickupTime) });
  }
  return out;
}

// "HH:MM" or "" (a bad value is dropped rather than stored).
export function cleanTime(v) {
  const s = String(v || "").trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? s : "";
}

export const hasRoster = (job) => normalizeCrew(job && job.crew).length > 0;
export const isOnRoster = (job, empId) => !!empId && normalizeCrew(job && job.crew).some(r => r.employeeId === empId);
export const myRosterEntry = (job, empId) => normalizeCrew(job && job.crew).find(r => r.employeeId === empId) || null;

// "mine" (on the roster) | "open" (no roster yet) | "other" (staffed, not me).
export function jobVisibility(job, empId) {
  if (!hasRoster(job)) return "open";
  return isOnRoster(job, empId) ? "mine" : "other";
}

// Split a job list for one crew member: `mine` = my jobs + open jobs (order kept),
// `others` = jobs staffed with someone else. `includeOpen=false` drops open jobs
// from `mine` into `others` (used where "show all" is the explicit choice).
export function splitJobsForEmployee(jobs, empId, { includeOpen = true } = {}) {
  const mine = [], others = [];
  for (const j of jobs || []) {
    const v = jobVisibility(j, empId);
    if (v === "mine" || (v === "open" && includeOpen)) mine.push(j); else others.push(j);
  }
  return { mine, others };
}

// Default lane roles for the Assign Gear modal from the roster: everyone on the
// roster may do both lanes; an unstaffed job stays "anyone".
export function defaultCheckoutRoles(job) {
  const ids = normalizeCrew(job && job.crew).map(r => r.employeeId);
  if (ids.length === 0) return { barcode: "anyone", photo: "anyone" };
  return { barcode: [...ids], photo: [...ids] };
}

// Names for a LINE message / card: "Nong (1st AC), Arthit (Gaffer)".
export function crewNames(job, employees) {
  const byId = new Map((employees || []).map(e => [e.id, e]));
  return normalizeCrew(job && job.crew).map(r => {
    const emp = byId.get(r.employeeId);
    const name = emp ? emp.name : r.employeeId;
    return r.role ? `${name} (${r.role})` : name;
  });
}

const sortedDates = (j) => [...((j && j.dates) || [])].sort();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// What actually changed between two versions of a job, for the notification
// gate: only dates / status / location / roster changes (and the pickup-return
// window) are worth a push. A contact-person tweak is not.
export function jobChangeSet(before, after) {
  if (!before) return ["new"];
  const changes = [];
  if ((before.status || "") !== (after.status || "")) changes.push("status");
  if (!same(sortedDates(before), sortedDates(after)) || (before.pickupDate || "") !== (after.pickupDate || "") || (before.returnDate || "") !== (after.returnDate || "")) changes.push("dates");
  if ((before.location || "") !== (after.location || "") || (before.locationCity || "") !== (after.locationCity || "") || !same(before.dateOverrides || {}, after.dateOverrides || {})) changes.push("location");
  if ((before.shootTime || "") !== (after.shootTime || "")) changes.push("time");
  if (!same(normalizeCrew(before.crew), normalizeCrew(after.crew))) changes.push("roster");
  return changes;
}

export const shouldNotify = (changes) => (changes || []).length > 0;

// Who a push goes to when there is no group: the assigned crew's LINE ids, or
// every employee with one when the job is open. Returns [] when nothing applies.
export function pushRecipients(job, employees, lineGroupId) {
  if (lineGroupId) return [lineGroupId];
  const withLine = (employees || []).filter(e => e && e.lineUserId);
  if (!hasRoster(job)) return withLine.map(e => e.lineUserId);
  const ids = new Set(normalizeCrew(job.crew).map(r => r.employeeId));
  return withLine.filter(e => ids.has(e.id)).map(e => e.lineUserId);
}

// Text of the job push. `changes` from jobChangeSet decides the headline.
export function buildJobMessage(job, { changes = ["new"], employees = [], formatDates, appUrl = "https://pickshootreturn.pages.dev" } = {}) {
  const isNew = changes.includes("new");
  const emoji = job.status === "Confirmed" ? "✅" : job.status === "Cancelled" ? "❌" : "✏️";
  const action = isNew ? "New Job" : changes.includes("status") ? `Status → ${job.status}` : changes.includes("roster") && changes.length === 1 ? "Crew updated" : "Updated";
  const dateStr = formatDates ? formatDates(job.dates || []) : sortedDates(job).join(", ");
  const locationStr = (job.location || "") + (job.locationCity ? ` · ${job.locationCity}` : "");
  const lines = [`${emoji} [${action}] ${job.name}`, `🎬 ${job.production || "-"}`, `📅 ${dateStr}`, `📍 ${locationStr}`];
  const names = crewNames(job, employees);
  if (names.length) lines.push(`👥 ${names.join(", ")}`);
  const times = normalizeCrew(job.crew).filter(r => r.callTime || r.pickupTime);
  if (times.length) {
    const byId = new Map((employees || []).map(e => [e.id, e]));
    for (const r of times) {
      const nm = byId.get(r.employeeId)?.name || r.employeeId;
      const parts = [];
      if (r.pickupTime) parts.push(`pickup ${r.pickupTime}`);
      if (r.callTime) parts.push(`call ${r.callTime}`);
      lines.push(`⏰ ${nm}: ${parts.join(", ")}`);
    }
  }
  lines.push(`🔗 ${appUrl}`);
  return lines.join("\n");
}
