import { describe, it, expect } from "vitest";
import { buildOverdueDigest, digestAlreadySent } from "./digest.js";
import { addDays } from "../../src/logic/availability.js";

const T = "2026-09-16";
const day = (n) => addDays(T, n);
const at = (n, hh = 9) => Date.parse(day(n) + `T${String(hh).padStart(2, "0")}:00:00+07:00`);
const equipment = [{ id: "eq_fx6", name: "Sony FX6", total: 2 }, { id: "eq_vmount", name: "V-Mount 150Wh", total: 8 }, { id: "eq_rs3", name: "DJI RS3 Pro", total: 1 }];
const jobs = [
  { id: "job1", name: "TVC Toyota", dates: [day(-2)], pickupDate: day(-3), status: "Confirmed", assignedEquipment: [] },
  { id: "job2", name: "Netflix", dates: [day(0)], status: "Confirmed", assignedEquipment: [] },
];
const pick = (jobId, eqId, qty, ts) => ({ id: "co" + ts + eqId, jobId, requestId: null, jobName: jobs.find(j => j.id === jobId).name, eqId, qty, employeeId: "e_nong", employeeName: "Nong", type: "pick", ts });
const employees = [{ id: "e_nong", name: "Nong", lineUserId: "U1" }];

describe("overdue digest (P1-11)", () => {
  it("lists overdue rows with qty, item, job, crew, due date and days late; due-today rows separately; names the holders", () => {
    const checkouts = [pick("job1", "eq_fx6", 1, at(-3, 8)), pick("job1", "eq_vmount", 4, at(-3, 8)), pick("job2", "eq_rs3", 1, at(0, 8))];
    const d = buildOverdueDigest({ jobs, equipment, checkouts, employees, today: T, tz: "Asia/Bangkok", companyName: "Lucky Cam Rental" });
    expect(d.count).toBe(3);
    expect(d.overdue.map(r => r.eqName).sort()).toEqual(["Sony FX6", "V-Mount 150Wh"]);
    expect(d.dueToday.map(r => r.eqName)).toEqual(["DJI RS3 Pro"]);
    expect(d.text).toContain("Overdue (2):");
    expect(d.text).toContain("• 4 × V-Mount 150Wh · TVC Toyota · Nong · due 14 Sept (2d late)");
    expect(d.text).toContain("Due today (1):");
    expect(d.text).toContain("• 1 × DJI RS3 Pro · Netflix · Nong · due 16 Sept");
    expect(d.text).toContain("Lucky Cam Rental");
    expect(d.employeeIds).toEqual(["e_nong"]);
  });
  it("nothing overdue -> no text, nobody to push", () => {
    const d = buildOverdueDigest({ jobs, equipment, checkouts: [pick("job2", "eq_rs3", 1, at(0, 8)), { ...pick("job2", "eq_rs3", 1, at(0, 9)), type: "return" }], employees, today: T });
    expect(d.text).toBeNull();
    expect(d.employeeIds).toEqual([]);
  });
  it("is sent once per day", () => {
    expect(digestAlreadySent({ day: T, at: 1 }, T)).toBe(true);
    expect(digestAlreadySent({ day: "2026-09-15", at: 1 }, T)).toBe(false);
    expect(digestAlreadySent(null, T)).toBe(false);
  });
});
