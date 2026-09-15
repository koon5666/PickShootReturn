import { describe, it, expect } from "vitest";
import { utilisation, utilisationCsv, overdueCsv, customerHistory, customerHistoryCsv, customerNames, crewStatement, crewStatementCsv, periodPreset, daysInPeriod, toCsv } from "./reports.js";
import { stillOutList } from "./availability.js";

const DAY = 86400000;
const T0 = Date.parse("2026-09-01T00:00:00Z");
const at = (d, h = 0) => T0 + d * DAY + h * 3600000;
const equipment = [{ id: "fx6", name: "Sony FX6", category: "Camera", total: 2 }, { id: "bat", name: "V-Mount", category: "Power", total: 8 }, { id: "idle", name: "Slider", total: 1 }];
const jobs = [
  { id: "j1", name: "TVC A", production: "Bangkok Pictures", status: "Confirmed", dates: ["2026-09-03", "2026-09-04"], assignedEquipment: [{ eqId: "fx6", qty: 1 }, { eqId: "bat", qty: 4 }] },
  { id: "j2", name: "Doc B", production: "bangkok pictures", status: "Confirmed", dates: ["2026-09-20"], pickupDate: "2026-09-19", assignedEquipment: [{ eqId: "fx6", qty: 2 }] },
  { id: "j3", name: "Pencil C", production: "Other Co", status: "Pencil", dates: ["2026-09-10"], assignedEquipment: [{ eqId: "fx6", qty: 1 }] },
];
const ev = (type, eqId, qty, ts, extra = {}) => ({ id: type + eqId + ts, jobId: "j1", jobName: "TVC A", eqId, qty, employeeId: "e1", employeeName: "Nong", type, ts, ...extra });

describe("period helpers", () => {
  it("presets and day counts", () => {
    expect(periodPreset("thisMonth", "2026-09-16")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(periodPreset("lastMonth", "2026-01-10")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(periodPreset("thisYear", "2026-09-16")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect(periodPreset("last30", "2026-09-16")).toEqual({ from: "2026-08-18", to: "2026-09-16" });
    expect(daysInPeriod("2026-09-01", "2026-09-30")).toBe(30);
    expect(daysInPeriod("2026-09-05", "2026-09-01")).toBe(0);
  });
});

describe("utilisation", () => {
  it("counts unit-days out from the log, clamps to the period, and booked days from Confirmed holds", () => {
    // FX6 out 3 full days (Sep 3 00:00 -> Sep 6 00:00), 4 batteries out 1 day, 2 returned then the rest lost
    const checkouts = [
      ev("pick", "fx6", 1, at(2)), ev("return", "fx6", 1, at(5)),
      ev("pick", "bat", 4, at(2)), ev("return", "bat", 2, at(3)), ev("lost", "bat", 2, at(3)),
      ev("void", "fx6", 1, at(2)), // ignored
    ];
    const rows = utilisation({ equipment, checkouts, jobs, from: "2026-09-01", to: "2026-09-10", now: at(20) });
    const fx6 = rows.find(r => r.eqId === "fx6");
    expect(fx6.periodDays).toBe(10);
    expect(fx6.unitDaysOut).toBe(3);
    expect(fx6.outPct).toBe(15); // 3 / (2 units x 10 days)
    expect(fx6.unitDaysBooked).toBe(2); // j1 holds Sep 3-4 x1; j2 (Sep 19-20) is outside; pencil ignored
    expect(fx6.bookedPct).toBe(10);
    expect(fx6.picks).toBe(1);
    expect(fx6.jobs).toBe(1);
    const bat = rows.find(r => r.eqId === "bat");
    expect(bat.unitDaysOut).toBe(4); // 4 units x 1 day, then 2 back + 2 lost = nothing out
    expect(bat.unitDaysBooked).toBe(8);
    const idle = rows.find(r => r.eqId === "idle");
    expect(idle.outPct).toBe(0);
    expect(rows[0].eqId).toBe("fx6"); // sorted by out %
  });
  it("gear still out keeps counting until the end of the period (or now), and both lanes count once", () => {
    const checkouts = [ev("pick", "fx6", 1, at(8)), ev("barcode_pick", "fx6", 1, at(8) + 1000)];
    const r = utilisation({ equipment, checkouts, jobs: [], from: "2026-09-01", to: "2026-09-10", now: at(30) }).find(r => r.eqId === "fx6");
    expect(r.unitDaysOut).toBe(2); // Sep 9 00:00 -> Sep 11 00:00, one unit not two
    const r2 = utilisation({ equipment, checkouts, jobs: [], from: "2026-09-01", to: "2026-09-10", now: at(9) }).find(r => r.eqId === "fx6");
    expect(r2.unitDaysOut).toBe(1); // "now" is Sep 10 00:00
    expect(utilisation({ equipment, checkouts, from: "2026-09-10", to: "2026-09-01" })).toEqual([]);
  });
  it("csv has one row per item", () => {
    const csv = utilisationCsv(utilisation({ equipment, checkouts: [], jobs, from: "2026-09-01", to: "2026-09-30" }), { from: "2026-09-01", to: "2026-09-30" });
    expect(csv.split("\n")).toHaveLength(4);
    expect(csv).toContain("Sony FX6,Camera,2,");
  });
});

describe("overdueCsv", () => {
  it("exports the still-out rows with status + days overdue, or only overdue ones", () => {
    const checkouts = [ev("pick", "fx6", 1, at(2)), ev("pick", "bat", 4, at(2)), ev("return", "bat", 1, at(3), { condition: "missing" })];
    const items = stillOutList({ checkouts, jobs, equipment, today: "2026-09-10", tz: "UTC" });
    const csv = overdueCsv(items, { tz: "UTC" });
    const lines = csv.split("\n");
    expect(lines[0]).toMatch(/^Status,Equipment,Qty,Job,Production/);
    expect(lines).toHaveLength(3);
    expect(csv).toContain("OVERDUE,Sony FX6,1,TVC A,Bangkok Pictures,Nong,2026-09-03,7,2026-09-04,6,");
    expect(csv).toContain("OVERDUE,V-Mount,3,TVC A,Bangkok Pictures,Nong,2026-09-03,7,2026-09-04,6,partial return");
    expect(overdueCsv(items.map(i => ({ ...i, overdue: false, daysOverdue: 0 })), { onlyOverdue: true }).split("\n")).toHaveLength(1);
  });
});

describe("customerHistory", () => {
  it("matches the production name case-insensitively, newest job first, with items, days and totals", () => {
    const checkouts = [ev("pick", "fx6", 1, at(2))];
    const h = customerHistory({ jobs, equipment, checkouts, company: "Bangkok Pictures" });
    expect(h.rows.map(r => r.name)).toEqual(["Doc B", "TVC A"]);
    const a = h.rows[1];
    expect(a).toMatchObject({ shootDays: 2, holdDays: 2, units: 5, unitDays: 10, picked: 1, status: "Confirmed" });
    expect(a.items).toEqual([{ eqId: "fx6", name: "Sony FX6", qty: 1 }, { eqId: "bat", name: "V-Mount", qty: 4 }]);
    const b = h.rows[0];
    expect(b.holdDays).toBe(2); // pickup day + shoot day
    expect(h.totals).toEqual({ jobs: 2, shootDays: 3, holdDays: 4, units: 7, unitDays: 14 });
    expect(customerHistory({ jobs, company: "" }).rows).toEqual([]);
    const csv = customerHistoryCsv(h);
    expect(csv.split("\n")).toHaveLength(3);
    expect(csv).toContain("Sony FX6; V-Mount x4");
  });
  it("customerNames merges the company book and job productions", () => {
    expect(customerNames(jobs, [{ name: "Zeta Films" }, { name: "bangkok pictures " }])).toEqual(["bangkok pictures", "Other Co", "Zeta Films"]);
    expect(customerNames(jobs, [])).toEqual(["Bangkok Pictures", "Other Co"]);
  });
});

describe("crewStatement", () => {
  const invoices = [
    { id: "a", invoiceNo: "INV-NG-26-0001", employeeId: "e1", jobName: "TVC A", productionCompany: "Bangkok Pictures", docType: "invoice", status: "Paid", paidDate: "2026-09-12", createdAt: at(2, 9), items: [{ qty: 1, rate: 3500 }], whtEnabled: true, position: "1st AC" },
    { id: "b", invoiceNo: "INV-AR-26-0001", employeeId: "e2", jobName: "TVC A", billTo: { name: "Bangkok Pictures" }, docType: "invoice", status: "Pending", issueDate: "2026-09-20", items: [{ qty: 2, rate: 1000 }], vatEnabled: true, vatType: "exclusive" },
    { id: "c", invoiceNo: "QUO-NG-26-0001", employeeId: "e1", productionCompany: "Bangkok Pictures", docType: "quotation", createdAt: at(2), items: [{ qty: 1, rate: 99 }] },
    { id: "d", invoiceNo: "INV-NG-26-0002", employeeId: "e1", productionCompany: "Other Co", docType: "invoice", status: "Pending", createdAt: at(40), items: [{ qty: 1, rate: 500 }] },
    { id: "e", invoiceNo: "INV-NG-26-0003", employeeId: "e1", productionCompany: "Other Co", docType: "invoice", status: "Void", createdAt: at(3), items: [{ qty: 1, rate: 500 }] },
    { id: "f", invoiceNo: "INV-LC-26-0001", employeeId: "admin", productionCompany: "Other Co", docType: "invoice", createdAt: at(3), items: [{ qty: 1, rate: 500 }] },
    { id: "g", invoiceNo: "INV-NG-26-0004", employeeId: "e1", productionCompany: "Other Co", docType: "invoice", createdAt: at(3), _deleted: true, items: [{ qty: 1, rate: 500 }] },
  ];
  const employees = [{ id: "e1", name: "Nong" }, { id: "e2", name: "Arthit" }];
  it("groups the month's live crew invoices by customer with WHT and net, skipping quotes, voids, house docs and deleted", () => {
    const st = crewStatement({ invoices, employees, month: "2026-09", tz: "UTC" });
    expect(st.companies).toHaveLength(1);
    const g = st.companies[0];
    expect(g.company).toBe("Bangkok Pictures");
    expect(g.rows.map(r => r.no)).toEqual(["INV-NG-26-0001", "INV-AR-26-0001"]);
    expect(g.rows[0]).toMatchObject({ employee: "Nong", position: "1st AC", status: "Paid", paidDate: "2026-09-12", subtotal: 3500, wht: 105, net: 3395, issued: "2026-09-03" });
    expect(g.rows[1]).toMatchObject({ employee: "Arthit", subtotal: 2000, vat: 140, total: 2140, wht: 0, net: 2140, issued: "2026-09-20" });
    expect(g.total).toBe(5640);
    expect(g.paid).toBe(3395);
    expect(g.unpaid).toBe(2140);
    expect(st.grand).toEqual({ count: 2, total: 5640, wht: 105, net: 5535, paid: 3395, unpaid: 2140 });
    expect(crewStatement({ invoices, employees, month: "2026-10", tz: "UTC" }).companies.map(c => c.company)).toEqual(["Other Co"]);
    const csv = crewStatementCsv(st);
    expect(csv.split("\n")).toHaveLength(3);
    expect(csv).toContain("2026-09,Bangkok Pictures,Nong,1st AC,INV-NG-26-0001,TVC A,2026-09-03,Paid,2026-09-12,3500.00,0.00,3500.00,105.00,3395.00");
  });
  it("toCsv quotes commas and quotes", () => {
    expect(toCsv(["a"], [['x, "y"']])).toBe('a\n"x, ""y"""');
  });
});
