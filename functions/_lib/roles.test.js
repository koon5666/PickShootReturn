import { describe, it, expect } from "vitest";
import { forbiddenFields, restrictOwn, mergeOwnedWhole, ownInvoices, EMPLOYEE_PUT_FIELDS, SERVER_OWNED_FIELDS } from "./roles.js";
import { mergePhotoArray, mergeInvoices } from "./merge.js";
import { FIELDS } from "./store.js";

const emp = { role: "employee", id: "e1", name: "Nong" };
const admin = { role: "admin", id: "admin", name: "Boss" };

describe("forbiddenFields", () => {
  it("admin may write anything; crew only their six fields", () => {
    expect(forbiddenFields({ jobs: [], employees: [] }, admin, FIELDS)).toEqual([]);
    expect(forbiddenFields({ checkouts: [], jobs: [], employees: [], adminPin: "1" }, emp, FIELDS)).toEqual(["jobs", "employees", "adminPin"]);
    expect(forbiddenFields({ checkouts: [], invoices: [], reports: [], productionCompanies: [], adminRequests: [], equipmentRequests: [] }, emp, FIELDS)).toEqual([]);
    for (const f of EMPLOYEE_PUT_FIELDS) expect(FIELDS).toContain(f);
    for (const f of SERVER_OWNED_FIELDS) expect(FIELDS).toContain(f);
  });
});

describe("restrictOwn (crew writes inside a merged array)", () => {
  const kv = [
    { id: "c1", employeeId: "e1", qty: 1, type: "pick" },
    { id: "c2", employeeId: "e2", qty: 1, type: "pick" },
    { id: "c3", employeeId: "admin", qty: 2, type: "return" },
  ];
  it("keeps own records, restores foreign ones from KV, drops unknown foreign ones, stamps unowned ones", () => {
    const incoming = [
      { id: "c1", employeeId: "e1", qty: 1, type: "return" },     // own edit: kept
      { id: "c2", employeeId: "e2", qty: 99, type: "return" },    // foreign edit: KV copy wins
      { id: "c3", employeeId: "e1", qty: 2, type: "return" },     // foreign record re-owned: KV copy wins
      { id: "c4", employeeId: "e2", qty: 1, type: "pick" },       // foreign + unknown: dropped
      { id: "c5", qty: 1, type: "pick" },                         // unowned new: stamped e1
      null,
    ];
    const out = restrictOwn(incoming, kv, "e1", "employeeId");
    expect(out).toEqual([
      { id: "c1", employeeId: "e1", qty: 1, type: "return" },
      { id: "c2", employeeId: "e2", qty: 1, type: "pick" },
      { id: "c3", employeeId: "admin", qty: 2, type: "return" },
      { id: "c5", qty: 1, type: "pick", employeeId: "e1" },
    ]);
  });
  it("composes with mergePhotoArray without losing anyone's record or photo", () => {
    const kvArr = [
      { id: "c1", employeeId: "e1", photo: "data:x1" },
      { id: "c2", employeeId: "e2", photo: null, hasPhoto: true, photoSig: "s2" },
    ];
    const incoming = [
      { id: "c1", employeeId: "e1", photo: null, hasPhoto: true },  // lean re-save of own
      { id: "c2", employeeId: "e2", photo: null },                  // foreign lean copy
      { id: "c9", employeeId: "e1", photo: "data:new" },            // own new capture
    ];
    const merged = mergePhotoArray(restrictOwn(incoming, kvArr, "e1", "employeeId"), kvArr);
    expect(merged.find(c => c.id === "c1").photo).toBe("data:x1");
    expect(merged.find(c => c.id === "c2")).toEqual({ id: "c2", employeeId: "e2", photo: null, hasPhoto: true, photoSig: "s2" });
    expect(merged.find(c => c.id === "c9").photo).toBe("data:new");
    expect(merged.length).toBe(3);
  });
});

describe("mergeOwnedWhole (productionCompanies by crew, P2-9 rule)", () => {
  const kv = [
    { id: "p1", name: "Bangkok Pictures", address: "A" },                 // admin-added (no addedBy)
    { id: "p2", name: "Hub", address: "B", addedBy: "e2" },               // another crew's
    { id: "p3", name: "Mine", address: "C", addedBy: "e1" },              // own
    { id: "p4", name: "Mine too", address: "D", addedBy: "e1" },          // own, about to be deleted
  ];
  it("crew may add, edit and delete only what they added; everything else stays as KV has it", () => {
    const incoming = [
      { id: "p1", name: "RENAMED", address: "WRONG" },                    // tamper: ignored
      { id: "p2", name: "Hub", address: "WRONG", addedBy: "e2" },          // tamper: ignored
      { id: "p3", name: "Mine v2", address: "C2", addedBy: "e1" },         // own edit
      { id: "p5", name: "New house", address: "E" },                       // new: stamped
      // p4 missing -> deleted (own)
    ];
    const out = mergeOwnedWhole(incoming, kv, "e1", "addedBy");
    expect(out).toEqual([
      { id: "p1", name: "Bangkok Pictures", address: "A" },
      { id: "p2", name: "Hub", address: "B", addedBy: "e2" },
      { id: "p3", name: "Mine v2", address: "C2", addedBy: "e1" },
      { id: "p5", name: "New house", address: "E", addedBy: "e1" },
    ]);
  });
  it("a stale crew copy missing another crew's new house does not delete it", () => {
    const out = mergeOwnedWhole([{ id: "p3", name: "Mine", address: "C", addedBy: "e1" }], kv, "e1", "addedBy");
    expect(out.map(c => c.id).sort()).toEqual(["p1", "p2", "p3"]);
  });
});

describe("ownInvoices + mergeInvoices (crew invoices bound to the session)", () => {
  const kv = [
    { id: "i1", employeeId: "e1", status: "Pending" },
    { id: "i2", employeeId: "e2", status: "Pending" },
    { id: "i3", employeeId: "admin", status: "Paid" },
  ];
  it("forces ownership to the session and cannot touch or duplicate another's invoice", () => {
    const incoming = [
      { id: "i1", employeeId: "e1", status: "Paid" },       // own
      { id: "i2", employeeId: "e1", status: "Paid" },       // stolen id: dropped
      { id: "i3", employeeId: "admin", status: "Void" },    // foreign: dropped
      { id: "i4", status: "Pending" },                      // new, unowned: stamped
      { id: "i5", employeeId: "e9", status: "Pending" },    // claims someone else: dropped
    ];
    const own = ownInvoices(incoming, kv, "e1");
    expect(own).toEqual([{ id: "i1", employeeId: "e1", status: "Paid" }, { id: "i4", status: "Pending", employeeId: "e1" }]);
    const merged = mergeInvoices(own, kv, "e1");
    expect(merged.map(i => i.id).sort()).toEqual(["i1", "i2", "i3", "i4"]);
    expect(merged.find(i => i.id === "i2").status).toBe("Pending");
    expect(merged.find(i => i.id === "i3").status).toBe("Paid");
    expect(merged.filter(i => i.id === "i2").length).toBe(1);
  });
});
