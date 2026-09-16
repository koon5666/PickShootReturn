// Document numbering for QUO / INV / RTX. Pure functions, no React, unit-tested
// in docNumber.test.js.
//
// Rule (review item P0-6): a running number belongs to ONE issuer. The sequence
// is scoped per (issuer, docType, year) and every crew issuer carries a
// mandatory prefix (derived from nickname / first name when none is set), so
// numbers never interleave between the house and the crew or between two crew
// members. Allocation is still client-side tonight; `nextDocNo` therefore also
// bumps past any number that already exists in the whole list (any issuer) so
// two issuers can never end up holding the same string.
//
// Formats:
//   crew      INV-<PREFIX>-<YY>-<0001>     prefix always present
//   house     INV-<PREFIX>-<YY>-<0001>     when the admin set a house prefix
//             INV-<YY>-<0001>              legacy house format (no prefix set);
//                                          kept so the live house series is not
//                                          restarted under a new name
//   RTX       the linked INV number with INV- swapped for RTX-

export const DOC_CODES = { invoice: "INV", quotation: "QUO", receipt: "RTX" };
export const docCode = (docType) => DOC_CODES[docType] || "INV";

export const PREFIX_MAX = 6;

// Upper-case ASCII letters + digits only, max 6. Everything else (Thai script,
// spaces, punctuation) is dropped, so the result can be empty.
export function sanitizePrefix(s) {
  return String(s || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, PREFIX_MAX);
}

// Mandatory crew prefix. Explicit profile prefix wins; otherwise the first
// usable of nickname → first name → account name; if none yields ASCII (Thai
// names) fall back to the account id so the prefix is still unique and stable.
export function derivePrefix({ invoicePrefix, nickname, firstName, name, id } = {}) {
  for (const cand of [invoicePrefix, nickname, firstName, name]) {
    const p = sanitizePrefix(cand);
    if (p) return p;
  }
  const idPart = String(id || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return idPart ? ("C" + idPart.slice(-5)).slice(0, PREFIX_MAX) : "CREW";
}

export function yearSuffix(date = new Date()) {
  return String(date.getFullYear()).slice(-2);
}

// Series head + regex for one (docType, prefix, year).
function series(docType, prefix, yy) {
  const dp = docCode(docType);
  const pfx = sanitizePrefix(prefix);
  const head = pfx ? `${dp}-${pfx}-${yy}-` : `${dp}-${yy}-`;
  // Legacy (no prefix) numbers must not match prefixed ones: INV-26-0001 vs INV-NG-26-0001.
  const re = pfx ? new RegExp(`^${dp}-${pfx}-${yy}-(\\d+)$`) : new RegExp(`^${dp}-${yy}-(\\d+)$`);
  return { head, re };
}

// Highest sequence this issuer already holds in the (docType, prefix, year) series.
export function maxSeq({ docType, prefix, year, issuerId, invoices }) {
  const yy = year != null ? String(year).slice(-2) : yearSuffix();
  const { re } = series(docType, prefix, yy);
  let max = 0;
  for (const inv of invoices || []) {
    if (!inv || typeof inv.invoiceNo !== "string") continue;
    if (issuerId != null && inv.employeeId !== issuerId) continue; // another issuer's book
    const m = inv.invoiceNo.match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10) || 0);
  }
  return max;
}

// Next number for this issuer. Soft-deleted documents still count (a burned
// number is never reused). Bumps past any string already held by anyone.
export function nextDocNo({ docType, prefix, year, issuerId, invoices }) {
  const yy = year != null ? String(year).slice(-2) : yearSuffix();
  const { head } = series(docType, prefix, yy);
  const taken = new Set((invoices || []).map(i => i && i.invoiceNo).filter(Boolean));
  let seq = maxSeq({ docType, prefix, year: yy, issuerId, invoices }) + 1;
  let no = head + String(seq).padStart(4, "0");
  while (taken.has(no)) { seq += 1; no = head + String(seq).padStart(4, "0"); }
  return no;
}

// Receipt number mirrors the invoice it settles.
export function rtxNoFromInv(invoiceNo) {
  return String(invoiceNo || "").replace(/^INV-/, "RTX-");
}

// Parse "<CODE>-[<PREFIX>-]<YY>-<seq>" into its parts (null when it is not a
// document number the app minted).
export function parseDocNo(no) {
  const m = String(no || "").match(/^([A-Z]{3})-(?:([A-Z0-9]{1,6})-)?(\d{2})-(\d+)$/);
  if (!m) return null;
  return { code: m[1], prefix: m[2] || "", yy: m[3], seq: parseInt(m[4], 10) || 0 };
}

// The number a NEW receipt for `inv` gets. It mirrors the invoice (INV- swapped
// for RTX-) the first time; once that string exists in the list (a voided or
// deleted receipt burned it, P0-8 "its number is not reused") the receipt takes
// the next free number of the issuer's RTX series for the invoice's prefix and
// year, so a re-issued receipt never repeats a voided one.
export function receiptNoFor(inv, invoices) {
  const mirror = rtxNoFromInv(inv && inv.invoiceNo);
  const taken = new Set((invoices || []).map(i => i && i.invoiceNo).filter(Boolean));
  if (mirror && mirror !== (inv && inv.invoiceNo) && !taken.has(mirror)) return mirror;
  const parts = parseDocNo(inv && inv.invoiceNo);
  const prefix = parts ? parts.prefix : "";
  const year = parts ? "20" + parts.yy : undefined;
  return nextDocNo({ docType: "receipt", prefix, year, issuerId: inv ? inv.employeeId : undefined, invoices });
}

// Revision letter (INV-NG-26-0001A for the first edit). Same as the old
// fmtInvoiceNo in App.jsx.
export function fmtDocNo(inv) {
  const base = (inv && inv.invoiceNo) || "";
  const rev = (inv && inv.revisions) || 0;
  return rev > 0 ? base + "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[Math.min(rev, 26) - 1] : base;
}
