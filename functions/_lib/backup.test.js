import { describe, it, expect } from "vitest";
import { fakeKV } from "../../tests/fakekv.js";
import { createBackup, listBackups, getBackup, restoreBackup, pruneBackups, RETENTION } from "./backup.js";
import { writeField, readField, getPhoto, readAllFields } from "./store.js";

const P = (i) => "data:image/jpeg;base64," + "Z".repeat(40) + i;

async function seed(kv) {
  await writeField(kv, "equipment", [{ id: "e1", name: "FX6", photo: P(1) }]);
  await writeField(kv, "checkouts", [{ id: "c1", photo: P(2) }, { id: "c2", photo: null }]);
  await writeField(kv, "jobs", [{ id: "j1", name: "TVC" }]);
  await writeField(kv, "companyName", "Lucky");
  await kv.put("profile_e1", JSON.stringify({ firstName: "Nong", idCard: P(3) }));
}

describe("backup versions (P2-7)", () => {
  it("creates a dated version whose photos are content-addressed and shared", async () => {
    const kv = fakeKV(); await seed(kv);
    const a = await createBackup(kv, { kind: "manual", label: "first" });
    expect(a.kind).toBe("manual"); expect(a.photoCount).toBe(2); expect(a.profileCount).toBe(1);
    expect(a.counts).toMatchObject({ equipment: 1, checkouts: 2, jobs: 1 });
    const blobsAfterA = kv.keys().filter(k => k.startsWith("bakblob:")).length;
    expect(blobsAfterA).toBe(3); // 2 photos + 1 profile
    await new Promise(r => setTimeout(r, 2));
    const b = await createBackup(kv, { kind: "manual", label: "second" });
    expect(kv.keys().filter(k => k.startsWith("bakblob:")).length).toBe(3); // nothing duplicated
    const list = await listBackups(kv);
    expect(list.map(x => x.id)).toEqual([b.id, a.id]);
    expect(list[0].label).toBe("second");
    expect(list[0].photos).toBeUndefined(); // internal maps are not listed
  });
  it("backs up an UNMIGRATED dataset in the small form and a download re-inlines photos", async () => {
    const kv = fakeKV({ checkouts: [{ id: "c1", photo: P(5) }], reports: [{ id: "r1", photos: [P(6)] }] });
    const m = await createBackup(kv, { kind: "auto" });
    expect(kv.raw(`bak:${m.id}:f:checkouts`).includes("base64")).toBe(false);
    const snap = await getBackup(kv, m.id);
    expect(snap.checkouts[0].photo).toBe(P(5));
    expect(snap.reports[0].photos).toEqual([P(6)]);
    expect(snap._profiles).toEqual({});
    expect(snap.savedAt).toBe(m.savedAt);
  });
  it("restore is whole-value (removes records), brings photos + profiles back, bumps versions, snapshots first", async () => {
    const kv = fakeKV(); await seed(kv);
    const bk = await createBackup(kv, { kind: "manual" });
    const v0 = (await readField(kv, "jobs")).v;
    // live data drifts: a job is added, a checkout photo re-shot, a checkout added, equipment photo removed
    await writeField(kv, "jobs", [{ id: "j1", name: "TVC" }, { id: "j2", name: "extra" }]);
    await writeField(kv, "checkouts", [{ id: "c1", photo: P(9) }, { id: "c2", photo: null }, { id: "c3", photo: P(8) }]);
    await writeField(kv, "equipment", [{ id: "e1", name: "FX6", photo: null }]);
    await kv.put("profile_e1", JSON.stringify({ firstName: "Changed" }));
    const res = await restoreBackup(kv, bk.id);
    expect(res.ok).toBe(true);
    expect(res.safetyId).toMatch(/^safety_/);
    expect((await readField(kv, "jobs")).value).toEqual([{ id: "j1", name: "TVC" }]);   // j2 removed
    expect((await readField(kv, "jobs")).v).not.toBe(v0);                                // version bumped
    expect(await getPhoto(kv, "checkouts", "c1")).toBe(P(2));                             // photo back
    expect(await getPhoto(kv, "checkouts", "c3")).toBe(null);                             // orphan photo dropped
    expect(res.orphanPhotosRemoved).toBe(1);
    expect(kv.json("profile_e1")).toEqual({ firstName: "Nong", idCard: P(3) });
    expect((await readField(kv, "equipment")).value[0].hasPhoto).toBe(true);
    // the safety snapshot holds the pre-restore state and is itself restorable
    const safety = await getBackup(kv, res.safetyId);
    expect(safety.jobs.map(j => j.id)).toEqual(["j1", "j2"]);
    expect(safety.checkouts.find(c => c.id === "c3").photo).toBe(P(8));
    const back = await restoreBackup(kv, res.safetyId, { safety: false });
    expect(back.ok).toBe(true);
    expect((await readField(kv, "jobs")).value.map(j => j.id)).toEqual(["j1", "j2"]);
    expect(await getPhoto(kv, "checkouts", "c3")).toBe(P(8));
  });
  it("prunes beyond retention per kind and garbage-collects unreferenced blobs", async () => {
    const kv = fakeKV(); await seed(kv);
    const ids = [];
    for (let i = 0; i < RETENTION.manual + 2; i++) {
      await writeField(kv, "checkouts", [{ id: "c" + i, photo: P(100 + i) }]); // each version has a unique photo
      ids.push((await createBackup(kv, { kind: "manual" })).id);
      await new Promise(r => setTimeout(r, 2));
    }
    const list = await listBackups(kv);
    expect(list.filter(b => b.kind === "manual").length).toBe(RETENTION.manual);
    expect(list.map(b => b.id)).toEqual(ids.slice(-RETENTION.manual).reverse());
    expect(kv.keys().some(k => k.startsWith(`bak:${ids[0]}:`))).toBe(false);
    // blobs: 5 unique checkout photos + equipment photo + profile = 7
    expect(kv.keys().filter(k => k.startsWith("bakblob:")).length).toBe(RETENTION.manual + 2);
    const again = await pruneBackups(kv);
    expect(again).toMatchObject({ removed: [], blobsFreed: 0, kept: RETENTION.manual });
  });
  it("legacy single-slot backups are listed and restorable (inline photos get externalized)", async () => {
    const kv = fakeKV({
      "bak_man:meta": { savedAt: 1700000000000, fields: ["jobs", "checkouts"], profileKeys: [] },
      "bak_man:f:jobs": [{ id: "old" }],
      "bak_man:f:checkouts": [{ id: "c1", photo: P(1) }],
      "bak_man:profiles": {},
      jobs: [{ id: "live" }],
    });
    const list = await listBackups(kv);
    expect(list[0]).toMatchObject({ id: "legacy:bak_man", kind: "manual", legacy: true });
    const res = await restoreBackup(kv, "legacy:bak_man");
    expect(res.ok).toBe(true);
    expect((await readField(kv, "jobs")).value).toEqual([{ id: "old" }]);
    expect(await getPhoto(kv, "checkouts", "c1")).toBe(P(1));
    expect(kv.raw("checkouts").includes("base64")).toBe(false);
    expect((await readAllFields(kv)).values.jobs).toEqual([{ id: "old" }]);
    expect(await restoreBackup(kv, "nope")).toMatchObject({ ok: false });
  });
});
