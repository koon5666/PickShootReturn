import { describe, it, expect } from "vitest";
import { buildSavePayload, dirtyFields, queueProfile, drainProfileQueue, SAVE_FIELDS } from "./offline.js";

const eq = [{ id: "eq1" }];
const jobs = [{ id: "j1" }];

describe("buildSavePayload", () => {
  it("sends only fields that were loaded (or changed vs snapshot) AND differ from lastSaved", () => {
    const state = { equipment: eq, jobs, companyName: "X", lineGroupId: null };
    const kvLoaded = new Set(["equipment", "jobs"]);
    // nothing changed since load
    expect(buildSavePayload(state, { lastSaved: { equipment: eq, jobs, companyName: "X" }, kvLoaded }).payload).toEqual({});
    // jobs edited (new reference)
    const jobs2 = [...jobs, { id: "j2" }];
    const r = buildSavePayload({ ...state, jobs: jobs2 }, { lastSaved: { equipment: eq, jobs }, kvLoaded });
    expect(r.payload).toEqual({ jobs: jobs2 });
    expect(r.sent).toEqual({ jobs: jobs2 });
    // companyName was never loaded and equals the snapshot -> never written (data-safety guard)
    const snap = { companyName: "X" };
    const saved = { equipment: eq, jobs };
    expect(buildSavePayload(state, { lastSaved: saved, kvLoaded, snapshot: snap }).payload).toEqual({});
    // ... but a user edit vs the snapshot is written
    expect(buildSavePayload({ ...state, companyName: "Y" }, { lastSaved: saved, kvLoaded, snapshot: snap }).payload).toEqual({ companyName: "Y" });
  });
  it("employee sends only own invoices, admin all; lineGroupId null is skipped", () => {
    const inv = [{ id: "a", employeeId: "e1" }, { id: "b", employeeId: "e2" }];
    const kvLoaded = new Set(["invoices", "lineGroupId"]);
    const emp = buildSavePayload({ invoices: inv, lineGroupId: null }, { kvLoaded, user: { role: "employee", id: "e1" } });
    expect(emp.payload).toEqual({ invoices: [inv[0]], _invoiceEmployeeId: "e1" });
    expect(emp.sent).toEqual({ invoices: inv });
    const adm = buildSavePayload({ invoices: inv, lineGroupId: "G" }, { kvLoaded, user: { role: "admin" } });
    expect(adm.payload).toEqual({ invoices: inv, _invoiceEmployeeId: "admin", lineGroupId: "G" });
  });
  it("employee never sends a field the server forbids (theme, jobs, lineGroupId), even when it looks dirty", () => {
    // Crew boot: KV has no theme yet, so lastSaved.theme is undefined while state
    // holds the cached default object. Before this guard the Save button PUT it
    // and the server 403'd the whole request (checkout Save failed for every crew).
    const theme = { style: "flat", palette: "white-blue" };
    const kvLoaded = new Set(["jobs", "checkouts", "lineGroupId"]);
    const state = { jobs, checkouts: [{ id: "c1" }], theme, lineGroupId: "G" };
    const emp = buildSavePayload(state, { lastSaved: { jobs: [] }, kvLoaded, user: { role: "employee", id: "e1" } });
    expect(emp.payload).toEqual({ checkouts: state.checkouts });
    expect(emp.sent).toEqual({ checkouts: state.checkouts });
    // admin still sends them all
    const adm = buildSavePayload(state, { lastSaved: { jobs: [] }, kvLoaded, snapshot: { theme: {} }, user: { role: "admin" } });
    expect(Object.keys(adm.payload).sort()).toEqual(["checkouts", "jobs", "lineGroupId", "theme"]);
  });
  it("dirtyFields names the pending delta; theme is a known field", () => {
    expect(SAVE_FIELDS).toContain("theme");
    const kvLoaded = new Set(["equipment", "theme"]);
    expect(dirtyFields({ equipment: eq, theme: { style: "flat" } }, { lastSaved: { equipment: eq }, kvLoaded })).toEqual(["theme"]);
  });
});

describe("profile queue", () => {
  it("one entry per employee, newest wins, order kept", () => {
    let q = queueProfile([], "e1", { a: 1 });
    q = queueProfile(q, "e2", { b: 1 });
    q = queueProfile(q, "e1", { a: 2 });
    expect(q.map(x => [x.empId, x.profile])).toEqual([["e1", { a: 2 }], ["e2", { b: 1 }]]);
  });
  it("drain stops at the first failure and keeps the rest", async () => {
    const q = [{ empId: "e1", profile: 1 }, { empId: "e2", profile: 2 }, { empId: "e3", profile: 3 }];
    const calls = [];
    const put = async (id) => { calls.push(id); return { ok: id !== "e2" }; };
    const rest = await drainProfileQueue(q, put);
    expect(calls).toEqual(["e1", "e2"]);
    expect(rest.map(x => x.empId)).toEqual(["e2", "e3"]);
    expect(await drainProfileQueue(rest, async () => ({ ok: true }))).toEqual([]);
    expect(await drainProfileQueue(rest, async () => { throw new Error("net"); })).toEqual(rest);
  });
});

describe("SAVE_FIELDS covers every client-writable field", () => {
  it("mirrors the app's DATA_FIELDS (a field missing here silently never persists)", () => {
    for (const f of ["equipment", "jobs", "checkouts", "employees", "reports", "productionCompanies", "invoices", "companyName", "equipmentRequests", "adminRequests", "timezone", "timeFormat", "kpiConfig", "punishments", "kpiEvents", "photoVerification", "navOrder", "verificationConfig", "invoicePresets", "chatEnabled", "theme", "roleList"]) {
      expect(SAVE_FIELDS).toContain(f);
    }
  });
});
