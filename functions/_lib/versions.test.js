import { describe, it, expect } from "vitest";
import { newVersion, isStale, VERSIONED } from "./versions.js";

describe("per-field versions (P1-13)", () => {
  it("newVersion is unique-ish", () => {
    const s = new Set(Array.from({ length: 200 }, newVersion));
    expect(s.size).toBe(200);
  });
  it("stale only when the client opted in for that field and its version differs", () => {
    expect(isStale("jobs", null, "v2")).toBe(false);                 // old client, no _v
    expect(isStale("jobs", {}, "v2")).toBe(false);                   // field not in _v
    expect(isStale("jobs", { jobs: "v1" }, "v2")).toBe(true);
    expect(isStale("jobs", { jobs: "v2" }, "v2")).toBe(false);
    expect(isStale("jobs", { jobs: null }, null)).toBe(false);       // both unversioned (pre-upgrade KV)
    expect(isStale("jobs", { jobs: null }, "v1")).toBe(true);        // loaded before the first versioned write
    expect(isStale("jobs", { jobs: "v1" }, null)).toBe(true);
  });
  it("id-merged arrays are never version-checked", () => {
    for (const f of ["checkouts", "adminRequests", "equipmentRequests", "invoices"]) {
      expect(VERSIONED.has(f)).toBe(false);
      expect(isStale(f, { [f]: "old" }, "new")).toBe(false);
    }
    expect(VERSIONED.has("equipment")).toBe(true);
  });
});
