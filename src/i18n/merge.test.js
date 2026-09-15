import { describe, it, expect } from "vitest";
import { mergeTracks, diffKeys } from "./merge.js";
import { LANG as BASE } from "./base.js";

describe("mergeTracks", () => {
  it("returns a copy of base when there are no tracks", () => {
    const { LANG, overrides } = mergeTracks(BASE, []);
    expect(LANG.en).toEqual(BASE.en);
    expect(LANG.th).toEqual(BASE.th);
    expect(LANG.en).not.toBe(BASE.en);
    expect(overrides).toEqual([]);
  });

  it("adds track keys to both languages and reports overrides", () => {
    const base = { en: { a: "A", shared: "base" }, th: { a: "ก", shared: "ฐาน" } };
    const t1 = { name: "t1", dict: { en: { b: "B", shared: "t1" }, th: { b: "ข", shared: "ทีหนึ่ง" } } };
    const t2 = { name: "t2", dict: { default: { en: { c: "C" }, th: { c: "ค" } } } }; // module-shaped
    const { LANG, overrides } = mergeTracks(base, [t1, t2]);
    expect(LANG.en).toEqual({ a: "A", shared: "t1", b: "B", c: "C" });
    expect(LANG.th).toEqual({ a: "ก", shared: "ทีหนึ่ง", b: "ข", c: "ค" });
    expect(overrides).toEqual([
      { code: "en", key: "shared", track: "t1", previous: "base" },
      { code: "th", key: "shared", track: "t1", previous: "base" },
    ]);
    expect(base.en).toEqual({ a: "A", shared: "base" }); // base untouched
  });

  it("later tracks win and the override names the earlier track", () => {
    const { LANG, overrides } = mergeTracks({ en: {}, th: {} }, [
      { name: "x", dict: { en: { k: "1" }, th: { k: "๑" } } },
      { name: "y", dict: { en: { k: "2" }, th: { k: "๒" } } },
    ]);
    expect(LANG.en.k).toBe("2");
    expect(overrides.find(o => o.code === "en").previous).toBe("x");
  });
});

describe("diffKeys", () => {
  it("lists keys missing on either side", () => {
    expect(diffKeys({ en: { a: 1, b: 2 }, th: { b: 2, c: 3 } })).toEqual({ missingInTh: ["a"], missingInEn: ["c"] });
  });
  it("base dictionary is balanced", () => {
    expect(diffKeys(BASE)).toEqual({ missingInTh: [], missingInEn: [] });
  });
});
