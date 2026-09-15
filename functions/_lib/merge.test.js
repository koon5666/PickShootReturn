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
