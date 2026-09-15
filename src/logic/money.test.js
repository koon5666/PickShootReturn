import { describe, it, expect } from "vitest";
import { hoursWorked, calcOtAmount, calcVatBreakdown, calcTotal, DEFAULT_OT_TIERS, otExample } from "./money.js";

describe("hoursWorked", () => {
  it("returns 0 when either time is missing", () => {
    expect(hoursWorked("", "18:00")).toBe(0);
    expect(hoursWorked("06:00", null)).toBe(0);
  });
  it("counts a normal day", () => {
    expect(hoursWorked("06:00", "18:00")).toBe(12);
    expect(hoursWorked("07:30", "19:45")).toBe(12.25);
  });
  it("wraps past midnight", () => {
    expect(hoursWorked("18:00", "02:00")).toBe(8);
  });
  it("ignores seconds", () => {
    expect(hoursWorked("06:00:00", "18:00:30")).toBe(12);
  });
});

describe("calcOtAmount", () => {
  const flat = { dayRate: "2400", hoursPerDay: "12", otMultiplier: "1.5" };
  it("no OT within the base hours", () => {
    expect(calcOtAmount("06:00", "18:00", flat)).toBe(0);
    expect(calcOtAmount("06:00", "18:00", null)).toBe(0);
  });
  it("flat multiplier: hours over base x rate/hour x multiplier", () => {
    // 14h worked, 2h OT, 200/h, x1.5 = 600
    expect(calcOtAmount("06:00", "20:00", flat)).toBe(600);
  });
  it("defaults: 12h base and x1.5 when the position leaves them blank", () => {
    expect(calcOtAmount("06:00", "20:00", { dayRate: "2400" })).toBe(600);
  });
  it("tiered OT walks the bands and uses the last band beyond the table", () => {
    const pos = { dayRate: "2400", hoursPerDay: "12", variableOT: true, otTiers: DEFAULT_OT_TIERS };
    // 15h: 12-14 x1.5 (2h*200*1.5=600) + 14-15 x2 (1h*200*2=400) = 1000
    expect(calcOtAmount("06:00", "21:00", pos)).toBe(1000);
    // 20h: 600 + 800 (14-16 x2) + 1200 (16-18 x3) + 2h beyond table at last mult x3 = 1200 -> 3800
    expect(calcOtAmount("04:00", "24:00", pos)).toBe(3800);
  });
  it("tiered OT ignores invalid bands and sorts them", () => {
    const pos = { dayRate: "1200", hoursPerDay: "12", variableOT: true,
      otTiers: [{ untilHour: "16", mult: "2" }, { untilHour: "", mult: "9" }, { untilHour: "14", mult: "1.5" }] };
    // 100/h: 12-14 x1.5 = 300, 14-16 x2 = 400 -> 700 at 16h
    expect(calcOtAmount("06:00", "22:00", pos)).toBe(700);
  });
  it("variableOT with an empty tier list falls back to the flat multiplier", () => {
    expect(calcOtAmount("06:00", "20:00", { ...flat, variableOT: true, otTiers: [] })).toBe(600);
  });
});

describe("calcVatBreakdown / calcTotal", () => {
  it("no VAT: subtotal is the plain sum", () => {
    const inv = { items: [{ qty: 2, rate: "1,000", vat: true }, { qty: 1, rate: 500 }], vatEnabled: false };
    expect(calcVatBreakdown(inv)).toEqual({ subtotal: 2500, vatAmount: 0, total: 2500 });
    expect(calcTotal(inv)).toBe(2500);
  });
  it("exclusive VAT adds 7% only on VAT lines", () => {
    const inv = { items: [{ qty: 1, rate: 1000, vat: true }, { qty: 1, rate: 1000, vat: false }], vatEnabled: true, vatType: "exclusive" };
    const r = calcVatBreakdown(inv);
    expect(r.subtotal).toBe(2000);
    expect(r.vatAmount).toBeCloseTo(70, 6);
    expect(r.total).toBeCloseTo(2070, 6);
    expect(calcTotal(inv)).toBeCloseTo(2070, 6);
  });
  it("inclusive VAT backs the tax out of the line", () => {
    const inv = { items: [{ qty: 1, rate: 1070, vat: true }], vatEnabled: true, vatType: "inclusive" };
    const r = calcVatBreakdown(inv);
    expect(r.subtotal).toBeCloseTo(1000, 6);
    expect(r.vatAmount).toBeCloseTo(70, 6);
    expect(r.total).toBeCloseTo(1070, 6);
  });
  it("a line with vat undefined counts as VAT-able", () => {
    const r = calcVatBreakdown({ items: [{ qty: 1, rate: 100 }], vatEnabled: true, vatType: "exclusive" });
    expect(r.vatAmount).toBeCloseTo(7, 6);
  });
  it("legacy invoices (no items) use the four fee fields", () => {
    const inv = { laborFee: "3,000", overtime: "500", travelFee: 0, perDiem: "" };
    expect(calcTotal(inv)).toBe(3500);
    expect(calcVatBreakdown({ ...inv, vatEnabled: true, vatType: "exclusive" }).total).toBeCloseTo(3745, 6);
  });
  it("garbage qty/rate count as zero", () => {
    expect(calcTotal({ items: [{ qty: "x", rate: "y" }] })).toBe(0);
    expect(calcVatBreakdown({ items: [{ qty: "x", rate: "y" }] })).toEqual({ subtotal: 0, vatAmount: 0, total: 0 });
  });
});

describe("flat ฿/hour OT mode (P3-4)", () => {
  const pos = { dayRate: "3500", hoursPerDay: "12", otMultiplier: "1.5", otMode: "flatRate", otFlatRate: "500" };
  it("bills every OT hour at the flat rate", () => {
    expect(calcOtAmount("06:00", "20:00", pos)).toBe(1000);
    expect(calcOtAmount("06:00", "18:00", pos)).toBe(0);
  });
  it("falls back to the multiplier when the flat rate is empty", () => {
    expect(calcOtAmount("06:00", "20:00", { ...pos, otFlatRate: "" })).toBeCloseTo(2 * (3500 / 12) * 1.5, 6);
  });
  it("otExample explains one OT hour", () => {
    expect(otExample({ dayRate: "3500", hoursPerDay: "12", otMultiplier: "1.5" })).toMatchObject({ mode: "multiplier", mult: 1.5 });
    expect(otExample({ dayRate: "3500", hoursPerDay: "12", otMultiplier: "1.5" }).otPerHour).toBeCloseTo(437.5, 6);
    expect(otExample(pos)).toMatchObject({ mode: "flatRate", otPerHour: 500 });
    expect(otExample({ dayRate: "", hoursPerDay: "12" })).toBeNull();
  });
});
