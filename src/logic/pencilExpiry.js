// Pencil expiry (2026-10-20). A Pencil job is a soft hold on dates; once its
// last shoot day is behind us it can no longer be confirmed, so it becomes
// Declined by itself. ONE rule, used by:
//   * functions/_lib/pencilSweep.js  the once-a-day server sweep that stores the
//                                    status change (08:00 cron, or the first app
//                                    open of the day when the cron did not run)
//   * functions/api/calendar.js      the iCal feed drops expired pencils at once,
//                                    even before the sweep has written them
// Pure functions, no KV, no React: unit-tested in pencilExpiry.test.js.
//
// A pencil expires the morning AFTER its last shoot day (today > last date, in
// the house timezone). A pencil with gear still out is left alone: it stays in
// "Gear Out, tap to return" and in the overdue summary until the gear is back.
import { jobLastDate, stillOutUnits } from "./availability.js";

export const AUTO_DECLINE_REASON = "pencil-expired";

// Job ids that still hold gear (picked, not returned, not lost).
export function jobsWithGearOut(checkouts) {
  const ids = new Set();
  for (const u of stillOutUnits(checkouts || [])) if (u.jobId) ids.add(u.jobId);
  return ids;
}

// gearOut: a Set of job ids from jobsWithGearOut (optional; absent = no gear out).
export function isExpiredPencil(job, today, gearOut) {
  if (!job || job._deleted || job.status !== "Pencil" || !today) return false;
  const last = jobLastDate(job);
  if (!last || !(last < today)) return false;
  return !(gearOut && gearOut.has(job.id));
}

// Returns { jobs, declined } where `jobs` is a NEW array only when something
// changed (same array otherwise, so callers can skip the write) and `declined`
// lists the jobs that flipped.
export function expirePencils(jobs, { today, checkouts, now = Date.now() } = {}) {
  if (!Array.isArray(jobs) || !today) return { jobs, declined: [] };
  const gearOut = jobsWithGearOut(checkouts);
  const declined = [];
  const next = jobs.map(j => {
    if (!isExpiredPencil(j, today, gearOut)) return j;
    const flipped = { ...j, status: "Declined", autoDeclined: { at: now, from: "Pencil", reason: AUTO_DECLINE_REASON } };
    declined.push(flipped);
    return flipped;
  });
  return { jobs: declined.length ? next : jobs, declined };
}

// The tag in the Declined tab: only while the job is still Declined.
export const isAutoDeclined = (job) => !!(job && job.status === "Declined" && job.autoDeclined);
