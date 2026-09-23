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
// Employees a job push addresses when no group is connected: the roster, or
// everyone when the job is open. The server resolves who is LINE-linked
// (P3-6: clients never see lineUserId, only `lineLinked`).
export function pushEmployeeIds(job, employees) {
  const all = (employees || []).filter(e => e && e.id != null);
  if (!hasRoster(job)) return all.map(e => e.id);
  const ids = new Set(normalizeCrew(job.crew).map(r => r.employeeId));
  return all.filter(e => ids.has(e.id)).map(e => e.id);
}

// Text of the job push. `changes` from jobChangeSet decides the headline.
// Header block per Koon 2026-09-23: headline, production, dates, contact + via,
// location. The crew roster and call times were dropped from this message; the
// recap below them is what the group actually reads. Pass `jobs` + `today` to
// append it (see jobSummaryLines); without them the message is the header alone.
export function buildJobMessage(job, { changes = ["new"], employees = [], formatDates, appUrl = "https://pickshootreturn.pages.dev", jobs = null, today = null } = {}) {
  const isNew = changes.includes("new");
  const emoji = job.status === "Confirmed" ? "✅" : job.status === "Cancelled" ? "❌" : "✏️";
  const action = isNew ? "New Job" : changes.includes("status") ? `Status → ${job.status}` : changes.includes("roster") && changes.length === 1 ? "Crew updated" : "Updated";
  const dateStr = formatDates ? formatDates(job.dates || []) : sortedDates(job).join(", ");
  const locationStr = (job.location || "") + (job.locationCity ? ` · ${job.locationCity}` : "");
  const lines = [`${emoji} [${action}] ${job.name}`, `🎬 ${job.production || "-"}`, `📅 ${dateStr}`];
  const contact = [job.contactPerson, job.contactPlatform ? `Via ${job.contactPlatform}` : ""].filter(v => String(v || "").trim()).join(" ");
  if (contact) lines.push(`👤 ${contact}`);
  lines.push(`📍 ${locationStr}`);
  if (jobs && today) {
    // Budget is measured against what the header and link already cost, so the
    // finished message can never cross LINE's limit however big the book gets.
    const overhead = lines.join("\n").length + `\n\nJob summary\n`.length + `\n\n🔗 ${appUrl}`.length;
    const recap = fitRecapBlocks(jobSummaryBlocks(jobs, { today, starId: job.id }), Math.max(400, RECAP_MAX_CHARS - overhead));
    if (recap.length) lines.push("", "Job summary", ...recap);
  }
  lines.push("", `🔗 ${appUrl}`);
  return lines.join("\n");
}

// ─── JOB SUMMARY (LINE recap, 2026-09-23) ────────────────────────────────────
// Every job push carries a recap of what is still on the calendar, so the group
// reads one message instead of scrolling back through the thread.
//
// Rules settled with Koon:
//   * only Pencil and Confirmed are listed. A Declined or Cancelled job simply
//     stops appearing, which is how the group sees it is gone.
//   * a job stays in full while ANY of its days is today or later; one whose
//     last day has passed drops out. Days are never trimmed inside a live job.
//   * months before the current one are not printed: a job straddling the month
//     boundary still shows its remaining days under the months ahead.
//   * exactly one job carries the "*" marker, the one that triggered this
//     message. Nothing is stored, so the marker is gone from the next message
//     without anything having to clear it.

const STATUS_MARK = { Confirmed: "✅", Pencil: "✏️" };

// Day numbers as the group writes them: a run of 3+ becomes "8-13", a pair stays
// "15,16" (matching how Koon's own summaries read).
export function compressDays(days) {
  const sorted = [...new Set((days || []).filter(n => Number.isFinite(n)))].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    if (j >= i + 2) { out.push(`${sorted[i]}-${sorted[j]}`); i = j + 1; }
    else { out.push(String(sorted[i])); i++; }
  }
  return out.join(",");
}

const monthName = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, 1)).toLocaleString("en-GB", { month: "long", timeZone: "UTC" });
};

// Overseas days of ONE line (a line covers one month of one job), and where they
// are. A per-date override wins over the job default for both the location and
// the country, so a job that is local in September and abroad in October flies
// the plane only on the October line, and a trip with two stops names both.
function overseasOn(job, dates) {
  const overrides = job.dateOverrides || {};
  let flies = false;
  const countries = [];
  for (const ds of dates || []) {
    const ov = overrides[ds] || {};
    if (!/overseas/i.test(ov.location || job.location || "")) continue;
    flies = true;
    const country = String(ov.locationCity || job.locationCity || "").trim();
    if (country && !countries.includes(country)) countries.push(country);
  }
  return { flies, countries };
}

// One line per (month, job): "27,28 Suneta House, Grab ✈️ Tokyo ✏️".
// Contact person and channel are deliberately NOT here (Koon 2026-09-24): the
// group only needs who is shooting what and when, the contact is admin detail
// and stays in the header block of the job that changed.
function summaryLine(job, days, starred, dates) {
  const who = [job.production || "TBA", job.name || "TBA"].filter(v => String(v || "").trim());
  const { flies, countries } = overseasOn(job, dates);
  // The plane still flies when no country was recorded; it just has nothing to name.
  const trip = flies ? ` ✈️${countries.length ? ` ${countries.join("/")}` : ""}` : "";
  return `${starred ? "*" : ""}${compressDays(days)} ${who.join(", ")}${trip} ${STATUS_MARK[job.status] || ""}`.trimEnd();
}

// The recap body as lines (no heading, no trailing link). `today` is a
// YYYY-MM-DD string in the app timezone so the cutoff never guesses the device.
export function jobSummaryBlocks(jobs, { today: todayStr, starId = null } = {}) {
  const cutoffMonth = String(todayStr || "").slice(0, 7);
  const months = new Map(); // "YYYY-MM" -> [{ job, days, first }]
  for (const job of jobs || []) {
    if (!job || !STATUS_MARK[job.status]) continue;
    const dates = [...(job.dates || [])].filter(Boolean).sort();
    if (!dates.length) continue;
    if (dates[dates.length - 1] < todayStr) continue; // every day has passed
    const byMonth = new Map();
    for (const d of dates) {
      const ym = d.slice(0, 7);
      if (ym < cutoffMonth) continue; // a month already behind us is not a recap
      if (!byMonth.has(ym)) byMonth.set(ym, []);
      byMonth.get(ym).push(d);
    }
    for (const [ym, monthDates] of byMonth) {
      const days = monthDates.map(d => parseInt(d.slice(8, 10), 10));
      if (!months.has(ym)) months.set(ym, []);
      months.get(ym).push({ job, days, dates: monthDates, first: Math.min(...days) });
    }
  }
  const blocks = [];
  for (const ym of [...months.keys()].sort()) {
    const rows = months.get(ym).sort((a, b) => a.first - b.first || String(a.job.name || "").localeCompare(String(b.job.name || "")));
    blocks.push({ month: monthName(ym), lines: rows.map(r => summaryLine(r.job, r.days, r.job.id === starId && starId != null, r.dates)) });
  }
  return blocks;
}

// Flat recap body, months separated by a blank line.
export function jobSummaryLines(jobs, opts = {}) {
  return flattenBlocks(jobSummaryBlocks(jobs, opts));
}

function flattenBlocks(blocks) {
  const lines = [];
  for (const b of blocks) {
    if (lines.length) lines.push("");
    lines.push(b.month, ...b.lines);
  }
  return lines;
}

// LINE rejects a push over 5000 characters and the whole message is lost, the
// job notification with it. Koon's real book is nowhere near that (a 9-job
// forward calendar is ~560 characters, the ceiling is around 150 forward jobs),
// so this is a safety net, not a working limit: it keeps the newest months and
// says how many jobs it had to leave out.
export const RECAP_MAX_CHARS = 4200;

// Drop whole trailing months until `blocks` fit in `budget` characters, then, if
// even one month is too big, drop lines off the end of it. Returns the lines to
// print plus a one-line note naming what was left out, or null when nothing was.
export function fitRecapBlocks(blocks, budget = RECAP_MAX_CHARS) {
  const size = (ls) => ls.reduce((n, l) => n + l.length + 1, 0);
  const kept = [...blocks];
  let droppedJobs = 0;
  const droppedMonths = [];
  const note = () => droppedJobs
    ? `+${droppedJobs} more in ${droppedMonths[0]}${droppedMonths.length > 1 ? ` to ${droppedMonths[droppedMonths.length - 1]}` : ""}`
    : null;
  const fits = () => {
    const n = note();
    return size(flattenBlocks(kept)) + (n ? n.length + 2 : 0) <= budget;
  };
  while (kept.length > 1 && !fits()) {
    const gone = kept.pop();
    droppedJobs += gone.lines.length;
    droppedMonths.unshift(gone.month);
  }
  // One month on its own is still too long: shed its last rows.
  while (kept.length === 1 && kept[0].lines.length > 1 && !fits()) {
    kept[0].lines.pop();
    droppedJobs += 1;
    if (droppedMonths[0] !== kept[0].month) droppedMonths.unshift(kept[0].month);
  }
  const lines = flattenBlocks(kept);
  const n = note();
  if (n) lines.push("", n);
  return lines;
}
