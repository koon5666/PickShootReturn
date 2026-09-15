import { describe, it, expect } from "vitest";
import { filterHistory, historyCsv } from "./history.js";

const TZ = "Asia/Bangkok";
const ts = (d, h = 9) => Date.parse(`${d}T${String(h).padStart(2, "0")}:00:00+07:00`);
const evts = [];
for (let i = 0; i < 25; i++) evts.push({ id: "c" + i, eqId: "x", type: i % 2 ? "return" : "pick", ts: ts("2026-09-01") + i * 86400000, jobName: "Job " + i, employeeName: "Nong", qty: 1 });
evts.push({ id: "other", eqId: "y", type: "pick", ts: ts("2026-09-05"), qty: 1 });

describe("filterHistory", () => {
  it("caps at 20 but reports the true total", () => {
    const r = filterHistory(evts, "x", { tz: TZ });
    expect(r.rows).toHaveLength(20);
    expect(r.total).toBe(25);
    expect(r.all).toBe(25);
    expect(r.rows[0].id).toBe("c24"); // newest first
  });
  it("limit 0 returns everything", () => {
    expect(filterHistory(evts, "x", { limit: 0 }).rows).toHaveLength(25);
  });
  it("filters by inclusive date range in the app timezone", () => {
    const r = filterHistory(evts, "x", { from: "2026-09-03", to: "2026-09-05", tz: TZ, limit: 0 });
    expect(r.rows.map(e => e.id)).toEqual(["c4", "c3", "c2"]);
    expect(r.total).toBe(3);
    expect(r.all).toBe(25);
  });
  it("open-ended ranges work", () => {
    expect(filterHistory(evts, "x", { from: "2026-09-24", tz: TZ }).total).toBe(2);
    expect(filterHistory(evts, "x", { to: "2026-09-01", tz: TZ }).total).toBe(1);
  });
  it("a late-night event stays on its Bangkok date, not the UTC one", () => {
    const late = [{ id: "n", eqId: "x", type: "pick", ts: ts("2026-09-10", 23) }];
    expect(filterHistory(late, "x", { from: "2026-09-10", to: "2026-09-10", tz: TZ }).total).toBe(1);
    expect(filterHistory(late, "x", { from: "2026-09-11", to: "2026-09-11", tz: TZ }).total).toBe(0);
  });
});

describe("historyCsv", () => {
  it("writes a header + one line per event, escaping commas and quotes", () => {
    const rows = [
      { type: "pick", ts: ts("2026-09-05", 8), jobName: 'TVC "Toyota", Hero', employeeName: "Nong", qty: 2, location: { lat: 13.7, lng: 100.5 } },
      { type: "barcode_return", ts: ts("2026-09-06", 20), jobName: "Netflix", employeeName: "Arthit" },
    ];
    const csv = historyCsv(rows, { eqName: "Sony FX6", tz: TZ });
    const lines = csv.split("\n");
    expect(lines[0]).toBe("Date,Time,Type,Equipment,Job,Employee,Qty,Condition,Note,GPS");
    expect(lines[1]).toBe('2026-09-05,08:00,Pick,Sony FX6,"TVC ""Toyota"", Hero",Nong,2,,,"13.7,100.5"');
    expect(lines[2]).toBe("2026-09-06,20:00,Return,Sony FX6,Netflix,Arthit,1,,,");
  });
  it("carries condition + note, labels lost events, and filterHistory drops void tombstones", () => {
    const rows = [
      { type: "return", ts: ts("2026-09-06", 20), jobName: "Netflix", employeeName: "Arthit", qty: 1, condition: "damaged", note: "lens cap, missing" },
      { type: "lost", ts: ts("2026-09-07", 9), jobName: "Netflix", employeeName: "Admin", qty: 1, condition: "written_off" },
    ];
    const lines = historyCsv(rows, { eqName: "FX6", tz: TZ }).split("\n");
    expect(lines[1]).toBe('2026-09-06,20:00,Return,FX6,Netflix,Arthit,1,damaged,"lens cap, missing",');
    expect(lines[2]).toBe("2026-09-07,09:00,Lost,FX6,Netflix,Admin,1,written_off,,");
    const log = [{ id: "a", eqId: "x", type: "pick", qty: 1, ts: 1 }, { id: "b", eqId: "x", type: "void", voidedType: "pick", qty: 0, ts: 2 }];
    expect(filterHistory(log, "x", { limit: 0 }).rows.map(r => r.id)).toEqual(["a"]);
  });
});
