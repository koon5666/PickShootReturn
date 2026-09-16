import { describe, it, expect } from "vitest";
import { printableItems, validateDocument, docTotals, snapshotBillTo, resolveBillTo, canEditCompany, dateInTz, dueDateFrom, canMarkPaid, embedFlags, docTitle, fillableCompanyFields } from "./invoiceDoc.js";

const items = [
  { id: "a", description: "1st AC (12hr)", qty: 2, rate: "3500", vat: true },
  { id: "b", description: "Overtime", qty: 1, rate: "", vat: true },
  { id: "c", description: "Travel Day Fee", qty: 1, rate: "0", vat: true },
  { id: "d", description: "Per diem", qty: 2, rate: "1,000", vat: false },
];

describe("printableItems", () => {
  it("drops rate-empty / zero rows and keeps priced ones", () => {
    expect(printableItems({ items }).map(i => i.id)).toEqual(["a", "d"]);
  });
  it("legacy documents fall back to the four fixed fees", () => {
    expect(printableItems({ laborFee: 3000, overtime: "", travelFee: 0, perDiem: "500" }).map(i => i.description)).toEqual(["Labor Fee", "Per Diem"]);
  });
  it("empty document prints nothing", () => {
    expect(printableItems({ items: [] })).toEqual([]);
    expect(printableItems(null)).toEqual([]);
  });
});

describe("validateDocument", () => {
  it("blocks a document with no priced line", () => {
    expect(validateDocument({ items: [{ qty: 1, rate: "" }], docType: "invoice" })).toEqual({ ok: false, reason: "noRate" });
    expect(validateDocument({ items: [], docType: "invoice" })).toEqual({ ok: false, reason: "noRate" });
    expect(validateDocument({ items: [{ qty: 0, rate: "500" }], docType: "invoice" })).toEqual({ ok: false, reason: "noRate" });
  });
  it("passes with one priced line", () => {
    expect(validateDocument({ items, docType: "invoice" })).toEqual({ ok: true });
  });
  it("a new receipt needs a linked paid invoice", () => {
    expect(validateDocument({ items, docType: "receipt" })).toEqual({ ok: false, reason: "noLinkedInvoice" });
    expect(validateDocument({ items, docType: "receipt", linkedInvId: "inv1" })).toEqual({ ok: true });
    expect(validateDocument({ items, docType: "receipt", isEdit: true })).toEqual({ ok: true });
  });
});

describe("docTotals with withholding tax", () => {
  it("no VAT, no WHT", () => {
    expect(docTotals({ items })).toMatchObject({ subtotal: 9000, vatAmount: 0, total: 9000, whtRate: 0, whtAmount: 0, netPayable: 9000 });
  });
  it("WHT 3% is taken on the pre-VAT amount, net = total incl. VAT minus WHT", () => {
    const t = docTotals({ items, vatEnabled: true, vatType: "exclusive", whtEnabled: true });
    // a: 7000 with VAT, d: 2000 without VAT
    expect(t.subtotal).toBeCloseTo(9000, 6);
    expect(t.vatAmount).toBeCloseTo(490, 6);
    expect(t.total).toBeCloseTo(9490, 6);
    expect(t.whtRate).toBe(3);
    expect(t.whtAmount).toBeCloseTo(270, 6);
    expect(t.netPayable).toBeCloseTo(9220, 6);
  });
  it("custom WHT rate", () => {
    expect(docTotals({ items, whtEnabled: true, whtRate: 5 }).whtAmount).toBeCloseTo(450, 6);
  });
  it("ignores unpriced rows in the math", () => {
    expect(docTotals({ items: [{ qty: 3, rate: "" }, { qty: 1, rate: "100" }] }).total).toBe(100);
  });
});

describe("Bill To snapshot (P2-9)", () => {
  const companies = [
    { id: "c1", name: "Bangkok Pictures Co., Ltd.", address: "99/1 Sukhumvit 55", taxId: "0105551234567", branch: "00000", addedBy: "e1" },
    { id: "c2", name: "Indie House", address: "" },
  ];
  it("snapshotBillTo copies name, address, tax id, branch (case-insensitive name match)", () => {
    expect(snapshotBillTo("bangkok pictures co., ltd.", companies)).toEqual({ name: "bangkok pictures co., ltd.", address: "99/1 Sukhumvit 55", taxId: "0105551234567", branch: "00000" });
    expect(snapshotBillTo("Unknown Co", companies)).toEqual({ name: "Unknown Co", address: "", taxId: "", branch: "" });
  });
  it("resolveBillTo prefers the snapshot over the live list", () => {
    const inv = { productionCompany: "Bangkok Pictures Co., Ltd.", billTo: { name: "Bangkok Pictures Co., Ltd.", address: "OLD ADDRESS" } };
    expect(resolveBillTo(inv, companies).address).toBe("OLD ADDRESS");
    // legacy document without a snapshot still resolves live
    expect(resolveBillTo({ productionCompany: "Bangkok Pictures Co., Ltd." }, companies).address).toBe("99/1 Sukhumvit 55");
  });
  it("canEditCompany: admin or the crew who added it", () => {
    expect(canEditCompany(companies[0], { id: "admin", role: "admin" })).toBe(true);
    expect(canEditCompany(companies[0], { id: "e1", role: "employee" })).toBe(true);
    expect(canEditCompany(companies[0], { id: "e2", role: "employee" })).toBe(false);
    expect(canEditCompany(companies[1], { id: "e1", role: "employee" })).toBe(false); // house-registered
    expect(canEditCompany(companies[1], { id: "admin", role: "admin" })).toBe(true);
  });
});

describe("dates / paid rules", () => {
  it("dateInTz stamps the app timezone, not UTC", () => {
    // 2026-09-16T20:30Z is already the 17th in Bangkok (+7)
    expect(dateInTz(Date.UTC(2026, 8, 16, 20, 30), "Asia/Bangkok")).toBe("2026-09-17");
    expect(dateInTz(Date.UTC(2026, 8, 16, 20, 30), "UTC")).toBe("2026-09-16");
  });
  it("dueDateFrom adds the terms", () => {
    expect(dueDateFrom("2026-09-16", 30)).toBe("2026-10-16");
    expect(dueDateFrom("2026-09-16", 0)).toBe("2026-09-16");
    expect(dueDateFrom("2026-09-16", "")).toBe("");
    expect(dueDateFrom("", 30)).toBe("");
  });
  it("canMarkPaid refuses a zero total", () => {
    expect(canMarkPaid({ items: [{ qty: 1, rate: "" }] })).toBe(false);
    expect(canMarkPaid({ items })).toBe(true);
  });
  it("embedFlags: ID card opt-in (default off), signature + bank default on", () => {
    expect(embedFlags({})).toEqual({ idCard: false, signature: true, bank: true });
    expect(embedFlags({ includeIdCard: true, includeSignature: false, includeBank: false })).toEqual({ idCard: true, signature: false, bank: false });
  });
  it("docTitle is bilingual", () => {
    expect(docTitle("quotation")).toEqual({ th: "ใบเสนอราคา", en: "QUOTATION" });
    expect(docTitle(undefined).en).toBe("INVOICE");
  });
});

describe("fillableCompanyFields (crew fill-in of empty billing fields on a shared company)", () => {
  const me = { id: "e1", role: "employee" };
  it("own company: everything; house company: only the blank billing fields; nothing blank: locked", () => {
    expect(fillableCompanyFields({ id: "p", name: "Mine", addedBy: "e1" }, me)).toEqual(["name", "address", "taxId", "branch"]);
    expect(fillableCompanyFields({ id: "p", name: "House", address: "" }, me)).toEqual(["address", "taxId", "branch"]);
    expect(fillableCompanyFields({ id: "p", name: "House", address: "12 Rama IV", taxId: " " }, me)).toEqual(["taxId", "branch"]);
    expect(fillableCompanyFields({ id: "p", name: "House", address: "A", taxId: "1", branch: "HQ", addedBy: "e2" }, me)).toEqual([]);
    expect(fillableCompanyFields({ id: "p", name: "House" }, { id: "admin", role: "admin" })).toEqual(["name", "address", "taxId", "branch"]);
  });
});
