import { describe, it, expect } from "vitest";
import { outcomeRecipients, gearOutcomeMessage, earlyOutcomeMessage, APP_LINK } from "./requestPush.js";

const emps = [{ id: "e1", name: "Nong", lineLinked: true }, { id: "e2", name: "Arthit" }];
const DICT = {
  notifyGearApproved: "Gear request approved", notifyGearDenied: "Gear request not approved",
  reqWork: "Work: ", reqPractice: "Practice",
  notifyEarlyPickupApproved: "Early pickup approved", notifyEarlyPickupRejected: "Early pickup not approved",
  notifyEarlyReturnApproved: "Early return approved", notifyEarlyReturnRejected: "Early return not approved",
};
const t = (k) => DICT[k] ?? k;
const formatDate = (d) => `<${d}>`;

describe("outcomeRecipients", () => {
  it("an approval reaches the group and the linked requester", () => {
    expect(outcomeRecipients({ ok: true, lineGroupId: "G", employees: emps, employeeId: "e1" })).toEqual({ userIds: ["G"], employeeIds: ["e1"] });
  });
  it("an approval with an unlinked requester still reaches the group", () => {
    expect(outcomeRecipients({ ok: true, lineGroupId: "G", employees: emps, employeeId: "e2" })).toEqual({ userIds: ["G"], employeeIds: [] });
  });
  it("a denial never goes to the group, only to the linked requester", () => {
    expect(outcomeRecipients({ ok: false, lineGroupId: "G", employees: emps, employeeId: "e1" })).toEqual({ userIds: [], employeeIds: ["e1"] });
    expect(outcomeRecipients({ ok: false, lineGroupId: "G", employees: emps, employeeId: "e2" })).toBeNull();
  });
  it("nothing when muted, or when there is no group and the requester is not linked", () => {
    expect(outcomeRecipients({ ok: true, lineGroupId: "G", lineNotifyMuted: true, employees: emps, employeeId: "e1" })).toBeNull();
    expect(outcomeRecipients({ ok: true, lineGroupId: null, employees: emps, employeeId: "e2" })).toBeNull();
    expect(outcomeRecipients({ ok: true, lineGroupId: null, employees: emps, employeeId: undefined })).toBeNull();
    expect(outcomeRecipients({ ok: true, lineGroupId: "G", employees: undefined, employeeId: "e1" })).toEqual({ userIds: ["G"], employeeIds: [] });
  });
  it("no group: the linked requester alone", () => {
    expect(outcomeRecipients({ ok: true, lineGroupId: null, employees: emps, employeeId: "e1" })).toEqual({ userIds: [], employeeIds: ["e1"] });
  });
});

describe("gearOutcomeMessage", () => {
  const req = { employeeId: "e2", employeeName: "Arthit", items: [{ eqId: "a", eqName: "Aputure 600d Pro", qty: 1 }, { eqId: "b", eqName: "V-mount battery", qty: 4 }], useDates: ["2026-09-19", "2026-09-20"], purpose: "work", jobName: "TVC Toyota", productionName: "Indie House" };
  it("names the requester, the items with ×qty, the dates, the job and the link", () => {
    expect(gearOutcomeMessage(req, true, { t, formatDate })).toBe(
      "✅ [Gear request approved] Arthit\n🎥 Aputure 600d Pro, V-mount battery ×4\n📅 <2026-09-19>, <2026-09-20>\n💼 Work: TVC Toyota (Indie House)\n🔗 " + APP_LINK);
  });
  it("denial wording, practice purpose, legacy single-item shape, no dates", () => {
    expect(gearOutcomeMessage({ employeeName: "Nong", eqName: "FX6", qty: 2, purpose: "practice" }, false, { t, formatDate })).toBe(
      "❌ [Gear request not approved] Nong\n🎥 FX6 ×2\n💼 Practice\n🔗 " + APP_LINK);
  });
  it("no purpose but a job reads as work; neither drops the line", () => {
    expect(gearOutcomeMessage({ employeeName: "Nong", eqName: "FX6", qty: 1, jobName: "Netflix" }, true, { t, formatDate })).toContain("\n💼 Work: Netflix\n");
    expect(gearOutcomeMessage({ employeeName: "Nong", eqName: "FX6", qty: 1 }, true, { t, formatDate })).not.toContain("💼");
  });
});

describe("earlyOutcomeMessage", () => {
  it("early pickup approved: who, job, day, link", () => {
    expect(earlyOutcomeMessage({ type: "early-pickup", employeeName: "Ploy", jobName: "Netflix", requestedDate: "2026-09-16" }, true, { t, formatDate })).toBe(
      "✅ [Early pickup approved] Ploy\n🎬 Netflix\n📅 <2026-09-16>\n🔗 " + APP_LINK);
  });
  it("early return rejected", () => {
    expect(earlyOutcomeMessage({ type: "early-return", employeeName: "Ploy", jobName: "Netflix", requestedDate: "2026-09-16" }, false, { t, formatDate })).toBe(
      "❌ [Early return not approved] Ploy\n🎬 Netflix\n📅 <2026-09-16>\n🔗 " + APP_LINK);
  });
});
