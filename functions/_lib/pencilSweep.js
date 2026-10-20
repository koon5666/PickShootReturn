// Once-a-day pencil sweep (2026-10-20), see src/logic/pencilExpiry.js for the rule.
// Called by POST /api/daily-summary (the 08:00 cron) and by GET /api/data (the
// first app open of the day, so it still runs when the cron worker is down).
// KV `sweep:pencil` = { day } makes every later call that day a single KV read.
//
// The write goes through writeField, so `jobs` gets a NEW version: a tab that
// loaded the old jobs gets a 409 on its next save, re-reads and re-applies its
// own edits (App.jsx 409 rebase). No email and no LINE: this is housekeeping,
// the crew already know a pencil that never confirmed did not happen.
import { readField, writeField } from "./store.js";
import { auditEntry, AUDIT_MAX } from "./audit.js";
import { todayIn } from "./digest.js";
import { calendarTimezone } from "./tz.js";
import { expirePencils } from "../../src/logic/pencilExpiry.js";

export const SWEEP_KEY = "sweep:pencil";

export async function houseToday(kv, now = Date.now()) {
  const { value: tz } = await readField(kv, "timezone");
  return todayIn(calendarTimezone(tz), now);
}

// force: run even if today's sweep already ran (tests / admin).
// Returns { ran, today, declined: [{ id, name }] }.
export async function sweepExpiredPencils(kv, { now = Date.now(), force = false } = {}) {
  const today = await houseToday(kv, now);
  if (!force) {
    const last = await kv.get(SWEEP_KEY, "json").catch(() => null);
    if (last && last.day === today) return { ran: false, today, declined: [] };
  }
  // Read jobs + checkouts as late as possible, right before the write.
  const [{ value: jobs }, { value: checkouts }] = await Promise.all([readField(kv, "jobs"), readField(kv, "checkouts")]);
  const { jobs: next, declined } = expirePencils(Array.isArray(jobs) ? jobs : [], { today, checkouts: Array.isArray(checkouts) ? checkouts : [], now });
  if (declined.length) {
    await writeField(kv, "jobs", next);
    try {
      const { value: log } = await readField(kv, "auditLog");
      const entries = declined.map((j, i) => auditEntry(null, { action: "job.autoDecline", recordId: j.id, name: j.name, detail: "Pencil passed its last shoot day" }, now + i));
      await writeField(kv, "auditLog", [...(Array.isArray(log) ? log : []), ...entries].slice(-AUDIT_MAX));
    } catch { /* the audit line never fails the sweep */ }
  }
  await kv.put(SWEEP_KEY, JSON.stringify({ day: today, at: now, declined: declined.length }));
  return { ran: true, today, declined: declined.map(j => ({ id: j.id, name: j.name })) };
}
