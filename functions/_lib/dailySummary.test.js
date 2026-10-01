import { describe, it, expect } from "vitest";
import { buildDailySummary, jobEventsOn, overdueEmailMessage, summaryAlreadySent, LINE_MAX } from "./dailySummary.js";
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
