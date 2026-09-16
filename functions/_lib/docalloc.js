// Server-side document-number allocation (P0-6).
//
// The client still previews and reserves a number optimistically, but two
// devices minting in the same instant would both hold e.g. INV-LCR-26-0007.
// On PUT /api/data the server is the last word: a NEW invoice whose number is
// already held by another document (in KV or elsewhere in the same payload)
// is re-numbered to the next free number of ITS OWN series, and the PUT answers
// `renumbered: [{ id, from, to }]` so the client can correct what it shows.
//
// Only genuinely new records are touched: an id KV already knows keeps its
// number for ever (a document that has been printed or sent must never change).
// A document with no number at all (`invoiceNo: ""`) is allocated one too.
//
// The numbering rules themselves live in src/logic/docNumber.js and are shared
// with the client, so both sides agree on what "the next number" means.
import { nextDocNo, parseDocNo, docCode } from "../../src/logic/docNumber.js";

const isReceipt = (inv) => inv && inv.docType === "receipt";

// series of an existing number, or the document's own (docType, prefix, year).
function seriesOf(inv) {
  const parsed = parseDocNo(inv && inv.invoiceNo);
  if (parsed) return { docType: inv.docType || "invoice", prefix: parsed.prefix, year: "20" + parsed.yy };
  return { docType: (inv && inv.docType) || "invoice", prefix: "", year: undefined };
}

export function allocateNumbers(incoming, existing) {
  const kvById = new Map((existing || []).filter(e => e && e.id != null).map(e => [e.id, e]));
  // every number already spoken for (KV + the records of this payload the server keeps)
  const taken = new Map(); // invoiceNo -> id
  for (const e of existing || []) if (e && e.invoiceNo && e.id != null && !taken.has(e.invoiceNo)) taken.set(e.invoiceNo, e.id);
  const pool = [...(existing || [])];
  const renumbered = [];
  const out = (incoming || []).map(inv => {
    if (!inv || typeof inv !== "object" || inv.id == null) return inv;
    if (kvById.has(inv.id)) { if (inv.invoiceNo) taken.set(inv.invoiceNo, inv.id); return inv; } // known record: number is final
    const holder = inv.invoiceNo ? taken.get(inv.invoiceNo) : undefined;
    if (inv.invoiceNo && (holder === undefined || holder === inv.id)) { taken.set(inv.invoiceNo, inv.id); pool.push(inv); return inv; }
    // collision (or no number at all): mint the next free one in this document's series
    const { docType, prefix, year } = seriesOf(inv);
    let no = nextDocNo({ docType, prefix, year, issuerId: inv.employeeId, invoices: pool });
    let guard = 0;
    while (taken.has(no) && guard++ < 1000) { pool.push({ id: "__t" + guard, employeeId: inv.employeeId, invoiceNo: no }); no = nextDocNo({ docType, prefix, year, issuerId: inv.employeeId, invoices: pool }); }
    renumbered.push({ id: inv.id, from: inv.invoiceNo || null, to: no, docType: docType, code: docCode(docType), receipt: isReceipt(inv) });
    taken.set(no, inv.id);
    const next = { ...inv, invoiceNo: no };
    pool.push(next);
    return next;
  });
  return { invoices: out, renumbered };
}
