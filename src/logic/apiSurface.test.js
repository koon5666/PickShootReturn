// Regression guard for review item P2-17 (savePresets called api.put, which
// never existed, so the button always failed). Reads App.jsx as text: every
// `api.<method>(` call site must name a method defined on the `api` object.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "App.jsx"), "utf8");

function definedApiMethods(text) {
  const start = text.indexOf("const api = {");
  const end = text.indexOf("\n};", start);
  const body = text.slice(start, end);
  return new Set([...body.matchAll(/^\s{2}([A-Za-z_$][\w$]*):\s*(?:\(|async|function)/gm)].map(m => m[1]));
}

describe("api object surface", () => {
  const defined = definedApiMethods(src);
  it("finds the api object", () => {
    expect(defined.has("getData")).toBe(true);
    expect(defined.has("putData")).toBe(true);
    expect(defined.size).toBeGreaterThan(5);
  });
  it("every api.<method>( call names a defined method", () => {
    const calls = [...src.matchAll(/\bapi\.([A-Za-z_$][\w$]*)\s*\(/g)].map(m => m[1]);
    const missing = [...new Set(calls.filter(c => !defined.has(c)))];
    expect(missing).toEqual([]);
  });
  it("savePresets persists through putData", () => {
    const i = src.indexOf("const savePresets = async () => {");
    const body = src.slice(i, src.indexOf("};", i));
    expect(body).toContain("api.putData({ invoicePresets })");
    expect(body).not.toMatch(/api\.put\(/);
  });
});
