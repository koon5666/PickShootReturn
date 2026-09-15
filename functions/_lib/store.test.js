import { describe, it, expect } from "vitest";
import { fakeKV } from "../../tests/fakekv.js";
import { readField, readAllFields, inlineField, getPhoto, prepareWrite, commitWrites, writeField, migrateField, deletePhotoPrefix, FIELDS } from "./store.js";
import { countInline } from "./photos.js";
import { MAX_VALUE_BYTES } from "./kvlimits.js";

const P = (i) => "data:image/jpeg;base64," + "Q".repeat(2000) + i;

describe("store: write externalizes, read re-inlines, versions in metadata", () => {
  it("writeField moves photos to keys and stamps a version", async () => {
    const kv = fakeKV();
    const v = await writeField(kv, "checkouts", [{ id: "c1", photo: P(1) }, { id: "c2", photo: null }]);
    expect(kv.json("checkouts")).toEqual([{ id: "c1", photo: null, hasPhoto: true, photoSig: expect.any(String) }, { id: "c2", photo: null }]);
    expect(kv.raw("photo:checkouts:c1")).toBe(P(1));
    expect(kv.metaOf("checkouts")).toEqual({ v });
    const r = await readField(kv, "checkouts");
    expect(r.v).toBe(v);
    expect(await getPhoto(kv, "checkouts", "c1")).toBe(P(1));
    expect(await getPhoto(kv, "checkouts", "c2")).toBe(null);
  });
  it("getPhoto falls back to an unmigrated inline photo", async () => {
    const kv = fakeKV({ checkouts: [{ id: "c1", photo: P(9) }] });
    expect(await getPhoto(kv, "checkouts", "c1")).toBe(P(9));
  });
  it("inlineField puts equipment / report photos back for the boot payload", async () => {
    const kv = fakeKV();
    await writeField(kv, "equipment", [{ id: "e1", photo: P(1), name: "FX6" }, { id: "e2", photo: null }]);
    await writeField(kv, "reports", [{ id: "r1", photos: [P(2), P(3)] }]);
    const eq = await inlineField(kv, "equipment", (await readField(kv, "equipment")).value);
    expect(eq[0].photo).toBe(P(1)); expect(eq[0].hasPhoto).toBeUndefined(); expect(eq[1].photo).toBe(null);
    const rep = await inlineField(kv, "reports", (await readField(kv, "reports")).value);
    expect(rep[0].photos).toEqual([P(2), P(3)]);
    // filter: only pending admin requests are inlined
    await writeField(kv, "adminRequests", [{ id: "a1", status: "pending", photo: P(4) }, { id: "a2", status: "approved", photo: P(5) }]);
    const ar = await inlineField(kv, "adminRequests", (await readField(kv, "adminRequests")).value, r => r.status === "pending");
    expect(ar[0].photo).toBe(P(4)); expect(ar[1].photo).toBe(null); expect(ar[1].hasPhoto).toBe(true);
  });
  it("a re-save of GET-inlined equipment does not rewrite unchanged photo keys", async () => {
    const kv = fakeKV();
    await writeField(kv, "equipment", [{ id: "e1", photo: P(1) }, { id: "e2", photo: P(2) }]);
    const existing = (await readField(kv, "equipment")).value;
    const inlined = await inlineField(kv, "equipment", existing);
    const edited = inlined.map(e => e.id === "e2" ? { ...e, photo: P(7), name: "new" } : { ...e, name: "same" });
    const p = prepareWrite("equipment", edited, existing);
    expect(p.photos.map(x => x.key)).toEqual(["photo:equipment:e2"]);
    const before = kv.writes;
    await commitWrites(kv, [p]);
    expect(kv.writes - before).toBe(2); // one photo + the array
    expect(kv.raw("photo:equipment:e1")).toBe(P(1)); expect(kv.raw("photo:equipment:e2")).toBe(P(7));
  });
  it("readAllFields returns every FIELD with its version (null when unversioned)", async () => {
    const kv = fakeKV({ jobs: [{ id: "j" }] });
    await writeField(kv, "equipment", []);
    const { values, versions } = await readAllFields(kv);
    expect(Object.keys(values)).toEqual(FIELDS);
    expect(values.jobs).toEqual([{ id: "j" }]); expect(versions.jobs).toBe(null);
    expect(typeof versions.equipment).toBe("string");
  });
  it("refuses a value over the limit with a readable error and writes nothing", async () => {
    const kv = fakeKV();
    const big = [{ id: "x", note: "n".repeat(MAX_VALUE_BYTES + 10) }];
    await expect(writeField(kv, "jobs", big)).rejects.toMatchObject({ size: { field: "jobs" } });
    expect(kv.keys()).toEqual([]);
    const p = prepareWrite("jobs", big);
    expect(p.size.error).toMatch(/jobs.*over the 20.0 MiB/);
  });
});

describe("store: migration is batched, idempotent, resumable and keeps the version", () => {
  it("moves every inline photo across calls and never loses a record", async () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({ id: "c" + i, photo: i % 2 ? P(i) : null, qty: i }));
    const kv = fakeKV({ checkouts: rows, reports: [{ id: "r1", photos: [P(20), P(21)] }] });
    await kv.put("checkouts", JSON.stringify(rows), { metadata: { v: "v0" } });
    const r1 = await migrateField(kv, "checkouts", 2);
    expect(r1).toMatchObject({ moved: 2, remaining: 1, records: 7 });
    expect(kv.metaOf("checkouts")).toEqual({ v: "v0" });
    const r2 = await migrateField(kv, "checkouts", 2);
    expect(r2).toMatchObject({ moved: 1, remaining: 0 });
    const r3 = await migrateField(kv, "checkouts", 2);
    expect(r3).toMatchObject({ moved: 0, remaining: 0 });
    const stored = kv.json("checkouts");
    expect(stored.map(e => e.id)).toEqual(rows.map(e => e.id));
    for (const row of rows) expect(await getPhoto(kv, "checkouts", row.id)).toBe(row.photo);
    expect(countInline("checkouts", stored)).toBe(0);
    expect(JSON.stringify(stored).length).toBeLessThan(JSON.stringify(rows).length / 2);
    const rr = await migrateField(kv, "reports", 20);
    expect(rr).toMatchObject({ moved: 2, remaining: 0 });
    expect(kv.raw("photo:reports:r1:1")).toBe(P(21));
    expect(await deletePhotoPrefix(kv, "checkouts")).toBe(3);
    expect(kv.keys().filter(k => k.startsWith("photo:checkouts:"))).toEqual([]);
  });
});
