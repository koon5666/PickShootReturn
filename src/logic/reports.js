// Owner reports (P2-16), computed client-side from the data the app already holds:
//   utilisation()      per-item % of unit-days out (checkout log) and booked
//                      (Confirmed job holds) over a period
//   overdueCsv()       the Not Returned list as CSV (overdue rows first)
//   customerHistory()  jobs + gear + days per production company
//   crewStatement()    month-end statement of crew invoices grouped by company
// Pure functions, no DOM; CSV strings are handed to history.js downloadText.
import { isPickEvt, isReturnEvt, isLostEvt, isVoidEvt } from "./checkoutState.js";
import { jobHoldDates } from "./availability.js";
import { docTotals } from "./invoiceDoc.js";

const DAY = 86400000;
const csvCell = (v) => { const s = v === null || v === undefined ? "" : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export const toCsv = (head, rows) => [head, ...rows].map(r => r.map(csvCell).join(",")).join("\n");
const num = (v) => parseFloat((v == null ? "" : v).toString().replace(/,/g, "")) || 0;
const isBarcode = (type) => typeof type === "string" && type.startsWith("barcode_");

// YYYY-MM-DD of a timestamp in a timezone (falls back to UTC date).
export function dayInTz(ts, tz) {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: tz || undefined }).format(new Date(ts)); }
  catch { return new Date(ts).toISOString().slice(0, 10); }
}
// Start of a YYYY-MM-DD day (UTC midnight, used only for period math).
const dayStart = (d) => Date.parse(d + "T00:00:00Z");
export const daysInPeriod = (from, to) => Math.max(0, Math.round((dayStart(to) - dayStart(from)) / DAY) + 1);

// Period presets: { from, to } in YYYY-MM-DD for "this month", "last month",
// "last 30 days", "this year" relative to `today` (YYYY-MM-DD).
export function periodPreset(kind, today) {
  const [y, m] = today.split("-").map(Number);
  const pad = (n) => String(n).padStart(2, "0");
  const lastDay = (yy, mm) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  if (kind === "thisMonth") return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDay(y, m))}` };
  if (kind === "lastMonth") { const yy = m === 1 ? y - 1 : y, mm = m === 1 ? 12 : m - 1; return { from: `${yy}-${pad(mm)}-01`, to: `${yy}-${pad(mm)}-${pad(lastDay(yy, mm))}` }; }
  if (kind === "thisYear") return { from: `${y}-01-01`, to: `${y}-12-31` };
  const from = new Date(dayStart(today) - 29 * DAY).toISOString().slice(0, 10);
  return { from, to: today };
}

// Unit-days physically out per eqId within [from, to], replayed from the checkout
// log per holder (job / request) the same way the still-out list counts: the
// photo and barcode lanes are two views of one unit, so out = max(lane picks) -
// max(lane returns) - lost at any instant.
function outUnitDays(checkouts, from, to, now) {
  const start = dayStart(from), end = Math.min(dayStart(to) + DAY, now);
  const byKey = new Map(); // holder::eqId -> events
  for (const c of checkouts || []) {
    if (!c || !c.eqId || isVoidEvt(c.type)) continue;
    if (!isPickEvt(c.type) && !isReturnEvt(c.type) && !isLostEvt(c.type)) continue;
    const holder = c.jobId || (c.requestId ? `req:${c.requestId}` : null);
    if (!holder) continue;
    const k = `${holder}::${c.eqId}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(c);
  }
  const perEq = {}; // eqId -> { unitDays, picks, holders:Set }
  for (const [k, evs] of byKey) {
    const eqId = k.split("::")[1];
    const holder = k.split("::")[0];
    const acc = perEq[eqId] || (perEq[eqId] = { unitDays: 0, picks: 0, holders: new Set() });
    evs.sort((a, b) => (a.ts || 0) - (b.ts || 0));
    let pp = 0, bp = 0, pr = 0, br = 0, lost = 0, prevTs = null, outQty = 0;
    const flush = (ts) => { if (prevTs != null && outQty > 0) { const a = Math.max(prevTs, start), b = Math.min(ts, end); if (b > a) acc.unitDays += (b - a) / DAY * outQty; } };
    for (const c of evs) {
      const ts = c.ts || 0;
      flush(ts);
      const q = Math.max(1, +c.qty || 1);
      if (isPickEvt(c.type)) { if (isBarcode(c.type)) bp += q; else pp += q; if (ts >= start && ts < end) { acc.picks += q; acc.holders.add(holder); } }
      else if (isReturnEvt(c.type)) { if (isBarcode(c.type)) br += q; else pr += q; }
      else lost += q;
      outQty = Math.max(0, Math.max(pp, bp) - Math.max(pr, br) - lost);
      prevTs = ts;
    }
    flush(end); // still out: counts up to the end of the period (or now)
  }
  return perEq;
}

// Per-item utilisation over [from, to]. Returns rows sorted by outPct desc:
//   { eqId, name, category, total, periodDays, unitDaysOut, outPct, unitDaysBooked, bookedPct, picks, jobs }
export function utilisation({ equipment = [], checkouts = [], jobs = [], from, to, now = Date.now() } = {}) {
  if (!from || !to || from > to) return [];
  const periodDays = daysInPeriod(from, to);
  const out = outUnitDays(checkouts, from, to, now);
  const booked = {};
  for (const j of jobs) {
    if (!j || j.status !== "Confirmed") continue;
    const days = jobHoldDates(j).filter(d => d >= from && d <= to).length;
    if (!days) continue;
    for (const ae of j.assignedEquipment || []) booked[ae.eqId] = (booked[ae.eqId] || 0) + days * (+ae.qty || 0);
  }
  return equipment.map(eq => {
    const total = Math.max(1, +eq.total || 1);
    const cap = total * periodDays;
    const o = out[eq.id] || { unitDays: 0, picks: 0, holders: new Set() };
    const unitDaysOut = Math.min(cap, o.unitDays);
    const unitDaysBooked = Math.min(cap, booked[eq.id] || 0);
    return {
      eqId: eq.id, name: eq.name, category: eq.category || "", total, periodDays,
      unitDaysOut: Math.round(unitDaysOut * 10) / 10, outPct: cap ? Math.round(unitDaysOut / cap * 1000) / 10 : 0,
      unitDaysBooked, bookedPct: cap ? Math.round(unitDaysBooked / cap * 1000) / 10 : 0,
      picks: o.picks, jobs: o.holders.size,
    };
  }).sort((a, b) => b.outPct - a.outPct || b.bookedPct - a.bookedPct || a.name.localeCompare(b.name));
}

export function utilisationCsv(rows, { from, to } = {}) {
  return toCsv(["Period", "Equipment", "Category", "Units", "Days out (unit-days)", "Out %", "Booked (unit-days)", "Booked %", "Picks", "Jobs"],
    rows.map(r => [`${from} to ${to}`, r.name, r.category, r.total, r.unitDaysOut, r.outPct, r.unitDaysBooked, r.bookedPct, r.picks, r.jobs]));
}

// Not Returned export: rows from availability.stillOutList (already overdue-first).
export function overdueCsv(items, { tz, onlyOverdue = false } = {}) {
  const rows = (items || []).filter(i => !onlyOverdue || i.overdue).map(i => [
    i.overdue ? "OVERDUE" : i.dueToday ? "DUE TODAY" : "OUT", i.eqName, i.qty, i.jobName || "", i.job?.production || "",
    i.pickedBy || "", i.pickedAt ? dayInTz(i.pickedAt, tz) : "", i.daysOut, i.dueDate || "", i.overdue ? i.daysOverdue : 0, i.missing ? "partial return" : "",
  ]);
  return toCsv(["Status", "Equipment", "Qty", "Job", "Production", "Picked by", "Picked on", "Days out", "Due", "Days overdue", "Note"], rows);
}

// Per-customer gear history: one row per job of that production company with
// its assigned items and hold days, plus totals. `company` matches job.production
// case-insensitively. Jobs newest first.
export function customerHistory({ jobs = [], equipment = [], checkouts = [], company } = {}) {
  const key = (company || "").trim().toLowerCase();
  const eqName = (id) => (equipment.find(e => e.id === id) || {}).name || id;
  const rows = jobs.filter(j => j && (j.production || "").trim().toLowerCase() === key && key).map(j => {
    const holdDays = jobHoldDates(j).length;
    const items = (j.assignedEquipment || []).map(ae => ({ eqId: ae.eqId, name: eqName(ae.eqId), qty: +ae.qty || 0 }));
    const units = items.reduce((s, it) => s + it.qty, 0);
    const picked = new Set((checkouts || []).filter(c => c && c.jobId === j.id && isPickEvt(c.type)).map(c => c.eqId)).size;
    const dates = [...(j.dates || [])].sort();
    return { jobId: j.id, name: j.name, status: j.status, first: dates[0] || "", last: dates[dates.length - 1] || "", shootDays: dates.length, holdDays, items, units, unitDays: units * holdDays, picked };
  }).sort((a, b) => (b.first || "").localeCompare(a.first || ""));
  const totals = rows.reduce((t, r) => ({ jobs: t.jobs + 1, shootDays: t.shootDays + r.shootDays, holdDays: t.holdDays + r.holdDays, units: t.units + r.units, unitDays: t.unitDays + r.unitDays }), { jobs: 0, shootDays: 0, holdDays: 0, units: 0, unitDays: 0 });
  return { company: (company || "").trim(), rows, totals };
}

export function customerHistoryCsv(h) {
  return toCsv(["Production", "Job", "Status", "First day", "Last day", "Shoot days", "Hold days", "Items", "Units", "Unit-days"],
    h.rows.map(r => [h.company, r.name, r.status, r.first, r.last, r.shootDays, r.holdDays, r.items.map(it => `${it.name}${it.qty > 1 ? ` x${it.qty}` : ""}`).join("; "), r.units, r.unitDays]));
}

// Customers seen in the job list (plus the company book), A to Z.
export function customerNames(jobs = [], productionCompanies = []) {
  const set = new Map();
  for (const c of productionCompanies) if (c && c.name && c.name.trim()) set.set(c.name.trim().toLowerCase(), c.name.trim());
  for (const j of jobs) if (j && j.production && j.production.trim() && !set.has(j.production.trim().toLowerCase())) set.set(j.production.trim().toLowerCase(), j.production.trim());
  return [...set.values()].sort((a, b) => a.localeCompare(b));
}

// Month-end statement of crew invoices (docType invoice, live, not void) issued
// in `month` (YYYY-MM, by issueDate or createdAt in `tz`), grouped by the
// customer they bill. Returns { month, companies: [{ company, rows, total, wht, net, paid, unpaid }], grand }.
export function crewStatement({ invoices = [], employees = [], month, tz } = {}) {
  const byEmp = new Map(employees.map(e => [e.id, e.name]));
  const companies = new Map();
  for (const inv of invoices) {
    if (!inv || inv._deleted || inv.status === "Void") continue;
    if ((inv.docType || "invoice") !== "invoice") continue;
    if (inv.employeeId === "admin") continue; // house documents are not crew invoices
    const issued = inv.issueDate || (inv.createdAt ? dayInTz(inv.createdAt, tz) : "");
    if (!issued || issued.slice(0, 7) !== month) continue;
    const company = (inv.billTo && inv.billTo.name) || inv.productionCompany || "(no customer)";
    const tot = docTotals(inv);
    const row = {
      id: inv.id, no: inv.invoiceNo || "", employee: byEmp.get(inv.employeeId) || inv.employeeName || inv.employeeId || "", position: inv.position || "",
      job: inv.jobName || "", issued, status: inv.status || "Pending", paidDate: inv.paidDate || "",
      subtotal: tot.subtotal, vat: tot.vatAmount, total: tot.total, wht: tot.whtAmount, net: tot.netPayable,
    };
    const g = companies.get(company) || { company, rows: [], total: 0, wht: 0, net: 0, paid: 0, unpaid: 0 };
    g.rows.push(row); g.total += row.total; g.wht += row.wht; g.net += row.net;
    if ((row.status || "Pending") === "Paid") g.paid += row.net; else g.unpaid += row.net;
    companies.set(company, g);
  }
  const list = [...companies.values()].map(g => ({ ...g, rows: g.rows.sort((a, b) => a.issued.localeCompare(b.issued) || a.no.localeCompare(b.no)) })).sort((a, b) => b.total - a.total);
  const grand = list.reduce((t, g) => ({ count: t.count + g.rows.length, total: t.total + g.total, wht: t.wht + g.wht, net: t.net + g.net, paid: t.paid + g.paid, unpaid: t.unpaid + g.unpaid }), { count: 0, total: 0, wht: 0, net: 0, paid: 0, unpaid: 0 });
  return { month, companies: list, grand };
}

export function crewStatementCsv(st) {
  const rows = [];
  for (const g of st.companies) for (const r of g.rows) rows.push([st.month, g.company, r.employee, r.position, r.no, r.job, r.issued, r.status, r.paidDate, r.subtotal.toFixed(2), r.vat.toFixed(2), r.total.toFixed(2), r.wht.toFixed(2), r.net.toFixed(2)]);
  return toCsv(["Month", "Customer", "Crew", "Position", "Invoice no", "Job", "Issued", "Status", "Paid on", "Subtotal", "VAT", "Total", "WHT", "Net"], rows);
}

export const monthOf = (dayStr) => (dayStr || "").slice(0, 7);
