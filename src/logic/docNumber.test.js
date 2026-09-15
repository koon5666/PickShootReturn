import { describe, it, expect } from "vitest";
import { sanitizePrefix, derivePrefix, nextDocNo, maxSeq, rtxNoFromInv, fmtDocNo, docCode } from "./docNumber.js";

const inv = (employeeId, invoiceNo, extra = {}) => ({ id: invoiceNo + employeeId, employeeId, invoiceNo, ...extra });

describe("sanitizePrefix / derivePrefix", () => {
  it("upper-cases, strips non-alnum, caps at 6", () => {
    expect(sanitizePrefix(" nong-1 ")).toBe("NONG1");
    expect(sanitizePrefix("abcdefgh")).toBe("ABCDEF");
    expect(sanitizePrefix("น้อง")).toBe("");
    expect(sanitizePrefix(null)).toBe("");
  });
  it("explicit prefix wins, then nickname, first name, account name", () => {
    expect(derivePrefix({ invoicePrefix: "NG", nickname: "Nong" })).toBe("NG");
    expect(derivePrefix({ nickname: "Nong", firstName: "Somchai" })).toBe("NONG");
    expect(derivePrefix({ firstName: "Somchai", name: "Beam" })).toBe("SOMCHA");
    expect(derivePrefix({ name: "Beam" })).toBe("BEAM");
  });
  it("Thai-only names fall back to a stable id-derived prefix (never empty)", () => {
    expect(derivePrefix({ nickname: "น้อง", firstName: "สมชาย", name: "บีม", id: "e_1758990001234" })).toBe("C01234");
    expect(derivePrefix({})).toBe("CREW");
  });
});

describe("nextDocNo: per (issuer, docType, year) series", () => {
  it("starts at 0001 with an empty list", () => {
    expect(nextDocNo({ docType: "invoice", prefix: "NG", year: 2026, issuerId: "e1", invoices: [] })).toBe("INV-NG-26-0001");
    expect(nextDocNo({ docType: "quotation", prefix: "NG", year: 2026, issuerId: "e1", invoices: [] })).toBe("QUO-NG-26-0001");
  });
  it("continues the issuer's own series and ignores other issuers", () => {
    const list = [inv("e1", "INV-NG-26-0001"), inv("e1", "INV-NG-26-0002"), inv("admin", "INV-26-0009"), inv("e2", "INV-AT-26-0007")];
    expect(nextDocNo({ docType: "invoice", prefix: "NG", year: 2026, issuerId: "e1", invoices: list })).toBe("INV-NG-26-0003");
    expect(nextDocNo({ docType: "invoice", prefix: "", year: 2026, issuerId: "admin", invoices: list })).toBe("INV-26-0010");
  });
  it("house (no prefix) series does not see crew numbers and crew does not see the house", () => {
    const list = [inv("admin", "INV-26-0001"), inv("admin", "INV-26-0002"), inv("e1", "INV-NG-26-0001")];
    expect(maxSeq({ docType: "invoice", prefix: "", year: 2026, issuerId: "admin", invoices: list })).toBe(2);
    expect(maxSeq({ docType: "invoice", prefix: "NG", year: 2026, issuerId: "e1", invoices: list })).toBe(1);
    // legacy interleaved crew doc in the house namespace (pre-fix data) is NOT counted in the house's own book
    const legacy = [...list, inv("e1", "INV-26-0003")];
    expect(maxSeq({ docType: "invoice", prefix: "", year: 2026, issuerId: "admin", invoices: legacy })).toBe(2);
  });
  it("never collides with a number another issuer already holds", () => {
    // pre-fix data: crew e1 took INV-26-0003 out of the house series
    const list = [inv("admin", "INV-26-0001"), inv("admin", "INV-26-0002"), inv("e1", "INV-26-0003")];
    expect(nextDocNo({ docType: "invoice", prefix: "", year: 2026, issuerId: "admin", invoices: list })).toBe("INV-26-0004");
  });
  it("two crew members who derive the same prefix still get distinct numbers", () => {
    const list = [inv("e1", "INV-NONG-26-0001")];
    expect(nextDocNo({ docType: "invoice", prefix: "NONG", year: 2026, issuerId: "e2", invoices: list })).toBe("INV-NONG-26-0002");
  });
  it("soft-deleted documents still burn their number", () => {
    const list = [inv("e1", "INV-NG-26-0001", { _deleted: true })];
    expect(nextDocNo({ docType: "invoice", prefix: "NG", year: 2026, issuerId: "e1", invoices: list })).toBe("INV-NG-26-0002");
  });
  it("is scoped per doc type and per year", () => {
    const list = [inv("e1", "INV-NG-26-0005"), inv("e1", "QUO-NG-26-0002"), inv("e1", "INV-NG-25-0040")];
    expect(nextDocNo({ docType: "quotation", prefix: "NG", year: 2026, issuerId: "e1", invoices: list })).toBe("QUO-NG-26-0003");
    expect(nextDocNo({ docType: "invoice", prefix: "NG", year: 2027, issuerId: "e1", invoices: list })).toBe("INV-NG-27-0001");
    expect(nextDocNo({ docType: "invoice", prefix: "NG", year: 2026, issuerId: "e1", invoices: list })).toBe("INV-NG-26-0006");
  });
  it("a prefixed number never matches the legacy pattern and vice versa", () => {
    const list = [inv("admin", "INV-LCR-26-0003"), inv("admin", "INV-26-0001")];
    expect(nextDocNo({ docType: "invoice", prefix: "LCR", year: 2026, issuerId: "admin", invoices: list })).toBe("INV-LCR-26-0004");
    expect(nextDocNo({ docType: "invoice", prefix: "", year: 2026, issuerId: "admin", invoices: list })).toBe("INV-26-0002");
  });
  it("tolerates malformed rows", () => {
    const list = [null, {}, { employeeId: "e1", invoiceNo: 42 }, inv("e1", "garbage")];
    expect(nextDocNo({ docType: "invoice", prefix: "NG", year: 2026, issuerId: "e1", invoices: list })).toBe("INV-NG-26-0001");
  });
});

describe("helpers", () => {
  it("rtxNoFromInv swaps the code", () => {
    expect(rtxNoFromInv("INV-NG-26-0002")).toBe("RTX-NG-26-0002");
    expect(rtxNoFromInv("QUO-NG-26-0002")).toBe("QUO-NG-26-0002");
  });
  it("fmtDocNo appends the revision letter", () => {
    expect(fmtDocNo({ invoiceNo: "INV-NG-26-0002", revisions: 0 })).toBe("INV-NG-26-0002");
    expect(fmtDocNo({ invoiceNo: "INV-NG-26-0002", revisions: 2 })).toBe("INV-NG-26-0002B");
    expect(fmtDocNo({})).toBe("");
  });
  it("docCode defaults to INV", () => {
    expect(docCode("receipt")).toBe("RTX");
    expect(docCode(undefined)).toBe("INV");
  });
});
