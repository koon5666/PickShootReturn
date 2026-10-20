import { describe, it, expect } from "vitest";
import { isExpiredPencil, expirePencils, jobsWithGearOut, isAutoDeclined } from "./pencilExpiry.js";

const T = "2026-10-20";
const pick = (jobId, qty = 1) => ({ id: "c" + Math.random(), jobId, eqId: "eq1", qty, type: "pick", ts: 1 });
const ret = (jobId, qty = 1) => ({ id: "c" + Math.random(), jobId, eqId: "eq1", qty, type: "return", ts: 2 });

describe("pencil expiry (2026-10-20)", () => {
  it("expires the morning AFTER the last shoot day, not on it", () => {
    expect(isExpiredPencil({ id: "a", status: "Pencil", dates: ["2026-10-19"] }, T)).toBe(true);
    expect(isExpiredPencil({ id: "a", status: "Pencil", dates: [T] }, T)).toBe(false);
    expect(isExpiredPencil({ id: "a", status: "Pencil", dates: ["2026-10-21"] }, T)).toBe(false);
  });
  it("uses the LAST shoot day of a multi-day job, whatever order the dates are in", () => {
    expect(isExpiredPencil({ id: "a", status: "Pencil", dates: [T, "2026-10-18"] }, T)).toBe(false);
    expect(isExpiredPencil({ id: "a", status: "Pencil", dates: ["2026-10-19", "2026-10-15"] }, T)).toBe(true);
  });
  it("only ever touches Pencil jobs", () => {
    for (const status of ["Confirmed", "Cancelled", "Declined"]) expect(isExpiredPencil({ id: "a", status, dates: ["2026-01-01"] }, T)).toBe(false);
  });
  it("leaves dateless, deleted and missing jobs alone", () => {
    expect(isExpiredPencil({ id: "a", status: "Pencil", dates: [] }, T)).toBe(false);
    expect(isExpiredPencil({ id: "a", status: "Pencil" }, T)).toBe(false);
    expect(isExpiredPencil({ id: "a", status: "Pencil", dates: ["2026-01-01"], _deleted: true }, T)).toBe(false);
    expect(isExpiredPencil(null, T)).toBe(false);
    expect(isExpiredPencil({ id: "a", status: "Pencil", dates: ["2026-01-01"] }, "")).toBe(false);
  });
  it("keeps a pencil with gear still out, and lets it go once the gear is back", () => {
    const job = { id: "j1", status: "Pencil", dates: ["2026-10-10"] };
    expect(isExpiredPencil(job, T, jobsWithGearOut([pick("j1")]))).toBe(false);
    expect(isExpiredPencil(job, T, jobsWithGearOut([pick("j1"), ret("j1")]))).toBe(true);
    expect(isExpiredPencil(job, T, jobsWithGearOut([pick("j2")]))).toBe(true);
  });
  it("expirePencils flips only the expired ones, stamps them, and returns the same array when nothing changes", () => {
    const jobs = [
      { id: "old", name: "Old pencil", status: "Pencil", dates: ["2026-10-01"] },
      { id: "soon", name: "Next week", status: "Pencil", dates: ["2026-10-27"] },
      { id: "done", name: "Shot", status: "Confirmed", dates: ["2026-10-01"] },
    ];
    const r = expirePencils(jobs, { today: T, checkouts: [], now: 123 });
    expect(r.declined.map(j => j.id)).toEqual(["old"]);
    expect(r.jobs[0]).toEqual({ ...jobs[0], status: "Declined", autoDeclined: { at: 123, from: "Pencil", reason: "pencil-expired" } });
    expect(r.jobs[1]).toBe(jobs[1]);
    expect(r.jobs[2]).toBe(jobs[2]);
    expect(jobs[0].status).toBe("Pencil"); // input untouched
    const again = expirePencils(r.jobs, { today: T, checkouts: [] });
    expect(again.declined).toEqual([]);
    expect(again.jobs).toBe(r.jobs);
  });
  it("tags auto-declined jobs only while they stay Declined", () => {
    expect(isAutoDeclined({ status: "Declined", autoDeclined: { at: 1 } })).toBe(true);
    expect(isAutoDeclined({ status: "Confirmed", autoDeclined: { at: 1 } })).toBe(false);
    expect(isAutoDeclined({ status: "Declined" })).toBe(false);
  });
});
