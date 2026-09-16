import { describe, it, expect } from "vitest";
import { sanitizePrefix, derivePrefix, nextDocNo, maxSeq, rtxNoFromInv, fmtDocNo, docCode, receiptNoFor, parseDocNo } from "./docNumber.js";

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

describe("receiptNoFor: a voided receipt burns its number (P0-6 / P0-8)", () => {
  const paidInv = { id: "i1", employeeId: "admin", invoiceNo: "INV-LCR-26-0001", status: "Paid", docType: "invoice" };
  it("mirrors the invoice number the first time", () => {
    expect(receiptNoFor(paidInv, [paidInv])).toBe("RTX-LCR-26-0001");
  });
  it("after Undo paid voided the mirror, the re-issued receipt takes the next free RTX number", () => {
    const voided = { id: "r1", employeeId: "admin", invoiceNo: "RTX-LCR-26-0001", status: "Void", docType: "receipt", linkedInvId: "i1" };
    expect(receiptNoFor(paidInv, [paidInv, voided])).toBe("RTX-LCR-26-0002");
    const second = { id: "r2", employeeId: "admin", invoiceNo: "RTX-LCR-26-0002", status: "Void", docType: "receipt", linkedInvId: "i1" };
    expect(receiptNoFor(paidInv, [paidInv, voided, second])).toBe("RTX-LCR-26-0003");
  });
  it("a soft-deleted receipt burns the mirror too, and the fallback skips another issuer's string", () => {
    const deleted = { id: "r1", employeeId: "admin", invoiceNo: "RTX-LCR-26-0001", docType: "receipt", _deleted: true };
    const other = { id: "x", employeeId: "e1", invoiceNo: "RTX-LCR-26-0002", docType: "receipt" };
    expect(receiptNoFor(paidInv, [paidInv, deleted, other])).toBe("RTX-LCR-26-0003");
  });
  it("crew receipts follow the crew prefix series (legacy house numbers have no prefix)", () => {
    const crewInv = { id: "c1", employeeId: "e1", invoiceNo: "INV-NG-26-0004", status: "Paid" };
    const voided = { id: "r", employeeId: "e1", invoiceNo: "RTX-NG-26-0004", status: "Void", docType: "receipt" };
    expect(receiptNoFor(crewInv, [crewInv, voided])).toBe("RTX-NG-26-0005");
    const legacyInv = { id: "l1", employeeId: "admin", invoiceNo: "INV-26-0002", status: "Paid" };
    const legacyVoid = { id: "lr", employeeId: "admin", invoiceNo: "RTX-26-0002", status: "Void", docType: "receipt" };
    expect(receiptNoFor(legacyInv, [legacyInv, legacyVoid])).toBe("RTX-26-0003");
  });
  it("parseDocNo reads prefix, year and sequence", () => {
    expect(parseDocNo("INV-LCR-26-0007")).toEqual({ code: "INV", prefix: "LCR", yy: "26", seq: 7 });
    expect(parseDocNo("QUO-26-0010")).toEqual({ code: "QUO", prefix: "", yy: "26", seq: 10 });
    expect(parseDocNo("garbage")).toBeNull();
  });
});
