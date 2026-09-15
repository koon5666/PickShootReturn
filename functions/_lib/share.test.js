import { describe, it, expect } from "vitest";
import { SHARE_TTL_SECONDS, isShareKey, newShareKey, newRevokeToken, makeEnvelope, parseStored, isExpired, remainingTtl, shareStatus, tokenMatches } from "./share.js";

describe("share link rules (P0-7)", () => {
  it("TTL is 72 hours", () => { expect(SHARE_TTL_SECONDS).toBe(72 * 3600); });
  it("keys are prefixed and safe", () => {
    const k = newShareKey(1700000000000, () => 0.123456789);
    expect(k.startsWith("inv_share_1700000000000_")).toBe(true);
    expect(isShareKey(k)).toBe(true);
    expect(isShareKey("adminPin")).toBe(false);
    expect(isShareKey("inv_share_../x")).toBe(false);
    expect(newRevokeToken().length).toBeGreaterThanOrEqual(16);
  });
  it("envelope carries createdAt/expiresAt/token/views", () => {
    const e = makeEnvelope({ html: "<p>x</p>", now: 1000, token: "t" });
    expect(e).toEqual({ v: 1, html: "<p>x</p>", createdAt: 1000, expiresAt: 1000 + SHARE_TTL_SECONDS * 1000, token: "t", views: 0 });
  });
  it("parseStored handles envelope and legacy raw html", () => {
    const e = makeEnvelope({ html: "<b>a</b>", now: 5, token: "t" });
    expect(parseStored(JSON.stringify(e))).toEqual(e);
    expect(parseStored("<!DOCTYPE html><html></html>")).toMatchObject({ legacy: true, html: "<!DOCTYPE html><html></html>" });
    expect(parseStored("{not json")).toMatchObject({ legacy: true });
    expect(parseStored(null)).toBeNull();
  });
  it("expiry + remaining ttl", () => {
    const e = makeEnvelope({ html: "", now: 0, token: "t", ttlSeconds: 100 });
    expect(isExpired(e, 50_000)).toBe(false);
    expect(isExpired(e, 100_000)).toBe(true);
    expect(remainingTtl(e, 40_000)).toBe(60);
    expect(remainingTtl(e, 10_000)).toBe(90);
    expect(remainingTtl({ legacy: true, html: "" }, 0)).toBe(SHARE_TTL_SECONDS);
  });
  it("shareStatus never leaks html or token", () => {
    const e = makeEnvelope({ html: "SECRET", now: 0, token: "tok" });
    const s = shareStatus(e, 1);
    expect(JSON.stringify(s)).not.toContain("SECRET");
    expect(JSON.stringify(s)).not.toContain("tok");
    expect(s).toMatchObject({ found: true, views: 0, expired: false });
    expect(shareStatus(null)).toEqual({ found: false });
  });
  it("tokenMatches requires an exact token", () => {
    const e = makeEnvelope({ html: "", now: 0, token: "abc" });
    expect(tokenMatches(e, "abc")).toBe(true);
    expect(tokenMatches(e, "abd")).toBe(false);
    expect(tokenMatches(e, "")).toBe(false);
    expect(tokenMatches({ legacy: true }, "abc")).toBe(false);
  });
});
