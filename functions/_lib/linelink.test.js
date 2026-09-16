import { describe, it, expect } from "vitest";
import { newLinkCode, parseLinkCode, issueLinkCode, applyLinkCode, unlinkEmployee, linkStatus, resolveLineUserIds, LINK_CODE_TTL_MS } from "./linelink.js";

const emps = [{ id: "e1", name: "Nong" }, { id: "e2", name: "Arthit", lineUserId: "Uold" }];

describe("LINE link codes (P3-6)", () => {
  it("codes are 6 unambiguous chars and parse out of a chat message", () => {
    const code = newLinkCode(() => 0.42);
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(parseLinkCode("link abc234")).toBe("ABC234");
    expect(parseLinkCode("LINK-ABC234 please")).toBe("ABC234");
    expect(parseLinkCode("hello")).toBeNull();
    expect(parseLinkCode("ABC10I")).toBeNull(); // ambiguous chars are never issued
  });
  it("issue -> apply pairs the userId, moves a userId that belonged to someone else, clears the code", () => {
    const now = 1_800_000_000_000;
    const issued = issueLinkCode(emps, "e1", { now, rand: () => 0.1 });
    expect(issued.code).toHaveLength(6);
    expect(issued.expiresAt).toBe(now + LINK_CODE_TTL_MS);
    expect(linkStatus(issued.employees[0], now)).toEqual({ linked: false, code: issued.code, expiresAt: now + LINK_CODE_TTL_MS });
    const paired = applyLinkCode(issued.employees, issued.code, "Uold", now + 1000);
    expect(paired.employee).toEqual({ id: "e1", name: "Nong", lineUserId: "Uold", lineLinkedAt: now + 1000 });
    expect(paired.employees[1]).toEqual({ id: "e2", name: "Arthit" }); // same LINE account cannot be two people
    expect(linkStatus(paired.employee, now + 1000)).toEqual({ linked: true, code: null, expiresAt: null });
  });
  it("an expired or unknown code does nothing; unlink drops the identity", () => {
    const now = 1_800_000_000_000;
    const issued = issueLinkCode(emps, "e1", { now });
    expect(applyLinkCode(issued.employees, issued.code, "U1", now + LINK_CODE_TTL_MS + 1)).toBeNull();
    expect(applyLinkCode(issued.employees, "ZZZZZZ", "U1", now)).toBeNull();
    expect(issueLinkCode(emps, "nobody")).toBeNull();
    expect(unlinkEmployee(emps, "e2")[1]).toEqual({ id: "e2", name: "Arthit" });
  });
  it("resolves employee ids to linked userIds only, deduplicated", () => {
    expect(resolveLineUserIds(emps, ["e1", "e2", "e2", "e9"])).toEqual(["Uold"]);
    expect(resolveLineUserIds(emps, [])).toEqual([]);
  });
});
