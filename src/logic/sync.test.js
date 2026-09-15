import { describe, it, expect } from "vitest";
import { rebase, rebasePayload, versionsFor, VERSIONED_FIELDS } from "./sync.js";

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
