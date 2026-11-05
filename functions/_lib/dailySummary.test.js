import { describe, it, expect } from "vitest";
import { buildDailySummary, buildManualPush, pushBudget, bookingStats, jobEventsOn, overdueEmailMessage, summaryAlreadySent, LINE_MAX } from "./dailySummary.js";
import { addDays } from "../../src/logic/availability.js";

const T = "2026-10-01";
const day = (n) => addDays(T, n);
const at = (n, hh = 9) => Date.parse(day(n) + `T${String(hh).padStart(2, "0")}:00:00+07:00`);
const employees = [{ id: "e_nong", name: "Nong" }, { id: "e_art", name: "Arthit" }];
const equipment = [{ id: "eq_fx6", name: "Sony FX6", total: 2 }];
const base = { equipment, employees, checkouts: [], equipmentRequests: [], today: T, tz: "Asia/Bangkok", companyName: "Lucky Cam" };

describe("daily LINE summary (2026-10-01)", () => {
  it("is skipped when nothing happens today or tomorrow and nothing is overdue", () => {
    const jobs = [{ id: "j1", name: "Later", production: "P", status: "Confirmed", dates: [day(5)] }];
    const s = buildDailySummary({ ...base, jobs });
    expect(s.text).toBeNull();
    expect(s.skipped).toMatch(/nothing/);
  });
  it("Declined / Cancelled jobs never count as something on", () => {
    const jobs = [{ id: "j1", name: "Gone", status: "Cancelled", dates: [T] }, { id: "j2", name: "No", status: "Declined", dates: [day(1)] }];
    expect(buildDailySummary({ ...base, jobs }).text).toBeNull();
  });
  it("lists today and tomorrow with location, time and crew, then the job calendar", () => {
    const jobs = [
      { id: "j1", name: "TVC Toyota", production: "Phenomena", status: "Confirmed", dates: [T, day(1)], location: "Local (Bangkok)", shootTime: "Night", dateOverrides: { [day(1)]: { location: "Out of Town", locationCity: "Hua Hin" } }, crew: [{ employeeId: "e_nong", role: "1st AC", callTime: "05:30" }] },
      { id: "j2", name: "MV", production: "GMM", status: "Pencil", dates: [day(3)], pickupDate: day(1) },
    ];
    const s = buildDailySummary({ ...base, jobs });
    expect(s.text).toContain("TODAY / วันนี้");
    expect(s.text).toContain("• Phenomena, TVC Toyota ✅");
    expect(s.text).toContain("shoot day · 📍 Local (Bangkok) · Night");
    expect(s.text).toContain("👥 Nong (1st AC, call 05:30)");
    expect(s.text).toContain("📍 Out of Town · Hua Hin"); // tomorrow's per-day override
    expect(s.text).toContain("• GMM, MV ✏️");
    expect(s.text).toContain("gear pickup");
    expect(s.text).toContain("Job summary");
    expect(s.text).toContain("October");
    expect(s.text.endsWith("🔗 https://pickshootreturn.pages.dev")).toBe(true);
    expect(s.counts).toEqual({ today: 1, tomorrow: 2, overdue: 0, dueToday: 0 });
  });
  it("overdue gear alone is enough to post, and is grouped per holder for the emails", () => {
    const jobs = [{ id: "j1", name: "Old", production: "P", status: "Confirmed", dates: [day(-3)] }];
    const checkouts = [{ id: "c1", jobId: "j1", jobName: "Old", eqId: "eq_fx6", qty: 1, employeeId: "e_nong", employeeName: "Nong", type: "pick", ts: at(-4) }];
    const s = buildDailySummary({ ...base, jobs, checkouts });
    expect(s.text).toContain("⚠ OVERDUE GEAR");
    expect(s.text).toContain("1 × Sony FX6 · Old · Nong");
    expect(Object.keys(s.overdueByEmployee)).toEqual(["e_nong"]);
    const m = overdueEmailMessage(s.overdueByEmployee.e_nong, { name: "Nong", today: T, appUrl: "https://pickshootreturn.pages.dev" });
    expect(m.subject).toBe("Overdue gear: please return 1 item");
    expect(m.sections[0].items[0]).toContain("Sony FX6");
    expect(m.tone).toBe("bad");
  });
  it("never crosses LINE's limit however big the book is", () => {
    const jobs = Array.from({ length: 400 }, (_, i) => ({ id: "j" + i, name: "Job number " + i + " with a long name", production: "Production house " + i, status: "Confirmed", dates: [T, day(1 + (i % 60))] }));
    const s = buildDailySummary({ ...base, jobs });
    expect(s.text.length).toBeLessThanOrEqual(LINE_MAX);
  });
  it("job events: pickup / shoot / return days", () => {
    const j = { status: "Confirmed", dates: [day(2), day(3)], pickupDate: day(1), returnDate: day(4) };
    expect(jobEventsOn(j, day(1))).toEqual(["gear pickup"]);
    expect(jobEventsOn(j, day(2))).toEqual(["shoot day"]);
    expect(jobEventsOn(j, day(4))).toEqual(["gear return"]);
    expect(jobEventsOn(j, day(5))).toEqual([]);
  });
  it("one post per day", () => {
    expect(summaryAlreadySent({ day: T }, T)).toBe(true);
    expect(summaryAlreadySent({ day: day(-1) }, T)).toBe(false);
    expect(summaryAlreadySent(null, T)).toBe(false);
  });
});

describe("manual push from the Dashboard (2026-11-05)", () => {
  const later = { id: "j1", name: "Later", production: "P", status: "Confirmed", dates: [day(5), day(6)] };
  const push = (jobs) => buildManualPush({ jobs, today: T, companyName: "Lucky Cam" });
  it("still posts the calendar on a quiet day the 08:00 post skips", () => {
    expect(buildDailySummary({ ...base, jobs: [later] }).text).toBeNull();
    const text = push([later]).text;
    expect(text).toContain("📣 Schedule update");
    expect(text).toContain("Job summary");
    expect(text.endsWith("🔗 https://pickshootreturn.pages.dev")).toBe(true);
  });
  it("carries stats and the calendar only: no today, tomorrow or overdue names", () => {
    const today = { id: "j2", name: "Now", production: "P", status: "Confirmed", dates: [T], crew: [{ employeeId: "e_nong", role: "1st AC" }] };
    const text = push([today, later]).text;
    expect(text).not.toContain("TODAY / วันนี้");
    expect(text).not.toContain("TOMORROW");
    expect(text).not.toContain("OVERDUE");
    expect(text).not.toContain("e_nong");
  });
  it("has nothing to push when no job is upcoming", () => {
    expect(push([])).toEqual({ text: null, skipped: "no upcoming jobs" });
    expect(push([{ id: "j", name: "Shot", status: "Confirmed", dates: [day(-1)] }]).text).toBeNull();
  });
  it("heads the post with upcoming stats, past days and dead jobs left out", () => {
    const jobs = [
      later,
      { id: "j2", name: "Half gone", status: "Confirmed", dates: [day(-2), T, day(1)] },
      { id: "j3", name: "Shot", status: "Confirmed", dates: [day(-5)] },
      { id: "j4", name: "Hold", status: "Pencil", dates: [day(3)] },
      { id: "j5", name: "No", status: "Declined", dates: [day(4)] },
    ];
    expect(bookingStats(jobs, T)).toEqual({ Confirmed: { jobs: 2, days: 4 }, Pencil: { jobs: 1, days: 1 } });
    const text = push(jobs).text;
    expect(text).toContain("✅ Confirmed / งานยืนยัน: 2 jobs · 4 shoot days");
    expect(text).toContain("✏️ Pencil / งานดินสอ: 1 job · 1 shoot day");
    expect(text.indexOf("UPCOMING BOOKINGS")).toBeLessThan(text.indexOf("Job summary"));
  });
  it("leaves the 08:00 post exactly as it was", () => {
    const text = buildDailySummary({ ...base, jobs: [{ id: "j1", name: "On", production: "P", status: "Confirmed", dates: [T] }] }).text;
    expect(text.startsWith("☀️ Daily summary")).toBe(true);
    expect(text).not.toContain("UPCOMING BOOKINGS");
  });
  it("never crosses LINE's limit however big the book is", () => {
    const jobs = Array.from({ length: 400 }, (_, i) => ({ id: "j" + i, name: "Job number " + i, production: "Production house " + i, status: "Confirmed", dates: [day(i % 60)] }));
    expect(push(jobs).text.length).toBeLessThanOrEqual(LINE_MAX);
  });
});

describe("pushBudget: a push against the 08:00 posts still to come", () => {
  const nov5 = { today: "2026-11-05", dailySentToday: true }; // 25 posts to come
  it("warns about nothing when the month has room", () => {
    expect(pushBudget({ members: 6, left: 180, ...nov5 })).toEqual({ members: 6, left: 180, blocked: false, daysLost: 0 });
    expect(pushBudget({ members: 6, left: 156, ...nov5 }).daysLost).toBe(0); // 150 after the push = exactly 25 posts
  });
  it("counts the 08:00 posts a push would crowd out", () => {
    expect(pushBudget({ members: 6, left: 155, ...nov5 }).daysLost).toBe(1);
    expect(pushBudget({ members: 6, left: 30, ...nov5 }).daysLost).toBe(21);
  });
  it("counts today's post until it has run", () => {
    expect(pushBudget({ members: 6, left: 156, today: "2026-11-05", dailySentToday: false }).daysLost).toBe(1);
  });
  it("the last evening of the month has no post left to protect", () => {
    expect(pushBudget({ members: 6, left: 6, today: "2026-11-30", dailySentToday: true })).toMatchObject({ blocked: false, daysLost: 0 });
  });
  it("has nothing to protect with the 08:00 post switched off", () => {
    expect(pushBudget({ members: 6, left: 12, ...nov5, dailyEnabled: false }).daysLost).toBe(0);
  });
  it("blocks only when LINE would refuse", () => {
    expect(pushBudget({ members: 6, left: 5, ...nov5 }).blocked).toBe(true);
    expect(pushBudget({ members: 6, left: 6, ...nov5 }).blocked).toBe(false);
  });
  it("stays quiet when LINE gave no numbers or the plan is unlimited", () => {
    expect(pushBudget({ members: null, left: null, ...nov5 })).toMatchObject({ blocked: false, daysLost: 0 });
    expect(pushBudget({ members: 6, left: null, ...nov5 })).toMatchObject({ blocked: false, daysLost: 0 });
    expect(pushBudget({ members: 0, left: 10, ...nov5 })).toMatchObject({ blocked: false, daysLost: 0 });
  });
});
