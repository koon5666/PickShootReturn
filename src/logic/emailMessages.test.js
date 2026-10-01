import { describe, it, expect } from "vitest";
import { jobEmail, jobChangeRows, gearRequestEmail, gearOutcomeEmail, earlyRequestEmail, geoReturnRequestEmail, geoReturnOutcomeEmail, damageReportEmail, invoiceEmail, fmtDateRange, fmtDay } from "./emailMessages.js";
import { jobChangeSet } from "./roster.js";

const employees = [{ id: "e1", name: "Nong" }, { id: "e2", name: "Arthit" }];
const equipment = [{ id: "fx6", name: "Sony FX6" }, { id: "vm", name: "V-Mount" }];
const job = {
  id: "j1", name: "TVC Toyota", production: "Phenomena", status: "Confirmed",
  dates: ["2026-10-03", "2026-10-02", "2026-10-07"], pickupDate: "2026-10-01", returnDate: "2026-10-08",
  shootTime: "Day", location: "Local (Bangkok)", contactPerson: "Khun Ploy", contactPlatform: "Line",
  dateOverrides: { "2026-10-07": { location: "Out of Town", locationCity: "Hua Hin", shootTime: "Night" } },
  crew: [{ employeeId: "e1", role: "1st AC", callTime: "05:30" }],
  assignedEquipment: [{ eqId: "fx6", qty: 2 }, { eqId: "vm", qty: 6 }],
};
const flat = (m) => JSON.stringify(m.message);

describe("email: jobs", () => {
  it("a new job goes to every crew member with every detail", () => {
    const e = jobEmail(job, { changes: ["new"], employees, equipment, by: "Koon" });
    expect(e.to).toEqual({ allCrew: true });
    expect(e.message.subject).toBe("[New job] TVC Toyota · Phenomena · 2, 3, 7 Oct 2026");
    const s = flat(e);
    for (const want of ["Phenomena", "Confirmed (ยืนยัน)", "3 days", "Thu 1 Oct 2026", "Thu 8 Oct 2026", "Khun Ploy via Line", "Koon",
      "Out of Town · Hua Hin · Night", "Nong", "1st AC · call 05:30", "Sony FX6 × 2", "V-Mount × 6"]) expect(s).toContain(want);
  });
  it("status flips get their own headline: confirmed / declined / cancelled", () => {
    const before = { ...job, status: "Pencil" };
    expect(jobEmail(job, { before, changes: ["status"], employees, equipment }).message.subject).toMatch(/^\[Job confirmed\]/);
    expect(jobEmail({ ...job, status: "Cancelled" }, { before, changes: ["status"] }).message.tone).toBe("bad");
    expect(jobEmail({ ...job, status: "Declined" }, { before, changes: ["status"] }).message.subject).toMatch(/^\[Job declined\]/);
  });
  it("an edit leads with what changed, before and after", () => {
    const after = { ...job, dates: ["2026-10-02", "2026-10-03", "2026-10-04"], location: "Overseas", locationCity: "Tokyo", crew: [{ employeeId: "e2", role: "Gaffer" }] };
    const changes = jobChangeSet(job, after);
    const rows = jobChangeRows(job, after, changes, employees);
    const text = JSON.stringify(rows);
    expect(text).toContain("2, 3, 7 Oct 2026 → 2-4 Oct 2026");
    expect(text).toContain("Local (Bangkok) → Overseas · Tokyo");
    expect(text).toContain("Crew added");
    expect(text).toContain("Arthit");
    expect(text).toContain("Crew removed");
    const e = jobEmail(after, { before: job, changes, employees, equipment });
    expect(e.message.sections[0].title).toMatch(/^What changed/);
    expect(e.message.subject).toMatch(/^\[Job updated\]/);
  });
  it("an open job (no crew list) says so; no gear says so", () => {
    const s = flat(jobEmail({ ...job, crew: [], assignedEquipment: [] }, { changes: ["new"] }));
    expect(s).toContain("open to everyone");
    expect(s).toContain("No gear assigned yet");
  });
  it("no contact person: no lonely 'via Line' row", () => {
    expect(flat(jobEmail({ ...job, contactPerson: "" }, { changes: ["new"] }))).not.toContain("via Line");
  });
});

describe("email: requests and outcomes", () => {
  const req = { id: "r1", employeeId: "e1", employeeName: "Nong", items: [{ eqId: "fx6", eqName: "Sony FX6", qty: 1 }, { eqId: "vm", eqName: "V-Mount", qty: 4 }], useDates: ["2026-10-05", "2026-10-06"], purpose: "work", jobName: "MV", productionName: "GMM", reason: "B-cam", requestedAt: Date.parse("2026-10-01T02:00:00Z") };
  it("a gear request goes to the house with items, dates, purpose and note", () => {
    const e = gearRequestEmail(req, { tz: "Asia/Bangkok" });
    expect(e.to).toEqual({ admin: true });
    const s = flat(e);
    for (const want of ["Sony FX6 × 1", "V-Mount × 4", "5, 6 Oct 2026", "MV", "GMM", "B-cam", "Mon 5 Oct 2026"]) expect(s).toContain(want);
  });
  it("the outcome goes to the requester only", () => {
    const ok = gearOutcomeEmail(req, true, { by: "Koon" });
    expect(ok.to).toEqual({ employeeIds: ["e1"] });
    expect(ok.message.tone).toBe("good");
    expect(flat(ok)).toContain("Koon");
    expect(gearOutcomeEmail(req, false).message.subject).toMatch(/denied/);
  });
  it("early pickup request carries the job's dates", () => {
    const e = earlyRequestEmail({ type: "early-pickup", employeeName: "Nong", jobName: "TVC Toyota", requestedDate: "2026-10-01" }, { job });
    expect(e.to).toEqual({ admin: true });
    expect(flat(e)).toContain("2, 3, 7 Oct 2026");
  });
  it("return outside the radius: request to the house, several decisions become one email", () => {
    const g = { type: "geo-return", employeeId: "e1", employeeName: "Nong", eqName: "Sony FX6", qty: 1, jobName: "TVC", condition: "damaged", distance: 2300, threshold: 50 };
    const r = geoReturnRequestEmail(g);
    expect(r.to).toEqual({ admin: true });
    expect(flat(r)).toContain("2.3 km");
    expect(flat(r)).toContain("Damaged");
    const one = geoReturnOutcomeEmail(g, false, { by: "Koon" });
    expect(one.to).toEqual({ employeeIds: ["e1"] });
    const many = geoReturnOutcomeEmail([g, { ...g, eqName: "V-Mount", qty: 3, condition: "ok" }], true);
    expect(many.message.subject).toBe("[Return approved] 2 items");
    expect(many.message.sections[0].items).toHaveLength(2);
  });
  it("damage report and invoice go to the house", () => {
    const d = damageReportEmail({ eqName: "Sony FX6", description: "Cracked LCD", jobName: "TVC", ts: Date.parse("2026-10-01T05:00:00Z"), reportedBy: { name: "Nong" }, photos: ["a", "b"] });
    expect(d.to).toEqual({ admin: true });
    expect(flat(d)).toContain("Cracked LCD");
    expect(flat(d)).toContain("2 photos");
    const i = invoiceEmail({ jobName: "TVC", productionCompany: "Phenomena", status: "Pending" }, { name: "Nong", docNo: "NG-0012", total: 12500, shareUrl: "https://pickshootreturn.pages.dev/api/invoice-view/inv_share_x" });
    expect(i.message.subject).toBe("[Invoice] NG-0012 · Nong · ฿12,500");
    expect(i.message.link.url).toContain("/api/invoice-view/inv_share_x");
    expect(flat(i)).toContain("฿12,500.00");
  });
});

describe("email: dates", () => {
  it("formats runs like the LINE recap", () => {
    expect(fmtDateRange(["2026-10-08", "2026-10-09", "2026-10-10", "2026-10-15", "2026-11-02"])).toBe("8-10, 15 Oct 2026 · 2 Nov 2026");
    expect(fmtDay("2026-10-01")).toBe("Thu 1 Oct 2026");
    expect(fmtDay("")).toBe("");
  });
});
