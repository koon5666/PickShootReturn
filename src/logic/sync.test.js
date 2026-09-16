import { describe, it, expect } from "vitest";
import { rebase, rebasePayload, versionsFor, VERSIONED_FIELDS, pendingSave, adoptRemote } from "./sync.js";
import { isStale } from "../../functions/_lib/versions.js";

describe("rebase (three-way, per field)", () => {
  const base = [{ id: "a", n: 1 }, { id: "b", n: 1 }, { id: "c", n: 1 }];
  it("keeps the other device's edits to records this client did not touch", () => {
    const local = [{ id: "a", n: 1 }, { id: "b", n: 1 }, { id: "c", n: 1 }];
    const server = [{ id: "a", n: 9 }, { id: "b", n: 1 }, { id: "c", n: 1 }];
    expect(rebase(base, local, server)).toEqual(server);
  });
  it("re-applies local edits and additions, drops local deletions", () => {
    const local = [{ id: "a", n: 1 }, { id: "b", n: 2 }, { id: "d", n: 1 }];        // b edited, c deleted, d added
    const server = [{ id: "a", n: 9 }, { id: "b", n: 1 }, { id: "c", n: 1 }, { id: "e", n: 1 }]; // a edited, e added elsewhere
    expect(rebase(base, local, server)).toEqual([{ id: "a", n: 9 }, { id: "b", n: 2 }, { id: "e", n: 1 }, { id: "d", n: 1 }]);
  });
  it("a record both sides edited: this client's edit wins (it is the one retrying)", () => {
    expect(rebase(base, [{ id: "a", n: 2 }, base[1], base[2]], [{ id: "a", n: 3 }, base[1], base[2]])[0]).toEqual({ id: "a", n: 2 });
  });
  it("a record the server removed: comes back only if this client edited it", () => {
    expect(rebase(base, [base[0], { id: "b", n: 5 }, base[2]], [base[0]])).toEqual([base[0], { id: "b", n: 5 }]);
    expect(rebase(base, base, [base[0]])).toEqual([base[0]]);
  });
  it("no base (field was never loaded): local wins", () => {
    expect(rebase(undefined, [{ id: "x" }], [{ id: "y" }])).toEqual([{ id: "y" }, { id: "x" }]);
    expect(rebase(undefined, "Lucky", "Other")).toBe("Lucky");
  });
  it("scalars / objects / id-less arrays: local wins only if it changed", () => {
    expect(rebase("A", "A", "B")).toBe("B");
    expect(rebase("A", "C", "B")).toBe("C");
    expect(rebase({ mode: "photo" }, { mode: "photo" }, { mode: "none" })).toEqual({ mode: "none" });
    expect(rebase({ mode: "photo" }, { mode: "both" }, { mode: "none" })).toEqual({ mode: "both" });
    expect(rebase(["a", "b"], ["b", "a"], ["a", "b", "c"])).toEqual(["b", "a"]);
  });
  it("an empty server array with local records keeps the local additions", () => {
    expect(rebase([], [{ id: "n" }], [])).toEqual([{ id: "n" }]);
  });
});

describe("rebasePayload + versionsFor", () => {
  it("only versioned fields carry a version; unknown versions are sent as null", () => {
    expect(versionsFor({ jobs: [], checkouts: [], companyName: "x" }, { jobs: "v1" })).toEqual({ jobs: "v1", companyName: null });
    expect(VERSIONED_FIELDS).not.toContain("checkouts");
  });
  it("rebases just the conflicting fields and stamps fresh versions", () => {
    const payload = { jobs: [{ id: "j1", name: "mine" }, { id: "j2", name: "new" }], companyName: "Lucky", _v: { jobs: "old", companyName: "c0" } };
    const bases = { jobs: [{ id: "j1", name: "orig" }], companyName: "Lucky" };
    const server = { jobs: [{ id: "j1", name: "orig" }, { id: "j9", name: "theirs" }], companyName: "Lucky", _v: { jobs: "v2", companyName: "c0" } };
    const { payload: next, merged } = rebasePayload(payload, bases, server, ["jobs"]);
    expect(merged.jobs.map(j => j.name)).toEqual(["mine", "theirs", "new"]);
    expect(next.jobs).toBe(merged.jobs);
    expect(next.companyName).toBe("Lucky");
    expect(next._v).toEqual({ jobs: "v2", companyName: "c0" });
  });
});

describe("failed-save retry after a cross-device sync (data-safety finding)", () => {
  const j1 = { id: "j1", name: "Toyota" };
  const jA = { id: "jA", name: "A's new job" };
  const jB = { id: "jB", name: "B's new job" };
  it("pending payload older than the refreshed versions: the retry still 409s and rebases onto B's write", () => {
    // Device A: loaded jobs [j1] at version v3, adds jA, PUT fails on the network.
    const lastSaved = { jobs: [j1] };
    const versions = { jobs: "v3" };
    const payload = { jobs: [j1, jA] };
    const pending = pendingSave(payload, versions, lastSaved);
    expect(pending.versions).toEqual({ jobs: "v3" });
    expect(pending.bases.jobs).toBe(lastSaved.jobs);
    // Device B writes jobs [j1, jB] -> KV version v4; A re-GETs it (WS data_saved)
    // and its versionsRef / lastSavedRef now say v4 / [j1, jB].
    const kvJobs = [j1, jB];
    versions.jobs = "v4"; lastSaved.jobs = kvJobs;
    // OLD behaviour: retry built from the refreshed refs passes the stale check and
    // overwrites B's job with A's stale list.
    expect(isStale("jobs", versionsFor(payload, versions), "v4")).toBe(false);
    // NEW: the retry carries the attempt's versions -> the server answers 409 ...
    expect(isStale("jobs", pending.versions, "v4")).toBe(true);
    // ... and the client rebases with the attempt's bases: both new jobs survive.
    const { payload: retry, merged } = rebasePayload({ ...pending.payload, _v: pending.versions }, pending.bases, { jobs: kvJobs, _v: { jobs: "v4" } }, ["jobs"]);
    expect(merged.jobs.map(j => j.id)).toEqual(["j1", "jB", "jA"]);
    expect(retry._v).toEqual({ jobs: "v4" });
  });
  it("adoptRemote keeps unsaved local edits on top of a remote snapshot instead of clobbering them", () => {
    const base = [j1];
    const local = [j1, jA];          // A's unsaved addition
    const server = [j1, jB];         // B's snapshot arriving over the wire
    expect(adoptRemote({ base, local, server }).map(j => j.id)).toEqual(["j1", "jB", "jA"]);
    // clean field (state ref === base) takes the server copy as-is
    expect(adoptRemote({ base, local: base, server })).toBe(server);
    // never loaded before (no base): server copy
    expect(adoptRemote({ base: undefined, local, server })).toBe(server);
    // dirty but the rebase adds nothing new: the server copy itself (field reads clean)
    expect(adoptRemote({ base, local: [j1, jB], server })).toBe(server);
    // scalars: a changed local value survives, an unchanged one takes the server value
    expect(adoptRemote({ base: "Lucky", local: "Lucky Cam", server: "Lucky Cam Rental" })).toBe("Lucky Cam");
    expect(adoptRemote({ base: "Lucky", local: "Lucky", server: "Lucky Cam Rental" })).toBe("Lucky Cam Rental");
  });
  it("an unsaved checkout event survives a remote snapshot (id-merged arrays too)", () => {
    const base = [{ id: "c1", type: "pick" }];
    const local = [{ id: "c1", type: "pick" }, { id: "c2", type: "return" }];
    const server = [{ id: "c1", type: "pick" }, { id: "c9", type: "pick" }];
    expect(adoptRemote({ base, local, server }).map(c => c.id)).toEqual(["c1", "c9", "c2"]);
  });
});
