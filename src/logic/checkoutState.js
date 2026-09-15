// Checkout state: what is out, what came back, what is missing.
//
// `checkouts` is an append-only event log. Event shapes (see the data model):
//   { id, jobId|null, requestId|null, eqId, qty, employeeId, employeeName, ts,
//     type: "pick" | "checkout" (legacy) | "barcode_pick"          -> units leave
//           "return" | "barcode_return"                            -> units come back
//           "lost"                                                 -> units written off (admin)
//           "void"                                                 -> tombstone of an undone event (qty 0)
//     condition?: "ok" | "damaged" | "missing" | "lost" | "written_off", note?, adminApproved?, by? }
//
// State is COUNT based (P1-1): per eqId, out = picked - returned - lost. A partial
// return leaves the remainder out as "missing n" with the crew member who picked it.
//
// "both" verification mode writes one photo-lane event (pick/return) AND one
// barcode-lane event (barcode_pick/barcode_return) for the same units, so a
// lane-blind sum would double count. Each lane is summed separately and the
// item total is the MAX of the two lanes.
//
// Daily-return mode (P1-2): events are bucketed by PRODUCTION day, which starts at
// `dayStartHour` (default 05:00 local) instead of midnight, so a night shoot that
// picks at 19:00 and wraps at 01:00 is still "today". Independently of the bucket,
// anything still out is ALWAYS returnable: `out` is cumulative, never date-filtered,
// so gear can never be stranded with no return button.

export const isPickEvt = (type) => type === "pick" || type === "checkout" || type === "barcode_pick";
export const isReturnEvt = (type) => type === "return" || type === "barcode_return";
export const isLostEvt = (type) => type === "lost";
export const isVoidEvt = (type) => type === "void";
const isBarcodeLane = (type) => type === "barcode_pick" || type === "barcode_return";

export const DEFAULT_DAY_START_HOUR = 5;
export const DEFAULT_GEO_THRESHOLD_M = 50;

// Units an event moves. Every event written by the app carries qty; an event
// without one (very old data) is one unit. qty 0 is only ever a void tombstone.
const qtyOf = (c) => { if (!c || c.qty === undefined || c.qty === null) return 1; const q = Number(c.qty); return Number.isFinite(q) && q > 0 ? q : 0; };

// Calendar date (YYYY-MM-DD) of a timestamp in `tz`.
export function dateInTz(ts, tz) {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "Asia/Bangkok" }).format(new Date(ts)); }
  catch { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
}

// Production day of a timestamp: the calendar day it falls on after shifting the
// clock back by `dayStartHour` hours. 2026-09-17 01:30 with a 05:00 start -> 2026-09-16.
export function productionDay(ts, tz, dayStartHour = DEFAULT_DAY_START_HOUR) {
  const h = Number.isFinite(+dayStartHour) ? Math.min(23, Math.max(0, +dayStartHour)) : DEFAULT_DAY_START_HOUR;
  return dateInTz(ts - h * 3600000, tz);
}

// Does a checkout event belong to this job (or approved-request pseudo-job)?
export function evtMatchesJob(c, job) {
  if (!c || !job) return false;
  return job.__reqId ? c.requestId === job.__reqId : c.jobId === job.id;
}

// Per-eqId counts over a list of events (already filtered to one job).
// `todayKey` + `dayOf(ts)` are used to also count picks made TODAY (daily mode).
export function itemCounts(events, { todayKey, dayOf } = {}) {
  const per = {};
  const get = (eqId) => per[eqId] || (per[eqId] = {
    photoPicked: 0, barcodePicked: 0, photoReturned: 0, barcodeReturned: 0,
    photoPickedToday: 0, barcodePickedToday: 0, lost: 0,
    missingFlag: false, lastPick: null, lastPickTs: 0,
  });
  for (const c of events || []) {
    if (!c || !c.eqId || isVoidEvt(c.type)) continue;
    const it = get(c.eqId);
    const q = qtyOf(c);
    const today = !!(todayKey && dayOf && dayOf(c.ts) === todayKey);
    if (isPickEvt(c.type)) {
      if (isBarcodeLane(c.type)) { it.barcodePicked += q; if (today) it.barcodePickedToday += q; }
      else { it.photoPicked += q; if (today) it.photoPickedToday += q; }
      if ((c.ts || 0) >= it.lastPickTs) { it.lastPickTs = c.ts || 0; it.lastPick = c; }
    } else if (isReturnEvt(c.type)) {
      if (isBarcodeLane(c.type)) it.barcodeReturned += q; else it.photoReturned += q;
      if (c.condition === "missing") it.missingFlag = true;
    } else if (isLostEvt(c.type)) {
      it.lost += q;
    }
  }
  const out = {};
  for (const [eqId, it] of Object.entries(per)) {
    const picked = Math.max(it.photoPicked, it.barcodePicked);
    const returned = Math.max(it.photoReturned, it.barcodeReturned);
    const pickedToday = Math.max(it.photoPickedToday, it.barcodePickedToday);
    const outQty = Math.max(0, picked - returned - it.lost);
    out[eqId] = {
      picked, returned, lost: it.lost, out: outQty, pickedToday,
      // partially back (or a return explicitly flagged some units missing) and still short
      missing: outQty > 0 && (returned > 0 || it.lost > 0 || it.missingFlag),
      owner: it.lastPick ? { employeeId: it.lastPick.employeeId, employeeName: it.lastPick.employeeName, ts: it.lastPick.ts, jobName: it.lastPick.jobName || null } : null,
      lanes: { photoPicked: it.photoPicked, barcodePicked: it.barcodePicked, photoReturned: it.photoReturned, barcodeReturned: it.barcodeReturned, photoPickedToday: it.photoPickedToday, barcodePickedToday: it.barcodePickedToday },
    };
  }
  return out;
}

// Full state of a job for the checkout screens.
//   opts: { tz, dayStartHour, now (ms, default Date.now()), todayKey (override the production day) }
// Returns { mode, items: {eqId -> counts}, pickedIds, returnedIds, allPicked, allReturned, outCount, outUnits }
//   pickedIds   = eqIds the pick screen should treat as done
//                 (span: ever picked; daily: picked this production day OR still out)
//   returnedIds = eqIds with nothing out any more (picked at least once)
export function jobCheckoutState(job, checkouts, opts = {}) {
  const mode = (job && job.checkoutMode) || "span";
  const tz = opts.tz;
  const dayStartHour = opts.dayStartHour ?? DEFAULT_DAY_START_HOUR;
  const todayKey = opts.todayKey || productionDay(opts.now ?? Date.now(), tz, dayStartHour);
  const events = (checkouts || []).filter(c => evtMatchesJob(c, job));
  const items = itemCounts(events, mode === "daily" ? { todayKey, dayOf: (ts) => productionDay(ts, tz, dayStartHour) } : {});
  const assigned = (job && job.assignedEquipment) || [];
  const pickedIds = new Set();
  const returnedIds = new Set();
  let outCount = 0, outUnits = 0;
  for (const [eqId, it] of Object.entries(items)) {
    const pickedForScreen = mode === "daily" ? (it.pickedToday > 0 || it.out > 0) : it.picked > 0;
    if (pickedForScreen) pickedIds.add(eqId);
    // daily: "returned" means today's pick came back (yesterday's closed loop is not today's state)
    if (it.out === 0 && (mode === "daily" ? it.pickedToday > 0 : it.picked > 0)) returnedIds.add(eqId);
    if (it.out > 0) { outCount++; outUnits += it.out; }
  }
  const assignedIds = assigned.map(ae => ae.eqId);
  const allPicked = assignedIds.length > 0 && assignedIds.every(id => pickedIds.has(id));
  const allReturned = assignedIds.length > 0 && assignedIds.every(id => returnedIds.has(id));
  return { mode, items, pickedIds, returnedIds, allPicked, allReturned, outCount, outUnits };
}

// Units of `eqId` still out on this job.
export const outstandingQty = (state, eqId) => (state && state.items[eqId] ? state.items[eqId].out : 0);

// Latest pick event of `eqId` on this job that still has units out. In daily mode
// the match ignores the calendar date on purpose (P1-2): a return at 01:00 pairs
// with the 19:00 pick.
export function latestOpenPick(job, checkouts, eqId) {
  const st = jobCheckoutState(job, checkouts, {});
  if (outstandingQty(st, eqId) <= 0) return null;
  const picks = (checkouts || []).filter(c => evtMatchesJob(c, job) && c.eqId === eqId && isPickEvt(c.type) && !isVoidEvt(c.type));
  return picks.sort((a, b) => (b.ts || 0) - (a.ts || 0))[0] || null;
}

// Lane completion for the item row (photo lane / barcode lane), pick or return.
export function laneDone(state, eqId, lane, isReturn) {
  const it = state && state.items[eqId];
  if (!it) return false;
  const L = it.lanes;
  if (!isReturn) {
    if (state.mode === "daily") {
      if (it.out > 0) return true; // still out from an earlier production day: cannot pick again
      return lane === "barcode" ? L.barcodePickedToday > 0 : L.photoPickedToday > 0;
    }
    return lane === "barcode" ? L.barcodePicked > 0 : L.photoPicked > 0;
  }
  // return: this lane has closed every unit that left (lost units need no return)
  const laneReturned = lane === "barcode" ? L.barcodeReturned : L.photoReturned;
  return it.picked > 0 && laneReturned + it.lost >= it.picked;
}

// Still-out list across all jobs (dashboard / admin page), overdue first.
//   jobs: array of jobs (pseudo-jobs allowed), todayStr for overdue
// Returns [{ job, eqId, out, missing, owner, pickedAt, overdue, dueDate }]
export function stillOutAcrossJobs(jobs, checkouts, { todayStr, effReturnDate } = {}) {
  const rows = [];
  for (const job of jobs || []) {
    const st = jobCheckoutState(job, checkouts, {});
    const dueDate = effReturnDate ? effReturnDate(job) : null;
    const overdue = !!(dueDate && todayStr && dueDate < todayStr);
    for (const [eqId, it] of Object.entries(st.items)) {
      if (it.out <= 0) continue;
      rows.push({ job, eqId, out: it.out, missing: it.missing, owner: it.owner, pickedAt: it.owner ? it.owner.ts : 0, overdue, dueDate });
    }
  }
  return rows.sort((a, b) => (b.overdue ? 1 : 0) - (a.overdue ? 1 : 0) || b.pickedAt - a.pickedAt);
}

// Geo gate for a crew return (P1-5). The tolerance is the configured radius plus
// the GPS accuracy both fixes reported, so a 45 m fix with ±20 m accuracy is not
// bounced. A configured home base (the shop) is a second accepted anchor.
//   returns { ok, distance (m, from pickup, null if unknown), homeDistance, threshold, tolerance, reason }
//   reason: "ok" | "no-return-gps" | "no-pickup-gps" | "too-far"
export function geoGate({ returnLoc, pickupLoc, homeBase, thresholdM, haversine }) {
  const threshold = Number.isFinite(+thresholdM) && +thresholdM > 0 ? +thresholdM : DEFAULT_GEO_THRESHOLD_M;
  const acc = (l) => (l && Number.isFinite(+l.acc) && +l.acc > 0 ? +l.acc : 0);
  const has = (l) => l && Number.isFinite(+l.lat) && Number.isFinite(+l.lng);
  if (!has(returnLoc)) return { ok: false, distance: null, homeDistance: null, threshold, tolerance: threshold, reason: "no-return-gps" };
  const dist = (a, b) => Math.round(haversine(+a.lat, +a.lng, +b.lat, +b.lng));
  const distance = has(pickupLoc) ? dist(pickupLoc, returnLoc) : null;
  const homeDistance = has(homeBase) ? dist(homeBase, returnLoc) : null;
  const tolerance = threshold + acc(returnLoc) + (distance !== null ? acc(pickupLoc) : acc(homeBase));
  if (distance !== null && distance <= threshold + acc(returnLoc) + acc(pickupLoc)) return { ok: true, distance, homeDistance, threshold, tolerance, reason: "ok" };
  if (homeDistance !== null && homeDistance <= threshold + acc(returnLoc) + acc(homeBase)) return { ok: true, distance, homeDistance, threshold, tolerance, reason: "ok" };
  if (distance === null && homeDistance === null) return { ok: false, distance, homeDistance, threshold, tolerance, reason: "no-pickup-gps" };
  return { ok: false, distance, homeDistance, threshold, tolerance, reason: "too-far" };
}

// Tombstone for undoing an event made this session (P1-4). The server keeps
// KV-only ids on PUT, so filtering the event out client-side would resurrect it
// on the next load; overwriting the same id with a qty-0 "void" event is the only
// removal the merge rules persist. Every reader ignores type "void".
export function voidEvent(evt, by) {
  return { ...evt, type: "void", voidedType: evt.type, qty: 0, voidedAt: Date.now(), voidedBy: by || evt.employeeId || null };
}

// Human label of a return condition (key for t()).
export const CONDITIONS = ["ok", "damaged", "missing"];
export const conditionKey = (cond) => ({ ok: "condOk", damaged: "condDamaged", missing: "condMissing", lost: "condLost", written_off: "condWrittenOff" })[cond] || null;
