import { describe, it, expect } from "vitest";
import { externalize, photoKeysOf, inlinePhotos, countInline, photoKey, photoSig, storedSigs, loadPhotos } from "./photos.js";

const P1 = "data:image/jpeg;base64,AAAA", P2 = "data:image/jpeg;base64,BBBB", P3 = "data:image/png;base64,CCCC";

describe("externalize / inline (photo fields)", () => {
  it("moves every inline data: URI to its own key and leaves a marker with a signature", () => {
    const arr = [{ id: "c1", photo: P1, qty: 1 }, { id: "c2", photo: null }, { id: "c3", photo: P2 }];
    const { entries, photos } = externalize("checkouts", arr);
    expect(photos).toEqual([{ key: "photo:checkouts:c1", data: P1 }, { key: "photo:checkouts:c3", data: P2 }]);
    expect(entries[0]).toEqual({ id: "c1", photo: null, hasPhoto: true, photoSig: photoSig(P1), qty: 1 });
    expect(entries[1]).toBe(arr[1]);                    // untouched reference
    expect(JSON.stringify(entries).includes("base64")).toBe(false);
  });
  it("is idempotent: an externalized array produces no writes", () => {
    const { entries } = externalize("checkouts", [{ id: "c1", photo: P1 }]);
    const again = externalize("checkouts", entries);
    expect(again.photos).toEqual([]);
    expect(again.entries).toEqual(entries);
  });
  it("skips the write when the stored signature matches (GET re-inlined, client re-saved)", () => {
    const stored = externalize("equipment", [{ id: "e1", photo: P1 }]).entries;
    const back = inlinePhotos("equipment", stored, { "photo:equipment:e1": P1 });
    expect(back[0]).toEqual({ id: "e1", photo: P1, photoSig: photoSig(P1) });
    const resave = externalize("equipment", back, Infinity, storedSigs("equipment", stored));
    expect(resave.photos).toEqual([]);
    expect(resave.entries[0].hasPhoto).toBe(true);
    // a changed photo IS written
    const changed = externalize("equipment", [{ ...back[0], photo: P2 }], Infinity, storedSigs("equipment", stored));
    expect(changed.photos).toEqual([{ key: "photo:equipment:e1", data: P2 }]);
  });
  it("honours the batch limit (migration is resumable)", () => {
    const arr = [{ id: "a", photo: P1 }, { id: "b", photo: P2 }, { id: "c", photo: P3 }];
    const pass1 = externalize("checkouts", arr, 2);
    expect(pass1.photos.length).toBe(2);
    expect(countInline("checkouts", pass1.entries)).toBe(1);
    const pass2 = externalize("checkouts", pass1.entries, 2);
    expect(pass2.photos.length).toBe(1);
    expect(countInline("checkouts", pass2.entries)).toBe(0);
    expect(photoKeysOf("checkouts", pass2.entries)).toEqual(["photo:checkouts:a", "photo:checkouts:b", "photo:checkouts:c"]);
  });
  it("re-inlines from a key map and leaves the marker when a key is missing", () => {
    const { entries } = externalize("checkouts", [{ id: "a", photo: P1 }, { id: "b", photo: P2 }]);
    const out = inlinePhotos("checkouts", entries, { "photo:checkouts:a": P1 });
    expect(out[0].photo).toBe(P1); expect(out[0].hasPhoto).toBeUndefined();
    expect(out[1]).toEqual(entries[1]);
  });
  it("ignores non-photo fields and non-arrays", () => {
    expect(externalize("jobs", [{ id: "j", photo: P1 }]).photos).toEqual([]);
    expect(externalize("checkouts", null)).toEqual({ entries: null, photos: [] });
    expect(photoKeysOf("jobs", [{ id: "j", hasPhoto: true }])).toEqual([]);
  });
});

describe("externalize / inline (reports photos[])", () => {
  it("moves each photo to an indexed key and restores the exact array", () => {
    const r = [{ id: "r1", photos: [P1, P2], description: "x" }];
    const { entries, photos } = externalize("reports", r);
    expect(photos.map(p => p.key)).toEqual(["photo:reports:r1:0", "photo:reports:r1:1"]);
    expect(entries[0].photos).toEqual([null, null]);
    expect(entries[0].hasPhotos).toBe(true);
    const blobs = Object.fromEntries(photos.map(p => [p.key, p.data]));
    const back = inlinePhotos("reports", entries, blobs);
    expect(back[0].photos).toEqual([P1, P2]);
    expect(back[0].hasPhotos).toBeUndefined();
    expect(countInline("reports", r)).toBe(2);
    expect(countInline("reports", entries)).toBe(0);
    expect(photoKey("reports", "r1", 1)).toBe("photo:reports:r1:1");
  });
});

describe("loadPhotos", () => {
  it("reads every referenced key through the getter, bounded, tolerating failures", async () => {
    const { entries } = externalize("checkouts", Array.from({ length: 40 }, (_, i) => ({ id: "c" + i, photo: P1 })));
    let inFlight = 0, max = 0, calls = 0;
    const getter = async (k) => { calls++; inFlight++; max = Math.max(max, inFlight); await new Promise(r => setTimeout(r, 1)); inFlight--; if (k.endsWith(":c7")) throw new Error("boom"); return P2; };
    const blobs = await loadPhotos("checkouts", entries, getter, 8);
    expect(calls).toBe(40); expect(max).toBeLessThanOrEqual(8);
    expect(Object.keys(blobs).length).toBe(39);
  });
});

describe("duplicate ids (real prod data has double-submitted returns)", () => {
  it("gives each duplicate its own key and restores both photos", () => {
    const arr = [{ id: "dup", ts: 1, photo: P1 }, { id: "dup", ts: 2, photo: P2 }, { id: "dup", ts: 3, photo: null }, { id: "x", photo: P3 }];
    const { entries, photos } = externalize("checkouts", arr);
    expect(photos.map(p => p.key)).toEqual(["photo:checkouts:dup", "photo:checkouts:dup#1", "photo:checkouts:x"]);
    expect(entries[0].photoKey).toBeUndefined();
    expect(entries[1].photoKey).toBe("photo:checkouts:dup#1");
    expect(photoKeysOf("checkouts", entries)).toEqual(["photo:checkouts:dup", "photo:checkouts:dup#1", "photo:checkouts:x"]);
    const blobs = Object.fromEntries(photos.map(p => [p.key, p.data]));
    const back = inlinePhotos("checkouts", entries, blobs);
    expect(back.map(e => e.photo)).toEqual([P1, P2, null, P3]);
    // a re-save of the re-inlined array reuses the same keys, no rewrite
    const again = externalize("checkouts", back, Infinity, storedSigs("checkouts", entries));
    expect(again.photos).toEqual([]);
    expect(again.entries[1].photoKey).toBe("photo:checkouts:dup#1");
  });
  it("reports with a duplicate id get a suffixed base too", () => {
    const { photos } = externalize("reports", [{ id: "r", photos: [P1] }, { id: "r", photos: [P2] }]);
    expect(photos.map(p => p.key)).toEqual(["photo:reports:r:0", "photo:reports:r#1:0"]);
  });
});
