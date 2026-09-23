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
// A NEW document also needs a job / work name: since 2026-09-23 a document can
// be raised with no job attached at all, and a nameless one would land in the
// list and in the revenue grouping as a blank row. Editing an older document
// that predates the rule is never blocked by it.
//   { ok: true } | { ok: false, reason: "noRate" | "noLinkedInvoice" | "noJobName" }
export function validateDocument({ items, docType, linkedInvId, isEdit, jobName }) {
  if (docType === "receipt" && !isEdit && !linkedInvId) return { ok: false, reason: "noLinkedInvoice" };
  if (!isEdit && !String(jobName == null ? "" : jobName).trim()) return { ok: false, reason: "noJobName" };
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

// The P2-9 owner lock on a production company was lifted 2026-09-22 at Koon's
// request: a crew member fixing a wrong billing address on their own invoice
// should not have to ask an admin first. Every field of every company is now
// writable by anyone signed in, so there is no permission helper left to call;
// `addedBy` survives as attribution and delete scope only (the server keeps it,
// see functions/_lib/roles.js mergeSharedWhole).
//
// A company edited by someone other than the crew member who added it keeps its
// original attribution and gains a last-edited stamp, so a wrong address is
// traceable to whoever changed it (the owner lock used to provide that).
export function stampCompanyEdit(company, actor, at = Date.now()) {
  if (!company || !actor) return company;
  const addedBy = company.addedBy ?? null;
  if (addedBy != null && addedBy === actor.id) return company; // their own: no stamp needed
  return { ...company, editedBy: actor.id, editedByName: actor.name || "", editedAt: at };
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
