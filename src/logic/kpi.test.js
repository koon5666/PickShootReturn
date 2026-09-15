import { describe, it, expect } from "vitest";
import { kpiPeriod, kpiScore, kpiDelta, kpiStars, buildKpiEvent, visibleKpiRules, kpiEventsInPeriod } from "./kpi.js";

const T = "2026-09-16";
const ts = (d) => new Date(d + "T12:00:00").getTime();

describe("kpiPeriod", () => {
  it("defaults to the calendar year", () => {
    const p = kpiPeriod({}, T);
    expect(p.start.getFullYear()).toBe(2026); expect(p.start.getMonth()).toBe(0);
    expect(p.end.getFullYear()).toBe(2027);
  });
  it("rolls forward by resetMonths from startDate", () => {
    const p = kpiPeriod({ startDate: "2025-03-01", resetMonths: 6 }, T);
    const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    expect(ymd(p.start)).toBe("2026-09-01");
    expect(ymd(p.end)).toBe("2027-03-01");
  });
  it("a future start is used as-is", () => {
    const p = kpiPeriod({ startDate: "2027-01-01" }, T);
    expect(p.start.getFullYear()).toBe(2027);
  });
});

describe("kpiScore", () => {
  it("full score with no events", () => { expect(kpiScore("e1", [], {}, T)).toBe(100); });
  it("legacy events (no kind) deduct", () => {
    expect(kpiScore("e1", [{ employeeId: "e1", points: 10, ts: ts("2026-05-01") }], {}, T)).toBe(90);
  });
  it("positive adjustments add back, clamped at max", () => {
    const evs = [
      { employeeId: "e1", points: 10, ts: ts("2026-05-01") },
      { employeeId: "e1", points: 5, kind: "add", ts: ts("2026-06-01") },
      { employeeId: "e1", points: 20, kind: "add", ts: ts("2026-07-01") },
    ];
    expect(kpiScore("e1", evs, {}, T)).toBe(100);
    expect(kpiScore("e1", evs.slice(0, 2), {}, T)).toBe(95);
  });
  it("never below zero, ignores other employees and other periods", () => {
    const evs = [
      { employeeId: "e1", points: 500, ts: ts("2026-05-01") },
      { employeeId: "e2", points: 5, ts: ts("2026-05-01") },
      { employeeId: "e1", points: 5, ts: ts("2025-05-01") },
    ];
    expect(kpiScore("e1", evs, {}, T)).toBe(0);
    expect(kpiScore("e2", evs, {}, T)).toBe(95);
    expect(kpiEventsInPeriod("e1", evs, {}, T)).toHaveLength(1);
  });
  it("respects maxPoints and stars", () => {
    expect(kpiScore("e1", [{ employeeId: "e1", points: 5, ts: ts("2026-05-01") }], { maxPoints: 50 }, T)).toBe(45);
    expect(kpiStars(45, { maxPoints: 50 })).toBe(4.5);
  });
  it("kpiDelta signs by kind and uses the magnitude", () => {
    expect(kpiDelta({ points: -3 })).toBe(-3);
    expect(kpiDelta({ points: "3", kind: "add" })).toBe(3);
  });
});

describe("buildKpiEvent", () => {
  it("rejects zero points or an empty reason", () => {
    expect(buildKpiEvent({ employeeId: "e1", points: "0", reason: "x" }).ok).toBe(false);
    expect(buildKpiEvent({ employeeId: "e1", points: "3", reason: "  " }).error).toBe("reason");
  });
  it("normalises kind and magnitude", () => {
    const r = buildKpiEvent({ employeeId: "e1", points: "-2.5", reason: "clean return", kind: "add", now: 1 });
    expect(r.ok).toBe(true);
    expect(r.event).toMatchObject({ id: "kpi1", points: 2.5, kind: "add", reason: "clean return", punishmentId: null, by: "admin" });
    expect(buildKpiEvent({ employeeId: "e1", points: 2, reason: "late", kind: "weird" }).event.kind).toBe("deduct");
  });
});

describe("visibleKpiRules", () => {
  it("drops blank rows", () => {
    expect(visibleKpiRules([{ label: "", points: 5 }, { label: "Late", points: "" }, { label: "Late", points: "5" }, null])).toEqual([{ label: "Late", points: "5" }]);
  });
});
