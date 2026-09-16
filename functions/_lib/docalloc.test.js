import { describe, it, expect } from "vitest";
import { allocateNumbers } from "./docalloc.js";

const inv = (id, employeeId, invoiceNo, extra = {}) => ({ id, employeeId, invoiceNo, docType: "invoice", createdAt: 1, ...extra });

describe("server-side document number allocation (P0-6)", () => {
  it("two devices minting the same number: the second one is re-numbered, the first keeps it", () => {
    const kv = [inv("i1", "admin", "INV-LCR-26-0001")];
    const r = allocateNumbers([inv("i1", "admin", "INV-LCR-26-0001"), inv("i2", "admin", "INV-LCR-26-0002")], kv);
    expect(r.renumbered).toEqual([]);                                    // no clash yet
    const kv2 = [...kv, inv("i2", "admin", "INV-LCR-26-0002")];
    const r2 = allocateNumbers([inv("i3", "admin", "INV-LCR-26-0002")], kv2); // the other device's optimistic number
    expect(r2.invoices[0].invoiceNo).toBe("INV-LCR-26-0003");
    expect(r2.renumbered).toEqual([{ id: "i3", from: "INV-LCR-26-0002", to: "INV-LCR-26-0003", docType: "invoice", code: "INV", receipt: false }]);
  });
  it("a number KV already holds for that id is never changed (printed documents keep their number)", () => {
    const kv = [inv("i1", "admin", "INV-LCR-26-0001", { status: "Paid" })];
    const r = allocateNumbers([inv("i1", "admin", "INV-LCR-26-0001", { status: "Pending" })], kv);
    expect(r.invoices[0].invoiceNo).toBe("INV-LCR-26-0001");
    expect(r.renumbered).toEqual([]);
  });
  it("collisions inside ONE payload are resolved too, per issuer series", () => {
    const r = allocateNumbers([inv("a", "e1", "INV-NG-26-0001"), inv("b", "e1", "INV-NG-26-0001"), inv("c", "e2", "INV-AT-26-0001")], []);
    expect(r.invoices.map(i => i.invoiceNo)).toEqual(["INV-NG-26-0001", "INV-NG-26-0002", "INV-AT-26-0001"]);
    expect(r.renumbered.map(x => x.id)).toEqual(["b"]);
  });
  it("receipts and quotations keep their own series; a numberless document gets one", () => {
    const kv = [inv("r1", "admin", "RTX-LCR-26-0001", { docType: "receipt" })];
    const r = allocateNumbers([inv("r2", "admin", "RTX-LCR-26-0001", { docType: "receipt" }), inv("q1", "admin", "QUO-LCR-26-0004", { docType: "quotation" })], kv);
    expect(r.invoices[0].invoiceNo).toBe("RTX-LCR-26-0002");
    expect(r.invoices[1].invoiceNo).toBe("QUO-LCR-26-0004");
    const none = allocateNumbers([inv("x", "e1", "", { docType: "invoice" })], []);
    expect(none.invoices[0].invoiceNo).toBe("INV-26-0001"); // no prefix parsed: legacy house series
    expect(none.renumbered[0]).toMatchObject({ id: "x", from: null });
  });
  it("a soft-deleted or voided number stays burned", () => {
    const kv = [inv("d1", "admin", "INV-LCR-26-0001", { _deleted: true }), inv("v1", "admin", "RTX-LCR-26-0001", { docType: "receipt", status: "Void" })];
    expect(allocateNumbers([inv("n", "admin", "INV-LCR-26-0001")], kv).invoices[0].invoiceNo).toBe("INV-LCR-26-0002");
    expect(allocateNumbers([inv("n2", "admin", "RTX-LCR-26-0001", { docType: "receipt" })], kv).invoices[0].invoiceNo).toBe("RTX-LCR-26-0002");
  });
});
