import { describe, it, expect } from "vitest";
import {
  availability, availabilitySpan, stillOutUnits, stillOutList, jobConflicts, jobHoldDates, jobHoldsOn,
  effPickupDate, effReturnDate, addDays, daysBetween, unitsOutForEquipment, unitsOutForJob, buildReceiveEvents,
} from "./availability.js";

// Mirrors tests/seed.mjs (default profile) with a fixed "today" so the numbers are stable.
const T = "2026-09-16";
const day = (n) => addDays(T, n);
const at = (n, hh = 9) => Date.parse(day(n) + `T${String(hh).padStart(2, "0")}:00:00+07:00`);

const equipment = [
  { id: "eq_fx6", name: "Sony FX6", category: "Camera", total: 2 },
  { id: "eq_lens", name: "Sony 24-70 GM II", category: "Lens", total: 1 },
  { id: "eq_vmount", name: "V-Mount 150Wh", category: "Power", total: 8 },
  { id: "eq_rs3", name: "DJI RS3 Pro", category: "Grip", total: 1 },
  { id: "eq_aputure", name: "Aputure 600d Pro", category: "Lighting", total: 3 },
  { id: "eq_tripod", name: "Sachtler Flowtech 75", category: "Grip", total: 4 },
];
const job1 = { id: "job1", name: "TVC Toyota", dates: [day(-2)], pickupDate: day(-3), status: "Confirmed", checkoutMode: "span",
  assignedEquipment: [{ eqId: "eq_fx6", qty: 1 }, { eqId: "eq_lens", qty: 1 }, { eqId: "eq_vmount", qty: 4 }] };
const job2 = { id: "job2", name: "Netflix Series Ep.3", dates: [day(0), day(1)], status: "Confirmed", checkoutMode: "span",
  assignedEquipment: [{ eqId: "eq_fx6", qty: 1 }, { eqId: "eq_rs3", qty: 1 }, { eqId: "eq_aputure", qty: 2 }, { eqId: "eq_tripod", qty: 2 }] };
const job3 = { id: "job3", name: "Music Video Ploy Band", dates: [day(7), day(8)], status: "Pencil", checkoutMode: "span", assignedEquipment: [] };
const pick = (eqId, qty, ts, extra = {}) => ({ id: "co" + ts + eqId, jobId: "job1", requestId: null, jobName: job1.name, eqId, qty, employeeId: "e_nong", employeeName: "Nong", type: "pick", ts, ...extra });
const checkouts = [
  pick("eq_fx6", 1, at(-3, 8)), pick("eq_lens", 1, at(-3, 8) + 1000), pick("eq_vmount", 4, at(-3, 8) + 2000),
  { ...pick("eq_lens", 1, at(-2, 20)), type: "return" },
];
const reports = [{ id: "rep_seed1", eqId: "eq_rs3", status: "open", description: "Tilt motor grinding", ts: at(-1, 18), reportedBy: "Nong" }];
const equipmentRequests = [{ id: "req_seed1", employeeId: "e_arthit", employeeName: "Arthit", items: [{ eqId: "eq_aputure", qty: 1 }], useDates: [day(3)], purpose: "practice", status: "pending" }];
const ctx = { jobs: [job1, job2, job3], checkouts, reports, equipmentRequests, today: T };
const byId = (list, id) => list.find(e => e.id === id);

describe("date helpers", () => {
  it("addDays / daysBetween are timezone-proof", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-09-14", "2026-09-16")).toBe(2);
  });
  it("effective window falls back to the shoot days", () => {
    expect(effPickupDate(job1)).toBe(day(-3));
    expect(effReturnDate(job1)).toBe(day(-2));
    expect(effPickupDate(job2)).toBe(day(0));
    expect(effReturnDate({ ...job2, returnDate: day(3) })).toBe(day(3));
  });
  it("span jobs hold gear across the whole window, daily jobs on shoot days only", () => {
    const j = { dates: [day(0), day(3)], pickupDate: day(-1), status: "Confirmed" };
    expect(jobHoldDates(j)).toEqual([day(-1), day(0), day(1), day(2), day(3)]);
    expect(jobHoldsOn(j, day(2))).toBe(true);
    expect(jobHoldDates({ ...j, checkoutMode: "daily" })).toEqual([day(0), day(3)]);
    expect(jobHoldsOn({ ...j, checkoutMode: "daily" }, day(2))).toBe(false);
    expect(jobHoldDates(j, { pickupBuffer: 1, returnBuffer: 1 })[0]).toBe(day(-2));
  });
});

describe("stillOutUnits (count-based, per lane)", () => {
  it("nets picks against returns per job + eqId", () => {
    const out = stillOutUnits(checkouts);
    expect(out.map(u => [u.eqId, u.qty]).sort()).toEqual([["eq_fx6", 1], ["eq_vmount", 4]]);
    expect(out.find(u => u.eqId === "eq_fx6").pickedBy).toBe("Nong");
  });
  it("does not double count 'both' mode (photo + barcode lanes)", () => {
    const both = [
      { jobId: "jA", eqId: "x", qty: 2, type: "pick", ts: 1 },
      { jobId: "jA", eqId: "x", qty: 2, type: "barcode_pick", ts: 2 },
    ];
    expect(stillOutUnits(both)[0].qty).toBe(2);
    const returnedPhotoOnly = [...both, { jobId: "jA", eqId: "x", qty: 2, type: "return", ts: 3 }];
    expect(stillOutUnits(returnedPhotoOnly)[0].qty).toBe(2); // barcode lane still open
    expect(stillOutUnits(returnedPhotoOnly)[0].lanes).toEqual({ photo: 0, barcode: 2 });
    const returnedBoth = [...returnedPhotoOnly, { jobId: "jA", eqId: "x", qty: 2, type: "barcode_return", ts: 4 }];
    expect(stillOutUnits(returnedBoth)).toEqual([]);
  });
  it("handles daily mode (pick/return every day) and request holders", () => {
    const daily = [
      { jobId: "jD", eqId: "x", qty: 1, type: "pick", ts: 1 }, { jobId: "jD", eqId: "x", qty: 1, type: "return", ts: 2 },
      { jobId: "jD", eqId: "x", qty: 1, type: "pick", ts: 3 },
      { requestId: "r1", eqId: "y", qty: 3, type: "pick", ts: 4 },
    ];
    const out = stillOutUnits(daily);
    expect(out.find(u => u.holder === "jD").qty).toBe(1);
    expect(out.find(u => u.holder === "req:r1")).toMatchObject({ requestId: "r1", qty: 3 });
  });
  it("never goes negative on a stray return", () => {
    expect(stillOutUnits([{ jobId: "j", eqId: "x", qty: 1, type: "return", ts: 1 }])).toEqual([]);
  });
  it("ignores legacy events with no qty as qty 1", () => {
    expect(stillOutUnits([{ jobId: "j", eqId: "x", type: "checkout", ts: 1 }])[0].qty).toBe(1);
  });
});

describe("availability: the seeded scenario", () => {
  it("FX6 reads 0 of 2 free today: 1 overdue on job1, 1 booked by job2", () => {
    const fx6 = byId(availability(equipment, T, ctx), "eq_fx6");
    expect(fx6.available).toBe(0);
    expect(fx6.hard).toEqual({ jobs: 1, out: 1, loans: 0, damage: 0 });
    const kinds = fx6.reasons.map(r => r.kind).sort();
    expect(kinds).toEqual(["job", "out"]);
    const outReason = fx6.reasons.find(r => r.kind === "out");
    expect(outReason).toMatchObject({ jobId: "job1", label: "TVC Toyota", qty: 1, employeeName: "Nong", overdue: true });
  });
  it("V-Mount reads 4 of 8 free (4 still out on job1)", () => {
    const vm = byId(availability(equipment, T, ctx), "eq_vmount");
    expect(vm.available).toBe(4);
    expect(vm.hard.out).toBe(4);
  });
  it("the returned lens is free again", () => {
    expect(byId(availability(equipment, T, ctx), "eq_lens").available).toBe(1);
  });
  it("an open damage report takes the unit out of service, and an assignment on top is a NEGATIVE conflict", () => {
    const rs3 = byId(availability(equipment, T, ctx), "eq_rs3");
    expect(rs3.hard.damage).toBe(1);
    expect(rs3.hard.jobs).toBe(1);
    expect(rs3.available).toBe(-1); // not clamped
    expect(byId(availability(equipment, T, { ...ctx, reports: [] }), "eq_rs3").available).toBe(0);
  });
  it("still-out units keep reducing availability on future dates, and not on past dates", () => {
    expect(byId(availability(equipment, day(30), ctx), "eq_fx6").available).toBe(1);
    // day(-1): job1 window (day -3..-2) is over, job2 not started, still-out not applied in the past
    expect(byId(availability(equipment, day(-1), ctx), "eq_fx6").available).toBe(2);
    // day(-2): job1 holds its assignment
    expect(byId(availability(equipment, day(-2), ctx), "eq_fx6").hard.jobs).toBe(1);
  });
  it("counts a job's assignment across its pickup/return window, not only the shoot days", () => {
    const j = { ...job2, id: "jw", dates: [day(5)], pickupDate: day(3), returnDate: day(7), assignedEquipment: [{ eqId: "eq_tripod", qty: 4 }] };
    const c = { ...ctx, jobs: [j] };
    expect(byId(availability(equipment, day(3), c), "eq_tripod").available).toBe(0);
    expect(byId(availability(equipment, day(7), c), "eq_tripod").available).toBe(0);
    expect(byId(availability(equipment, day(8), c), "eq_tripod").available).toBe(4);
    // the old behaviour (shoot days only) would have said 4 free on the pickup day
  });
  it("excludeJobId drops the job's own assignment AND its own still-out units", () => {
    const fx6 = byId(availability(equipment, T, ctx, { excludeJobId: "job1" }), "eq_fx6");
    expect(fx6.available).toBe(1);
    expect(fx6.reasons.map(r => r.kind)).toEqual(["job"]);
  });
  it("does not double count a job whose gear is both assigned in-window and picked", () => {
    const c = { ...ctx, jobs: [{ ...job1, dates: [day(0)], pickupDate: "" }] };
    const fx6 = byId(availability(equipment, T, c), "eq_fx6");
    expect(fx6.hard).toEqual({ jobs: 1, out: 0, loans: 0, damage: 0 });
  });
  it("a picked unit on a job whose assignment was later removed still counts", () => {
    const c = { ...ctx, jobs: [{ ...job1, dates: [day(0)], assignedEquipment: [] }] };
    expect(byId(availability(equipment, T, c), "eq_fx6").hard.out).toBe(1);
  });
});

describe("availability: loans, pencil, gone jobs, cancelled jobs", () => {
  it("an approved gear request holds units on its use dates only", () => {
    const c = { ...ctx, equipmentRequests: [{ ...equipmentRequests[0], status: "approved" }] };
    expect(byId(availability(equipment, day(3), c), "eq_aputure").available).toBe(2);
    expect(byId(availability(equipment, day(3), c), "eq_aputure").reasons[0]).toMatchObject({ kind: "loan", employeeName: "Arthit", qty: 1 });
    expect(byId(availability(equipment, day(4), c), "eq_aputure").available).toBe(3);
    // pending requests hold nothing
    expect(byId(availability(equipment, day(3), ctx), "eq_aputure").available).toBe(3);
  });
  it("legacy single-item requests (eqId/qty, no items[]) still count", () => {
    const c = { ...ctx, equipmentRequests: [{ id: "rl", status: "approved", eqId: "eq_tripod", qty: 2, useDates: [T] }] };
    expect(byId(availability(equipment, T, c), "eq_tripod").available).toBe(0); // 2 job2 + 2 loan
  });
  it("gear picked on a request and not returned counts after the loan dates", () => {
    const c = { ...ctx, equipmentRequests: [{ ...equipmentRequests[0], status: "approved", useDates: [day(-5)] }],
      checkouts: [...checkouts, { id: "x", requestId: "req_seed1", jobId: null, eqId: "eq_aputure", qty: 1, type: "pick", ts: at(-5), employeeName: "Arthit" }] };
    const ap = byId(availability(equipment, T, c), "eq_aputure");
    expect(ap.hard.out).toBe(1);
    expect(ap.reasons.find(r => r.kind === "out")).toMatchObject({ requestId: "req_seed1", employeeName: "Arthit" });
  });
  it("Pencil jobs are soft holds: reported, never subtracted", () => {
    const c = { ...ctx, jobs: [job1, job2, { ...job3, assignedEquipment: [{ eqId: "eq_tripod", qty: 3 }] }] };
    const tp = byId(availability(equipment, day(7), c), "eq_tripod");
    expect(tp.available).toBe(4);
    expect(tp.pencil).toBe(3);
    expect(tp.reasons[0]).toMatchObject({ kind: "pencil", label: "Music Video Ploy Band" });
  });
  it("a deleted job's still-out units are computed from the log alone", () => {
    const c = { ...ctx, jobs: [job2, job3] };
    const fx6 = byId(availability(equipment, T, c), "eq_fx6");
    expect(fx6.available).toBe(0);
    expect(fx6.reasons.find(r => r.kind === "out")).toMatchObject({ gone: true, label: "TVC Toyota", jobId: "job1" });
  });
  it("a Cancelled job holds no assignment but its unreturned gear still counts", () => {
    const c = { ...ctx, jobs: [{ ...job1, status: "Cancelled", dates: [day(0)] }, job2, job3] };
    const fx6 = byId(availability(equipment, T, c), "eq_fx6");
    expect(fx6.hard).toEqual({ jobs: 1, out: 1, loans: 0, damage: 0 });
  });
  it("damage report qty > 1 takes that many units out of service", () => {
    const c = { ...ctx, reports: [{ id: "r", eqId: "eq_vmount", status: "open", qty: 3 }] };
    expect(byId(availability(equipment, T, c), "eq_vmount").available).toBe(1); // 8 - 4 out - 3 damaged
    // solved reports release the units
    expect(byId(availability(equipment, T, { ...ctx, reports: [{ id: "r", eqId: "eq_vmount", status: "solved", qty: 3 }] }), "eq_vmount").available).toBe(4);
  });
});

describe("availabilitySpan", () => {
  it("takes the worst day and reports it", () => {
    const span = availabilitySpan(equipment, [day(-1), day(0), day(1)], ctx);
    const fx6 = byId(span, "eq_fx6");
    expect(fx6.available).toBe(0);
    expect(fx6.worstDate).toBe(day(0));
  });
  it("defaults to today with no dates", () => {
    expect(byId(availabilitySpan(equipment, [], ctx), "eq_fx6").available).toBe(0);
  });
});

describe("jobConflicts (P1-9)", () => {
  it("moving job1 onto job2's days over-commits the FX6 and names the collider", () => {
    const moved = { ...job1, dates: [day(1)], pickupDate: "" };
    const job2Both = { ...job2, assignedEquipment: [{ eqId: "eq_fx6", qty: 2 }] };
    const conflicts = jobConflicts(moved, equipment, { ...ctx, jobs: [job1, job2Both, job3] });
    const fx6 = conflicts.find(c => c.eqId === "eq_fx6");
    expect(fx6).toBeTruthy();
    expect(fx6.soft).toBe(false);
    expect(fx6.shortBy).toBe(1);
    expect(fx6.reasons.map(r => r.label)).toContain("Netflix Series Ep.3");
    // the job's own still-out FX6 is not counted against itself
    expect(fx6.reasons.some(r => r.kind === "out")).toBe(false);
    // the lens and the batteries fit
    expect(conflicts.find(c => c.eqId === "eq_lens")).toBeUndefined();
    expect(conflicts.find(c => c.eqId === "eq_vmount")).toBeUndefined();
  });
  it("a Pencil job on the same days is only a soft conflict", () => {
    const c = { ...ctx, jobs: [job1, { ...job2, status: "Pencil", assignedEquipment: [{ eqId: "eq_fx6", qty: 2 }] }, job3] };
    const moved = { ...job1, dates: [day(1)], pickupDate: "" };
    const fx6 = jobConflicts(moved, equipment, c).find(x => x.eqId === "eq_fx6");
    expect(fx6.soft).toBe(true);
    expect(fx6.reasons[0].kind).toBe("pencil");
  });
  it("no gear or no dates means no conflicts", () => {
    expect(jobConflicts({ ...job1, assignedEquipment: [] }, equipment, ctx)).toEqual([]);
    expect(jobConflicts({ ...job1, dates: [] }, equipment, ctx)).toEqual([]);
  });
});

describe("stillOutList (P1-11 / P1-12)", () => {
  it("rows carry qty, due date, overdue days, crew and job, sorted overdue first", () => {
    const rows = stillOutList({ checkouts, jobs: ctx.jobs, equipment, today: T, tz: "Asia/Bangkok" });
    expect(rows.map(r => r.eqId)).toEqual(["eq_vmount", "eq_fx6"]); // both overdue 2d, latest pick first
    const fx6 = rows.find(r => r.eqId === "eq_fx6");
    expect(fx6).toMatchObject({ qty: 1, jobName: "TVC Toyota", pickedBy: "Nong", pickedById: "e_nong", dueDate: day(-2), overdue: true, daysOverdue: 2, dueToday: false, jobGone: false });
    expect(fx6.daysOut).toBe(3);
    expect(rows.find(r => r.eqId === "eq_vmount").qty).toBe(4);
  });
  it("flags due today", () => {
    const rows = stillOutList({ checkouts, jobs: [{ ...job1, returnDate: T }], equipment, today: T });
    expect(rows[0]).toMatchObject({ dueToday: true, overdue: false, daysOverdue: 0 });
  });
  it("keeps listing gear whose job was deleted, named from the log", () => {
    const rows = stillOutList({ checkouts, jobs: [], equipment, today: T });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ jobGone: true, jobName: "TVC Toyota", dueDate: null, overdue: false });
  });
  it("lists request loans by the request label", () => {
    const rows = stillOutList({ checkouts: [{ requestId: "req_seed1", eqId: "eq_aputure", qty: 1, type: "pick", ts: at(-1), employeeName: "Arthit" }],
      equipment, equipmentRequests: [{ ...equipmentRequests[0], useDates: [day(-1)] }], today: T });
    expect(rows[0]).toMatchObject({ jobName: "Personal / Practice", dueDate: day(-1), overdue: true, daysOverdue: 1 });
  });
});

describe("delete guards", () => {
  it("count units out per equipment and per job", () => {
    expect(unitsOutForEquipment(checkouts, "eq_vmount")).toBe(4);
    expect(unitsOutForEquipment(checkouts, "eq_lens")).toBe(0);
    expect(unitsOutForJob(checkouts, "job1")).toBe(5);
    expect(unitsOutForJob(checkouts, "job2")).toBe(0);
  });
});

describe("buildReceiveEvents (dashboard Receive)", () => {
  it("writes one photo-lane return by default and clears the unit", () => {
    const ev = buildReceiveEvents({ jobId: "job1", jobName: "TVC Toyota", eqId: "eq_vmount", qty: 4, now: 5, receivedFor: "Nong" });
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ type: "return", qty: 4, jobId: "job1", employeeId: "admin", adminApproved: true, receivedFor: "Nong", photo: null });
    expect(stillOutUnits([...checkouts, ...ev]).find(u => u.eqId === "eq_vmount")).toBeUndefined();
  });
  it("closes both lanes when the barcode lane is open too", () => {
    const both = [{ jobId: "j", eqId: "x", qty: 2, type: "pick", ts: 1 }, { jobId: "j", eqId: "x", qty: 2, type: "barcode_pick", ts: 2 }];
    const u = stillOutUnits(both)[0];
    const ev = buildReceiveEvents({ jobId: "j", eqId: "x", qty: u.qty, lanes: u.lanes, now: 9 });
    expect(ev.map(e => e.type)).toEqual(["return", "barcode_return"]);
    expect(stillOutUnits([...both, ...ev])).toEqual([]);
  });
  it("request holders carry requestId, not jobId", () => {
    const ev = buildReceiveEvents({ requestId: "r1", eqId: "y", qty: 1, now: 1 });
    expect(ev[0]).toMatchObject({ jobId: null, requestId: "r1" });
  });
  it("memoises the still-out reducer per checkouts array", () => {
    const a = stillOutUnits(checkouts), b = stillOutUnits(checkouts);
    expect(a).toBe(b);
    expect(stillOutUnits([...checkouts])).not.toBe(a);
  });
});
