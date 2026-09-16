import { describe, it, expect } from "vitest";
import { forbiddenFields, restrictOwn, mergeOwnedWhole, ownInvoices, EMPLOYEE_PUT_FIELDS, SERVER_OWNED_FIELDS, COMPANY_FILLABLE, fillEmpty } from "./roles.js";
import { mergePhotoArray, mergeInvoices, mergeById } from "./merge.js";
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

describe("reports by crew (restrictOwn + mergeById, as data.js applies it): the report belongs to who filed it", () => {
  const kv = [
    { id: "r_nong", employeeId: "e1", eqId: "eq1", description: "scratched", status: "open", ts: 1 },
    { id: "r_arthit", employeeId: "e2", eqId: "eq2", description: "cracked", status: "open", ts: 2 },
    { id: "r_admin", employeeId: "admin", eqId: "eq3", description: "house note", status: "solved", ts: 3 },
  ];
  it("a crew PUT that rewrites another crew's report or omits it leaves that report intact", () => {
    const tampered = [
      { id: "r_arthit", employeeId: "e2", eqId: "eq2", description: "TAMPERED BY NONG", status: "discarded", ts: 2 },
      { id: "r_admin", employeeId: "e1", eqId: "eq3", description: "stolen", status: "open", ts: 3 },
      { id: "r_new", eqId: "eq1", description: "new from Nong", status: "open", ts: 4 },
    ];
    const out = mergeById(restrictOwn(tampered, kv, "e1", "employeeId"), kv);
    expect(out.find(r => r.id === "r_arthit")).toEqual(kv[1]);
    expect(out.find(r => r.id === "r_admin")).toEqual(kv[2]);
    expect(out.find(r => r.id === "r_new")).toEqual({ ...tampered[2], employeeId: "e1" });
    // r_nong was omitted (a stale phone): crew never deletes a report, so it stays
    expect(out.map(r => r.id).sort()).toEqual(["r_admin", "r_arthit", "r_new", "r_nong"]);
  });
  it("an empty crew PUT (reports=[]) cannot wipe the field", () => {
    const out = mergeById(restrictOwn([], kv, "e1", "employeeId"), kv);
    expect(out.map(r => r.id).sort()).toEqual(["r_admin", "r_arthit", "r_nong"]);
  });
});

describe("crew may fill in EMPTY billing fields of a house-registered company (never overwrite)", () => {
  const kv = [
    { id: "p1", name: "Bangkok Pictures", address: "" },                         // auto-registered from a booking, no address
    { id: "p2", name: "Hub", address: "12 Sukhumvit", taxId: "0105", addedBy: "e2" },
  ];
  it("fills address / taxId / branch when KV has them blank; keeps name and any existing value", () => {
    const incoming = [
      { id: "p1", name: "RENAMED", address: " 99 Rama IV ", taxId: "0105551234567", branch: "HQ" },
      { id: "p2", name: "Hub", address: "WRONG", taxId: "WRONG", branch: "00000", addedBy: "e2" },
    ];
    const out = mergeOwnedWhole(incoming, kv, "e1", "addedBy", { fillable: COMPANY_FILLABLE });
    expect(out.find(c => c.id === "p1")).toEqual({ id: "p1", name: "Bangkok Pictures", address: "99 Rama IV", taxId: "0105551234567", branch: "HQ" });
    expect(out.find(c => c.id === "p2")).toEqual({ id: "p2", name: "Hub", address: "12 Sukhumvit", taxId: "0105", branch: "00000", addedBy: "e2" });
  });
  it("fillEmpty returns the same object when nothing is fillable", () => {
    const prev = { id: "x", address: "A" };
    expect(fillEmpty(prev, { address: "B" }, ["address"])).toBe(prev);
    expect(fillEmpty(prev, { address: "" }, ["address"])).toBe(prev);
  });
});
