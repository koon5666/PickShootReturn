// ONE availability model for the whole app (equipment badges, assign modal,
// dashboard, crew request picker, crew gear tab, job-edit conflict check).
// Pure functions, no React, no globals: unit-tested in availability.test.js.
//
//   available(eq, date) = total
//     - units held by OTHER Confirmed jobs whose gear window covers `date`
//       (span mode: [effPickupDate .. effReturnDate] inclusive; daily mode: shoot days)
//     - units picked and not yet returned (count-based per job/request + eqId,
//       from the checkout log; counted for any date >= today, whoever holds them,
//       even when the job record is gone or Cancelled)
//     - units on approved gear-request loans covering `date`
//     - units in OPEN damage reports (out of service until the report is resolved)
//   Pencil jobs are SOFT holds: reported separately, never subtracted.
//   The result is NOT clamped: a negative number is an over-booking the UI must show.
//
// Every row carries `reasons` so the UI can say WHY ("1 still out on TVC Toyota").

export const isPickEvt = (type) => type === "pick" || type === "checkout" || type === "barcode_pick";
export const isReturnEvt = (type) => type === "return" || type === "barcode_return";
const isBarcodeEvt = (type) => type === "barcode_pick" || type === "barcode_return";

export const jobFirstDate = (j) => [...((j && j.dates) || [])].sort()[0] || null;
export const jobLastDate = (j) => [...((j && j.dates) || [])].sort().slice(-1)[0] || null;
// Effective pickup/return window of a job: admin may open pickup before the
// first shoot day and allow returns after the last shoot day.
export const effPickupDate = (j) => (j.pickupDate && jobFirstDate(j) && j.pickupDate < jobFirstDate(j)) ? j.pickupDate : jobFirstDate(j);
export const effReturnDate = (j) => (j.returnDate && jobLastDate(j) && j.returnDate > jobLastDate(j)) ? j.returnDate : jobLastDate(j);

// YYYY-MM-DD arithmetic without timezone drift (UTC-based on the string).
export function addDays(ds, n) {
  const [y, m, d] = ds.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}
export function daysBetween(a, b) {
  const p = (s) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((p(b) - p(a)) / 86400000);
}
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// Gear-holding window of a job, with optional admin buffer days (pickup D-n, return D+n).
export function jobWindow(job, opts = {}) {
  const first = effPickupDate(job), last = effReturnDate(job);
  if (!first || !last) return null;
  const pb = Math.max(0, opts.pickupBuffer | 0), rb = Math.max(0, opts.returnBuffer | 0);
  return { from: pb ? addDays(first, -pb) : first, to: rb ? addDays(last, rb) : last };
}
// Every date on which the job holds its gear (span: whole window; daily: shoot days only).
export function jobHoldDates(job, opts = {}) {
  if ((job.checkoutMode || "span") === "daily") return [...(job.dates || [])].sort();
  const w = jobWindow(job, opts);
  if (!w) return [];
  const out = [];
  for (let d = w.from, guard = 0; d <= w.to && guard < 400; d = addDays(d, 1), guard++) out.push(d);
  return out;
}
export function jobHoldsOn(job, date, opts = {}) {
  if (!job || !date) return false;
  if ((job.checkoutMode || "span") === "daily") return (job.dates || []).includes(date);
  const w = jobWindow(job, opts);
  return !!w && date >= w.from && date <= w.to;
}

// Units of a request that are on loan on `date` (approved requests only).
const reqItems = (req) => (req.items && req.items.length ? req.items : (req.eqId ? [{ eqId: req.eqId, qty: req.qty }] : []))
  .map(it => ({ eqId: it.eqId, qty: Math.max(0, +it.qty || 1) }));
export const reqRef = (req) => `req:${req.id}`;
export const reqLabel = (req) => req.purpose === "work" ? (req.jobName || req.productionName || "Work") : "Personal / Practice";

// ── Still-out units from the append-only checkout log ────────────────────────
// Keyed by holder (jobId, or `req:<requestId>`) + eqId. Count-based: sum of pick
// qty minus sum of return qty, per verification lane (photo lane = pick/checkout/
// return, barcode lane = barcode_pick/barcode_return) so "both" mode, which writes
// one event per lane, does not double count. Out = the larger lane balance.
export function stillOutUnits(checkouts) {
  const map = new Map();
  for (const c of checkouts || []) {
    if (!c || !c.eqId) continue;
    const pick = isPickEvt(c.type), ret = isReturnEvt(c.type);
    if (!pick && !ret) continue;
    const holder = c.jobId || (c.requestId ? `req:${c.requestId}` : null);
    if (!holder) continue;
    const key = `${holder}::${c.eqId}`;
    let e = map.get(key);
    if (!e) { e = { holder, jobId: c.jobId || null, requestId: c.requestId || null, eqId: c.eqId, photo: 0, barcode: 0, pickedAt: 0, pickedBy: null, pickedById: null, jobName: null }; map.set(key, e); }
    const lane = isBarcodeEvt(c.type) ? "barcode" : "photo";
    const q = Math.max(0, +c.qty || 1);
    e[lane] += pick ? q : -q;
    if (pick && (c.ts || 0) >= e.pickedAt) { e.pickedAt = c.ts || 0; e.pickedBy = c.employeeName || e.pickedBy; e.pickedById = c.employeeId || e.pickedById; e.jobName = c.jobName || e.jobName; }
  }
  const out = [];
  for (const e of map.values()) {
    const qty = Math.max(0, e.photo, e.barcode);
    if (qty > 0) out.push({ holder: e.holder, jobId: e.jobId, requestId: e.requestId, eqId: e.eqId, qty, pickedAt: e.pickedAt, pickedBy: e.pickedBy, pickedById: e.pickedById, jobName: e.jobName });
  }
  return out;
}

// Dashboard "Not Returned" rows: still-out units joined to the job / request /
// equipment records when they exist (a deleted or Cancelled job still lists).
export function stillOutList({ checkouts, jobs = [], equipment = [], equipmentRequests = [], today: todayStr, now } = {}) {
  const t = todayStr || localToday();
  const nowMs = now || Date.now();
  const rows = stillOutUnits(checkouts).map(u => {
    const job = u.jobId ? jobs.find(j => j.id === u.jobId) || null : null;
    const req = u.requestId ? equipmentRequests.find(r => r.id === u.requestId) || null : null;
    const eq = equipment.find(e => e.id === u.eqId) || null;
    const dueDate = job ? effReturnDate(job) : req ? [...(req.useDates || [])].sort().slice(-1)[0] || null : null;
    const overdue = !!dueDate && dueDate < t;
    return {
      key: `${u.holder}::${u.eqId}`, ...u, job, request: req, eq,
      eqName: eq ? eq.name : u.eqId,
      jobName: job ? job.name : req ? reqLabel(req) : (u.jobName || u.jobId || "?"),
      jobGone: !!u.jobId && !job,
      dueDate, overdue, dueToday: !!dueDate && dueDate === t,
      daysOverdue: overdue ? daysBetween(dueDate, t) : 0,
      daysOut: u.pickedAt ? Math.max(0, Math.floor((nowMs - u.pickedAt) / 86400000)) : 0,
    };
  });
  return rows.sort((a, b) => (b.overdue ? 1 : 0) - (a.overdue ? 1 : 0) || (b.daysOverdue - a.daysOverdue) || b.pickedAt - a.pickedAt);
}

export const isOpenReport = (r) => !!r && r.status === "open";

// ── The availability function ────────────────────────────────────────────────
// ctx = { jobs, checkouts, equipmentRequests, reports, today }
// opts = { excludeJobId, excludeRequestId, pickupBuffer, returnBuffer }
export function availability(equipment, date, ctx = {}, opts = {}) {
  const jobs = ctx.jobs || [], checkouts = ctx.checkouts || [], reqs = ctx.equipmentRequests || [], reports = ctx.reports || [];
  const t = ctx.today || localToday();
  const d = date || t;
  const future = d >= t;
  const buf = { pickupBuffer: opts.pickupBuffer, returnBuffer: opts.returnBuffer };
  const out = stillOutUnits(checkouts);
  const outBy = new Map(); // holder -> Map(eqId -> unit)
  for (const u of out) { if (!outBy.has(u.holder)) outBy.set(u.holder, new Map()); outBy.get(u.holder).set(u.eqId, u); }

  return (equipment || []).map(eq => {
    const reasons = [];
    let hardJobs = 0, hardOut = 0, hardLoans = 0, hardDamage = 0, pencil = 0;
    const seenHolders = new Set();

    for (const job of jobs) {
      if (!job) continue;
      seenHolders.add(job.id);
      if (job.id === opts.excludeJobId) continue;
      const assigned = (job.assignedEquipment || []).filter(ae => ae.eqId === eq.id).reduce((s, ae) => s + (+ae.qty || 0), 0);
      const holds = jobHoldsOn(job, d, buf);
      const held = job.status === "Confirmed" && holds ? assigned : 0;
      const u = future ? outBy.get(job.id)?.get(eq.id) : null;
      const outQty = u ? u.qty : 0;
      if (held > 0) { hardJobs += held; reasons.push({ kind: "job", qty: held, jobId: job.id, label: job.name, since: effPickupDate(job), dueDate: effReturnDate(job), status: job.status }); }
      if (outQty > held) { const q = outQty - held; hardOut += q; reasons.push({ kind: "out", qty: q, jobId: job.id, label: job.name, since: u.pickedAt, dueDate: effReturnDate(job), employeeName: u.pickedBy, overdue: !!effReturnDate(job) && effReturnDate(job) < t, status: job.status }); }
      if (job.status === "Pencil" && holds && assigned > 0) { pencil += assigned; reasons.push({ kind: "pencil", qty: assigned, jobId: job.id, label: job.name, since: effPickupDate(job), dueDate: effReturnDate(job), status: job.status }); }
    }
    for (const req of reqs) {
      if (!req) continue;
      const holder = reqRef(req);
      seenHolders.add(holder);
      if (req.id === opts.excludeRequestId) continue;
      const onLoan = req.status === "approved" && (req.useDates || []).includes(d) ? reqItems(req).filter(it => it.eqId === eq.id).reduce((s, it) => s + it.qty, 0) : 0;
      const u = future ? outBy.get(holder)?.get(eq.id) : null;
      const outQty = u ? u.qty : 0;
      if (onLoan > 0) { hardLoans += onLoan; reasons.push({ kind: "loan", qty: onLoan, requestId: req.id, label: reqLabel(req), employeeName: req.employeeName, since: [...(req.useDates || [])].sort()[0], dueDate: [...(req.useDates || [])].sort().slice(-1)[0] }); }
      if (outQty > onLoan) { const q = outQty - onLoan; hardOut += q; reasons.push({ kind: "out", qty: q, requestId: req.id, label: reqLabel(req), employeeName: u.pickedBy, since: u.pickedAt, dueDate: [...(req.useDates || [])].sort().slice(-1)[0] }); }
    }
    // Still-out units whose job / request record no longer exists (deleted): the
    // gear is physically out, the log is the only record, so it still counts.
    if (future) {
      for (const [holder, m] of outBy) {
        if (seenHolders.has(holder)) continue;
        if (holder === opts.excludeJobId || holder === (opts.excludeRequestId ? `req:${opts.excludeRequestId}` : null)) continue;
        const u = m.get(eq.id);
        if (u) { hardOut += u.qty; reasons.push({ kind: "out", qty: u.qty, jobId: u.jobId, requestId: u.requestId, label: u.jobName || u.jobId || u.requestId, employeeName: u.pickedBy, since: u.pickedAt, gone: true }); }
      }
      for (const r of reports) {
        if (!isOpenReport(r) || r.eqId !== eq.id) continue;
        const q = Math.max(1, +r.qty || 1);
        hardDamage += q;
        reasons.push({ kind: "damage", qty: q, reportId: r.id, label: r.description || "", jobId: r.jobId || null, since: r.ts, employeeName: (r.reportedBy && r.reportedBy.name) || (typeof r.reportedBy === "string" ? r.reportedBy : null) });
      }
    }
    const total = +eq.total || 0;
    const taken = hardJobs + hardOut + hardLoans + hardDamage;
    return { ...eq, total, taken, available: total - taken, hard: { jobs: hardJobs, out: hardOut, loans: hardLoans, damage: hardDamage }, pencil, reasons, date: d };
  });
}

// Availability across a multi-day span = the WORST (minimum) available count on
// any day in the span, with that day's reasons. `pencil` is the max soft demand.
export function availabilitySpan(equipment, dates, ctx = {}, opts = {}) {
  const days = (dates && dates.length) ? [...new Set(dates)].sort() : [ctx.today || localToday()];
  const perDay = days.map(d => { const m = {}; availability(equipment, d, ctx, opts).forEach(e => { m[e.id] = e; }); return m; });
  return (equipment || []).map(eq => {
    let worst = null, pencil = 0;
    for (let i = 0; i < days.length; i++) {
      const a = perDay[i][eq.id];
      if (!a) continue;
      if (!worst || a.available < worst.available) worst = a;
      if (a.pencil > pencil) pencil = a.pencil;
    }
    return worst ? { ...worst, worstDate: worst.date, pencil } : { ...eq, total: +eq.total || 0, taken: 0, available: +eq.total || 0, hard: { jobs: 0, out: 0, loans: 0, damage: 0 }, pencil: 0, reasons: [], worstDate: null };
  });
}

// P1-9: does saving `job` (new dates / status / pickup / return) over-commit any of
// its own assigned gear? Returns one entry per item that no longer fits, naming
// the colliders. Pencil jobs only get "soft" conflicts (they hold nothing hard).
export function jobConflicts(job, equipment, ctx = {}, opts = {}) {
  const need = (job.assignedEquipment || []).filter(ae => (+ae.qty || 0) > 0);
  if (!need.length) return [];
  const dates = jobHoldDates(job, opts);
  if (!dates.length) return [];
  const eqs = equipment.filter(e => need.some(ae => ae.eqId === e.id));
  const span = availabilitySpan(eqs, dates, ctx, { ...opts, excludeJobId: job.id });
  const conflicts = [];
  for (const ae of need) {
    const a = span.find(x => x.id === ae.eqId);
    if (!a) continue;
    const qty = +ae.qty || 0;
    const shortBy = qty - a.available;
    const softShortBy = qty - (a.available - a.pencil);
    if (shortBy > 0) conflicts.push({ eq: a, eqId: a.id, need: qty, available: a.available, shortBy, soft: false, worstDate: a.worstDate, reasons: a.reasons });
    else if (softShortBy > 0) conflicts.push({ eq: a, eqId: a.id, need: qty, available: a.available, shortBy: softShortBy, soft: true, worstDate: a.worstDate, reasons: a.reasons.filter(r => r.kind === "pencil") });
  }
  return conflicts;
}

// Units of `eqId` still out (any holder). Used by the delete guards.
export const unitsOutForEquipment = (checkouts, eqId) => stillOutUnits(checkouts).filter(u => u.eqId === eqId).reduce((s, u) => s + u.qty, 0);
export const unitsOutForJob = (checkouts, jobId) => stillOutUnits(checkouts).filter(u => u.jobId === jobId).reduce((s, u) => s + u.qty, 0);
