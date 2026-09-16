// Pure document rules shared by InvoiceCreateModal, the crew Invoice tab, the
// admin InvoicePage and buildInvoiceHTML. No React, no globals. Tested in
// invoiceDoc.test.js.
import { calcVatBreakdown } from "./money.js";

export const WHT_DEFAULT_RATE = 3; // Thai withholding tax on service fees, percent

const num = (v) => parseFloat((v == null ? "" : v).toString().replace(/,/g, "")) || 0;

// Line items with a real rate. Rows left at rate 0 / empty are editing
// scaffolding (the default Labor / Overtime / Travel rows) and never print
// (P2-4). Legacy documents without `items` fall back to the four fixed fees.
export function printableItems(invoice) {
  const raw = invoice?.items?.length ? invoice.items : [
    { description: "Labor Fee", qty: 1, rate: invoice?.laborFee || 0 },
    { description: "Overtime", qty: 1, rate: invoice?.overtime || 0 },
    { description: "Travel Fee", qty: 1, rate: invoice?.travelFee || 0 },
    { description: "Per Diem", qty: 1, rate: invoice?.perDiem || 0 },
  ];
  return raw.filter(it => num(it?.rate) > 0);
}

// Save gate (P2-4): a document needs at least one line with rate > 0. The
// caller may still allow an explicit zero quote after a confirm.
//   { ok: true } | { ok: false, reason: "noRate" | "noLinkedInvoice" }
export function validateDocument({ items, docType, linkedInvId, isEdit }) {
  if (docType === "receipt" && !isEdit && !linkedInvId) return { ok: false, reason: "noLinkedInvoice" };
  const priced = (items || []).filter(it => num(it?.rate) > 0 && num(it?.qty) > 0);
  if (priced.length === 0) return { ok: false, reason: "noRate" };
  return { ok: true };
}

// Money summary for the printed document: subtotal / VAT / total plus the
// optional withholding tax line (P1-7). WHT is computed on the amount BEFORE
// VAT (the service fee), which is how Thai payers deduct it; net payable is the
// VAT-inclusive total minus the WHT.
export function docTotals(invoice) {
  const inv = { ...invoice, items: printableItems(invoice) };
  const { subtotal, vatAmount, total } = calcVatBreakdown(inv);
  const whtRate = invoice?.whtEnabled ? (num(invoice.whtRate) || WHT_DEFAULT_RATE) : 0;
  const whtAmount = whtRate > 0 ? subtotal * whtRate / 100 : 0;
  return { subtotal, vatAmount, total, whtRate, whtAmount, netPayable: total - whtAmount };
}

// Snapshot of the customer as it was when the document was saved (P2-9). The
// printed Bill To reads from this, never from the live company list, so a
// later rename or re-address of a shared company cannot rewrite an issued
// document.
export function snapshotBillTo(productionCompany, productionCompanies) {
  const name = (productionCompany || "").trim();
  const co = (productionCompanies || []).find(c => (c?.name || "").trim().toLowerCase() === name.toLowerCase());
  return {
    name,
    address: (co?.address || "").trim(),
    taxId: (co?.taxId || "").trim(),
    branch: (co?.branch || "").trim(),
  };
}

// Bill To for rendering: the snapshot when present, else the legacy live lookup.
export function resolveBillTo(invoice, productionCompanies) {
  if (invoice?.billTo && typeof invoice.billTo === "object" && (invoice.billTo.name || invoice.billTo.address)) {
    return { name: invoice.billTo.name || invoice.productionCompany || "", address: invoice.billTo.address || "", taxId: invoice.billTo.taxId || "", branch: invoice.billTo.branch || "" };
  }
  return snapshotBillTo(invoice?.productionCompany, productionCompanies);
}

// Who may edit a shared production company (P2-9): the admin, or the crew
// member who added it. Companies with no `addedBy` were registered by the house.
export function canEditCompany(company, actor) {
  if (!company || !actor) return false;
  if (actor.role === "admin" || actor.id === "admin") return true;
  return !!company.addedBy && company.addedBy === actor.id;
}
// Billing fields a crew member may still FILL IN on a company they cannot edit:
// the ones that are empty (a house auto-registered from a booking has no
// address; the crew invoicing it needs one). Mirrors the server rule
// (functions/_lib/roles.js COMPANY_FILLABLE): existing values never change.
export const COMPANY_FILLABLE = ["address", "taxId", "branch"];
export function fillableCompanyFields(company, actor) {
  if (!company) return [];
  if (canEditCompany(company, actor)) return ["name", ...COMPANY_FILLABLE];
  return COMPANY_FILLABLE.filter(f => company[f] == null || String(company[f]).trim() === "");
}

// YYYY-MM-DD for a timestamp in the app timezone (paidDate stamping, P0-8).
export function dateInTz(ts = Date.now(), tz = "Asia/Bangkok") {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(ts)); }
  catch { return new Date(ts).toISOString().slice(0, 10); }
}

// Due date from an issue date + payment terms in days (P1-7).
export function dueDateFrom(issueDate, termsDays) {
  const days = parseInt(termsDays, 10);
  if (!issueDate || !(days >= 0)) return "";
  const d = new Date(issueDate + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return "";
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Mark Paid rule (P0-8): refuse a zero-total document.
export function canMarkPaid(invoice) {
  const { total } = docTotals(invoice);
  return total > 0;
}

// What a document embeds (P0-7). ID card is opt-in per document and defaults
// OFF; signature and bank/QR default ON. Legacy documents (fields absent) get
// the same defaults, so an old share can no longer print the ID card.
export function embedFlags(invoice) {
  return {
    idCard: invoice?.includeIdCard === true,
    signature: invoice?.includeSignature !== false,
    bank: invoice?.includeBank !== false,
  };
}

// Bilingual document title.
export const DOC_TITLES = {
  quotation: { th: "ใบเสนอราคา", en: "QUOTATION" },
  invoice: { th: "ใบแจ้งหนี้", en: "INVOICE" },
  receipt: { th: "ใบเสร็จรับเงิน", en: "RECEIPT" },
};
export const docTitle = (docType) => DOC_TITLES[docType] || DOC_TITLES.invoice;
