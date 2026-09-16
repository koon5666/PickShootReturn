import { describe, it, expect } from "vitest";
import { isDataUri, stripPhoto, mergePhotoArray, mergeById } from "./merge.js";

const PHOTO = "data:image/jpeg;base64,AAAA";
const PHOTO2 = "data:image/jpeg;base64,BBBB";

describe("stripPhoto / isDataUri", () => {
  it("strips only real data URIs and marks hasPhoto", () => {
    expect(stripPhoto({ id: "a", photo: PHOTO })).toEqual({ id: "a", photo: null, hasPhoto: true });
    expect(stripPhoto({ id: "a", photo: null })).toEqual({ id: "a", photo: null });
    expect(stripPhoto(null)).toBe(null);
    expect(isDataUri("http://x")).toBe(false);
  });
});

describe("mergePhotoArray (checkouts / adminRequests)", () => {
  it("restores the KV photo when the incoming copy was loaded lean", () => {
    const kv = [{ id: "c1", type: "pick", photo: PHOTO }];
    const incoming = [{ id: "c1", type: "pick", photo: null, hasPhoto: true }];
    expect(mergePhotoArray(incoming, kv)).toEqual([{ id: "c1", type: "pick", photo: PHOTO }]);
  });
  it("a real incoming data URI always wins (re-shot photo)", () => {
    const kv = [{ id: "c1", photo: PHOTO }];
    expect(mergePhotoArray([{ id: "c1", photo: PHOTO2 }], kv)[0].photo).toBe(PHOTO2);
  });
  it("keeps KV-only entries added by another session, appended after incoming", () => {
    const kv = [{ id: "c1", photo: PHOTO }, { id: "c2", photo: PHOTO2 }];
    const out = mergePhotoArray([{ id: "c1", photo: null, hasPhoto: true }], kv);
    expect(out.map(e => e.id)).toEqual(["c1", "c2"]);
    expect(out[1]).toBe(kv[1]); // untouched reference
  });
  it("never persists the transient hasPhoto marker", () => {
    const out = mergePhotoArray([{ id: "n1", photo: PHOTO, hasPhoto: true }], []);
    expect(out[0]).toEqual({ id: "n1", photo: PHOTO });
    expect("hasPhoto" in out[0]).toBe(false);
  });
  it("new entry without a photo persists photo:null; incoming field edits win", () => {
    const kv = [{ id: "c1", photo: PHOTO, qty: 1, note: "old" }];
    const out = mergePhotoArray([{ id: "c1", qty: 2, note: "new" }, { id: "c9", qty: 1 }], kv);
    expect(out[0]).toEqual({ id: "c1", qty: 2, note: "new", photo: PHOTO });
    expect(out[1]).toEqual({ id: "c9", qty: 1, photo: null });
  });
  it("tolerates a missing KV array", () => {
    expect(mergePhotoArray([{ id: "a" }], undefined)).toEqual([{ id: "a", photo: null }]);
  });
  it("loses no record and no photo across a lean round-trip of a large set", () => {
    const kv = Array.from({ length: 50 }, (_, i) => ({ id: "c" + i, photo: i % 2 ? PHOTO : null, i }));
    const lean = kv.slice(0, 30).map(stripPhoto);            // client loaded lean, stale by 20 entries
    const out = mergePhotoArray([...lean, { id: "new", i: 99 }], kv);
    expect(out).toHaveLength(51);
    for (const e of kv) expect(out.find(o => o.id === e.id).photo).toBe(e.photo);
    expect(out.some(o => "hasPhoto" in o)).toBe(false);
  });
});

describe("mergeById (equipmentRequests)", () => {
  it("incoming wins for shared ids, KV-only ids are preserved after incoming", () => {
    const kv = [{ id: "r1", status: "pending" }, { id: "r2", status: "pending" }];
    const out = mergeById([{ id: "r1", status: "approved" }, { id: "r3", status: "pending" }], kv);
    expect(out).toEqual([{ id: "r1", status: "approved" }, { id: "r3", status: "pending" }, { id: "r2", status: "pending" }]);
  });
  it("empty incoming keeps everything in KV; missing KV is fine", () => {
    expect(mergeById([], [{ id: "r1" }])).toEqual([{ id: "r1" }]);
    expect(mergeById([{ id: "r1" }], undefined)).toEqual([{ id: "r1" }]);
  });
});

// ── P0-5 tombstones ──────────────────────────────────────────────────────────
import { mergeInvoices, tombstoneOf, withoutTombstones, isTombstone } from "./merge.js";

describe("tombstones (P0-5) are honoured by every merge", () => {
  const dead = { id: "r1", employeeName: "Nong", _deleted: true, deletedAt: "2026-09-16T00:00:00Z" };
  it("mergeById: a KV tombstone beats a stale live copy; an incoming tombstone beats a live KV copy", () => {
    expect(mergeById([{ id: "r1", status: "pending" }], [dead])).toEqual([dead]);
    const out = mergeById([{ id: "r1", status: "pending", _deleted: true }], [{ id: "r1", status: "pending" }]);
    expect(isTombstone(out[0])).toBe(true); expect(out[0].deletedAt).toBeTruthy();
  });
  it("mergeById: a tombstone that is KV-only survives a re-save that omits it", () => {
    expect(mergeById([{ id: "r2" }], [dead])).toEqual([{ id: "r2" }, dead]);
  });
  it("mergePhotoArray: same rules, and the tombstone carries no photo", () => {
    const kv = [{ id: "c1", photo: PHOTO }];
    const out = mergePhotoArray([{ id: "c1", photo: PHOTO, _deleted: true }], kv);
    expect(out[0]._deleted).toBe(true); expect("photo" in out[0]).toBe(false);
    expect(mergePhotoArray([{ id: "c1", photo: null, hasPhoto: true }], out)).toEqual(out);
  });
  it("mergePhotoArray keeps the externalized marker (+ signature) when the incoming copy is lean", () => {
    const kv = [{ id: "c1", photo: null, hasPhoto: true, photoSig: "x:y", qty: 1 }];
    expect(mergePhotoArray([{ id: "c1", photo: null, hasPhoto: true, qty: 2 }], kv)).toEqual([{ id: "c1", photo: null, hasPhoto: true, photoSig: "x:y", qty: 2 }]);
    // a new capture replaces it
    expect(mergePhotoArray([{ id: "c1", photo: PHOTO2, qty: 2 }], kv)).toEqual([{ id: "c1", photo: PHOTO2, qty: 2 }]);
  });
  it("mergeInvoices: admin append-merge, employee ownership, write-once fields, tombstones", () => {
    const kv = [
      { id: "i1", employeeId: "e1", paidDate: "2026-01-01", status: "Paid" },
      { id: "i2", employeeId: "e2" },
      { id: "i3", employeeId: "e1", _deleted: true, deletedAt: "x" },
    ];
    // employee e1 re-saves a stale copy of i1 without paidDate and a live i3
    const e1 = mergeInvoices([{ id: "i1", employeeId: "e1", status: "Pending" }, { id: "i3", employeeId: "e1" }], kv, "e1");
    expect(e1.find(i => i.id === "i1").paidDate).toBe("2026-01-01");
    expect(e1.find(i => i.id === "i3")._deleted).toBe(true);
    expect(e1.find(i => i.id === "i2")).toBe(kv[1]);
    // admin: KV-only kept, incoming wins for shared ids
    const adm = mergeInvoices([{ id: "i2", employeeId: "e2", status: "Paid" }], kv, "admin");
    expect(adm.map(i => i.id)).toEqual(["i2", "i1", "i3"]);
    expect(adm[0].status).toBe("Paid"); expect(adm[0].paidDate).toBe(null);
  });
  it("withoutTombstones strips them for the client; tombstoneOf keeps identity, drops photos", () => {
    expect(withoutTombstones([{ id: 1 }, dead, null])).toEqual([{ id: 1 }, null]);
    expect(tombstoneOf({ id: "c", eqName: "FX6", photo: PHOTO, photos: [PHOTO] }, "T")).toEqual({ id: "c", eqName: "FX6", _deleted: true, deletedAt: "T" });
  });
});

describe("clear-history watermark (clearedAt)", () => {
  it("drops records a stale device still holds from before the clear, keeps new captures", () => {
    const clearedAt = 1_000_000;
    const kv = [{ id: "keep", ts: clearedAt + 5, photo: null }];
    const incoming = [
      { id: "old1", ts: clearedAt - 10, photo: null },          // cleared, resurrect attempt
      { id: "keep", ts: clearedAt + 5, photo: null },           // already in KV
      { id: "new1", ts: clearedAt + 50, photo: PHOTO },         // new capture after the clear
      { id: "nots", photo: null },                              // no ts: cannot judge, kept
    ];
    const out = mergePhotoArray(incoming, kv, { clearedAt });
    expect(out.map(e => e.id)).toEqual(["keep", "new1", "nots"]);
    // without a watermark nothing is dropped (old behaviour)
    expect(mergePhotoArray(incoming, kv).map(e => e.id)).toEqual(["old1", "keep", "new1", "nots"]);
  });
});

describe("mergeInvoices: paidDate is stale-safe, not frozen", () => {
  it("a stale copy without paidDate keeps KV's date; an undone-then-repaid invoice takes the new date", () => {
    const kv = [{ id: "i1", employeeId: "admin", status: "Paid", paidDate: "2026-09-10" }];
    const stale = mergeInvoices([{ id: "i1", employeeId: "admin", status: "Paid" }], kv, "admin");
    expect(stale[0].paidDate).toBe("2026-09-10");
    const undone = mergeInvoices([{ id: "i1", employeeId: "admin", status: "Pending", paidVoid: { reason: "bounced", paidDate: "2026-09-10" } }], kv, "admin");
    expect(undone[0].status).toBe("Pending");
    const repaid = mergeInvoices([{ id: "i1", employeeId: "admin", status: "Paid", paidDate: "2026-09-16" }], undone, "admin");
    expect(repaid[0].paidDate).toBe("2026-09-16");
  });
});

describe("restore watermark (restoredAt) on the id-merged arrays", () => {
  const restoredAt = 2_000_000;
  it("mergeById / mergeInvoices drop records a stale device re-saves from before the restore, keep newer and known ones", () => {
    const kv = [{ id: "r_keep", requestedAt: restoredAt - 500 }];
    const incoming = [
      { id: "r_keep", requestedAt: restoredAt - 500, status: "approved" },   // known to KV: an edit, kept
      { id: "r_old", requestedAt: restoredAt - 10 },                          // removed by the restore: stays gone
      { id: "r_new", requestedAt: restoredAt + 10 },                          // made after the restore: kept
    ];
    expect(mergeById(incoming, kv, { restoredAt }).map(e => e.id)).toEqual(["r_keep", "r_new"]);
    const kvInv = [{ id: "i_keep", employeeId: "admin", createdAt: restoredAt - 900 }];
    const inc = [{ id: "i_keep", employeeId: "admin", createdAt: restoredAt - 900, status: "Paid" }, { id: "i_old", employeeId: "admin", createdAt: restoredAt - 1 }, { id: "i_new", employeeId: "admin", createdAt: restoredAt + 1 }];
    expect(mergeInvoices(inc, kvInv, "admin", { restoredAt }).map(e => e.id)).toEqual(["i_keep", "i_new"]);
    // adminRequests carry an ISO submittedAt
    const iso = (t) => new Date(t).toISOString();
    const reqs = [{ id: "a_old", submittedAt: iso(restoredAt - 5), photo: null }, { id: "a_new", submittedAt: iso(restoredAt + 5), photo: null }];
    expect(mergePhotoArray(reqs, [], { restoredAt }).map(e => e.id)).toEqual(["a_new"]);
  });
});
