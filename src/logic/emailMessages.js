// Email notifications (2026-10-01). Koon: "LINE gets only the daily job summary;
// equipment requests, approvals, job add / edit / declined / cancelled and the
// rest go by email, with every detail in the body and the link to the site, so
// the crew sees everything right away without opening the app."
//
// Each builder returns { to, message } for api.email(): `to` names WHO
// ({ admin } = the address in Settings, { employeeIds }, { allCrew }) and the
// server resolves the addresses (functions/_lib/email.js) and renders the one
// template. `message` is structured (heading, intro, sections of label/value
// rows or plain items, one link), never HTML. Labels are English / Thai; the
// values are what the house typed. Pure, unit-tested in emailMessages.test.js.

import { normalizeCrew, compressDays } from "./roster.js";

const L = (en, th) => `${en} / ${th}`;
export const APP_PATH = "/";

// "Wed 1 Oct 2026" from a YYYY-MM-DD (no device timezone involved).
export function fmtDay(ds) {
  if (!ds || !/^\d{4}-\d{2}-\d{2}$/.test(ds)) return ds || "";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(new Date(ds + "T12:00:00Z")).replace(",", "");
}
export function fmtWhen(ts, tz = "Asia/Bangkok") {
  const d = new Date(typeof ts === "number" ? ts : Date.parse(ts));
  if (Number.isNaN(d.getTime())) return "";
  try { return new Intl.DateTimeFormat("en-GB", { timeZone: tz, dateStyle: "medium", timeStyle: "short" }).format(d); }
  catch { return d.toISOString(); }
}
// "1-3, 7 Oct 2026 · 2-4 Nov 2026" (the run style of the LINE recap).
export function fmtDateRange(dates) {
  const byMonth = new Map();
  for (const ds of [...(dates || [])].filter(Boolean).sort()) {
    const ym = ds.slice(0, 7);
    if (!byMonth.has(ym)) byMonth.set(ym, []);
    byMonth.get(ym).push(parseInt(ds.slice(8, 10), 10));
  }
  return [...byMonth.entries()].map(([ym, days]) => {
    const [y, m] = ym.split("-").map(Number);
    const mon = new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
    return `${compressDays(days).replace(/,/g, ", ")} ${mon} ${y}`;
  }).join(" · ");
}

const nameOf = (employees, id) => ((employees || []).find(e => e && String(e.id) === String(id)) || {}).name || id || "";
const eqNameOf = (equipment, id) => ((equipment || []).find(e => e && e.id === id) || {}).name || id || "";
const placeOf = (loc, city) => [loc, city].filter(v => String(v || "").trim()).join(" · ");
const itemsOf = (req) => (req.items && req.items.length ? req.items : [{ eqName: req.eqName, qty: req.qty }])
  .map(it => `${it.eqName || it.eqId || "?"} × ${+it.qty || 1}`);

// ── JOBS ────────────────────────────────────────────────────────────────────
const STATUS_TH = { Confirmed: "ยืนยัน", Pencil: "เพนซิล", Cancelled: "ยกเลิก", Declined: "ปฏิเสธ" };
const statusText = (s) => s ? `${s}${STATUS_TH[s] ? ` (${STATUS_TH[s]})` : ""}` : "-";

export function jobHeadline(job, changes) {
  if ((changes || []).includes("new")) return { en: "New job", th: "งานใหม่", tone: job.status === "Cancelled" || job.status === "Declined" ? "bad" : "info" };
  if ((changes || []).includes("status")) {
    if (job.status === "Confirmed") return { en: "Job confirmed", th: "ยืนยันงานแล้ว", tone: "good" };
    if (job.status === "Cancelled") return { en: "Job cancelled", th: "ยกเลิกงาน", tone: "bad" };
    if (job.status === "Declined") return { en: "Job declined", th: "งานไม่ได้รับ", tone: "bad" };
    if (job.status === "Pencil") return { en: "Job back on pencil", th: "งานกลับเป็นเพนซิล", tone: "warn" };
  }
  return { en: "Job updated", th: "แก้ไขงาน", tone: "info" };
}

function crewRows(job, employees) {
  return normalizeCrew(job && job.crew).map(r => [nameOf(employees, r.employeeId), [r.role, r.callTime ? `call ${r.callTime}` : "", r.pickupTime ? `pickup ${r.pickupTime}` : ""].filter(Boolean).join(" · ") || "-"]);
}

function dayRows(job) {
  const ov = job.dateOverrides || {};
  const dates = [...(job.dates || [])].filter(Boolean).sort();
  const rows = [];
  if (job.pickupDate && dates[0] && job.pickupDate < dates[0]) rows.push([fmtDay(job.pickupDate), L("Gear pickup", "รับอุปกรณ์")]);
  for (const ds of dates) {
    const o = ov[ds] || {};
    rows.push([fmtDay(ds), [L("Shoot", "ถ่าย"), placeOf(o.location || job.location, o.locationCity || job.locationCity), o.shootTime || job.shootTime].filter(Boolean).join(" · ")]);
  }
  if (job.returnDate && dates.length && job.returnDate > dates[dates.length - 1]) rows.push([fmtDay(job.returnDate), L("Gear return", "คืนอุปกรณ์")]);
  return rows;
}

// Before → after for each change jobChangeSet found.
export function jobChangeRows(before, after, changes, employees) {
  if (!before) return [];
  const rows = [];
  const arrow = (a, b) => `${a || "-"} → ${b || "-"}`;
  if (changes.includes("status")) rows.push([L("Status", "สถานะ"), arrow(statusText(before.status), statusText(after.status))]);
  if (changes.includes("dates")) {
    const bd = fmtDateRange(before.dates), ad = fmtDateRange(after.dates);
    if (bd !== ad) rows.push([L("Shoot days", "วันถ่าย"), arrow(bd, ad)]);
    if ((before.pickupDate || "") !== (after.pickupDate || "")) rows.push([L("Gear pickup", "วันรับอุปกรณ์"), arrow(fmtDay(before.pickupDate), fmtDay(after.pickupDate))]);
    if ((before.returnDate || "") !== (after.returnDate || "")) rows.push([L("Gear return", "วันคืนอุปกรณ์"), arrow(fmtDay(before.returnDate), fmtDay(after.returnDate))]);
  }
  if (changes.includes("location")) {
    const b = placeOf(before.location, before.locationCity), a = placeOf(after.location, after.locationCity);
    if (b !== a) rows.push([L("Location", "สถานที่"), arrow(b, a)]);
    if (JSON.stringify(before.dateOverrides || {}) !== JSON.stringify(after.dateOverrides || {})) rows.push([L("Per-day details", "รายละเอียดรายวัน"), L("changed, see Day by day below", "เปลี่ยน ดูรายวันด้านล่าง")]);
  }
  if (changes.includes("time")) rows.push([L("Shoot time", "ช่วงเวลาถ่าย"), arrow(before.shootTime, after.shootTime)]);
  if (changes.includes("roster")) {
    const b = new Map(normalizeCrew(before.crew).map(r => [r.employeeId, r]));
    const a = new Map(normalizeCrew(after.crew).map(r => [r.employeeId, r]));
    const added = [...a.keys()].filter(id => !b.has(id)).map(id => nameOf(employees, id));
    const removed = [...b.keys()].filter(id => !a.has(id)).map(id => nameOf(employees, id));
    const moved = [...a.keys()].filter(id => b.has(id) && JSON.stringify(a.get(id)) !== JSON.stringify(b.get(id))).map(id => nameOf(employees, id));
    if (added.length) rows.push([L("Crew added", "เพิ่มทีมงาน"), added.join(", ")]);
    if (removed.length) rows.push([L("Crew removed", "ถอนทีมงาน"), removed.join(", ")]);
    if (moved.length) rows.push([L("Crew details changed", "แก้รายละเอียดทีมงาน"), moved.join(", ")]);
  }
  return rows;
}

// Job added / edited / confirmed / declined / cancelled: every crew member.
export function jobEmail(job, { before = null, changes = ["new"], employees = [], equipment = [], by = "" } = {}) {
  const h = jobHeadline(job, changes);
  const range = fmtDateRange(job.dates);
  const subject = `[${h.en}] ${job.name || "Job"}${job.production ? ` · ${job.production}` : ""}${range ? ` · ${range}` : ""}`;
  const crew = crewRows(job, employees);
  const gear = (job.assignedEquipment || []).filter(a => a && a.eqId).map(a => `${eqNameOf(equipment, a.eqId)} × ${+a.qty || 1}`);
  const changeRows = jobChangeRows(before, job, changes, employees);
  // The platform alone ("via Line", the form default) says nothing without a person.
  const contact = String(job.contactPerson || "").trim() ? [job.contactPerson.trim(), job.contactPlatform ? `via ${job.contactPlatform}` : ""].filter(Boolean).join(" ") : "";
  const sections = [];
  if (changeRows.length) sections.push({ title: L("What changed", "สิ่งที่เปลี่ยน"), rows: changeRows });
  sections.push({
    title: L("Job", "งาน"),
    rows: [
      [L("Job", "งาน"), job.name || "-"],
      [L("Production", "โปรดักชั่น"), job.production || "-"],
      [L("Status", "สถานะ"), statusText(job.status)],
      [L("Shoot days", "วันถ่าย"), range ? `${range} (${(job.dates || []).length} day${(job.dates || []).length === 1 ? "" : "s"})` : "-"],
      ...(job.pickupDate ? [[L("Gear pickup", "วันรับอุปกรณ์"), fmtDay(job.pickupDate)]] : []),
      ...(job.returnDate ? [[L("Gear return", "วันคืนอุปกรณ์"), fmtDay(job.returnDate)]] : []),
      [L("Shoot time", "ช่วงเวลาถ่าย"), job.shootTime || "-"],
      [L("Location", "สถานที่"), placeOf(job.location, job.locationCity) || "-"],
      ...(contact ? [[L("Contact", "ผู้ติดต่อ"), contact]] : []),
      ...(by ? [[L("Updated by", "แก้ไขโดย"), by]] : []),
    ],
  });
  const days = dayRows(job);
  if (days.length) sections.push({ title: L("Day by day", "รายวัน"), rows: days });
  sections.push(crew.length ? { title: L("Crew", "ทีมงาน"), rows: crew } : { title: L("Crew", "ทีมงาน"), items: [L("No crew list yet: open to everyone", "ยังไม่ระบุทีมงาน ทุกคนรับงานได้")] });
  sections.push({ title: L("Gear", "อุปกรณ์"), items: gear.length ? gear : [L("No gear assigned yet", "ยังไม่ได้จัดอุปกรณ์")] });
  return {
    to: { allCrew: true },
    message: {
      subject,
      heading: `${L(h.en, h.th)}: ${job.name || "Job"}`,
      intro: (changes || []).includes("new") ? "A new job was added to the calendar. Every detail is below.\nมีงานใหม่ลงปฏิทิน รายละเอียดทั้งหมดอยู่ด้านล่าง"
        : job.status === "Cancelled" || job.status === "Declined" ? "This job is off the calendar. Details below for reference.\nงานนี้ออกจากปฏิทินแล้ว รายละเอียดด้านล่างไว้อ้างอิง"
        : "This job changed. What changed is first, then the full job.\nงานนี้มีการเปลี่ยนแปลง สิ่งที่เปลี่ยนอยู่ด้านบน ตามด้วยรายละเอียดทั้งหมด",
      tone: h.tone,
      sections,
      link: { url: APP_PATH, label: "Open the job in Pick Shoot Return" },
    },
  };
}

// ── GEAR REQUESTS ───────────────────────────────────────────────────────────
function gearRows(req, tz) {
  const work = req.purpose === "work" || (!req.purpose && req.jobName);
  return [
    [L("Crew", "ทีมงาน"), req.employeeName || "-"],
    [L("Purpose", "วัตถุประสงค์"), work ? L("Work", "งาน") : L("Practice", "ฝึกซ้อม")],
    ...(work && req.jobName ? [[L("Job", "งาน"), req.jobName]] : []),
    ...(work && req.productionName ? [[L("Production", "โปรดักชั่น"), req.productionName]] : []),
    [L("Dates of use", "วันที่ใช้"), fmtDateRange(req.useDates) || "-"],
    ...(req.reason ? [[L("Note", "หมายเหตุ"), req.reason]] : []),
    ...(req.requestedAt ? [[L("Requested", "ขอเมื่อ"), fmtWhen(req.requestedAt, tz)]] : []),
  ];
}

export function gearRequestEmail(req, { tz } = {}) {
  const items = itemsOf(req);
  return {
    to: { admin: true },
    message: {
      subject: `[Gear request] ${req.employeeName || "Crew"} · ${items.join(", ")}`.slice(0, 200),
      heading: `${L("Gear request", "ขอเบิกอุปกรณ์")}: ${req.employeeName || ""}`.trim(),
      intro: "A crew member asked for gear. Approve or deny it in the app (Dashboard > Gear requests).\nทีมงานขอเบิกอุปกรณ์ อนุมัติหรือปฏิเสธได้ในแอป",
      tone: "info",
      sections: [
        { title: L("Gear", "อุปกรณ์"), items },
        { title: L("Request", "คำขอ"), rows: gearRows(req, tz) },
        ...((req.useDates || []).length > 1 ? [{ title: L("Each day", "แต่ละวัน"), items: [...req.useDates].sort().map(fmtDay) }] : []),
      ],
      link: { url: APP_PATH, label: "Review the request" },
    },
  };
}

export function gearOutcomeEmail(req, ok, { by = "", tz } = {}) {
  const items = itemsOf(req);
  return {
    to: { employeeIds: [req.employeeId] },
    message: {
      subject: `[Gear request ${ok ? "approved" : "denied"}] ${items.join(", ")}`.slice(0, 200),
      heading: ok ? L("Gear request approved", "อนุมัติคำขอเบิกอุปกรณ์") : L("Gear request denied", "ไม่อนุมัติคำขอเบิกอุปกรณ์"),
      intro: ok ? "Your gear request was approved. Pick the gear up in the app as usual (photo or scan check).\nคำขอของคุณได้รับอนุมัติ รับอุปกรณ์ในแอปตามปกติ"
        : "Your gear request was not approved. Talk to the house if you still need the gear.\nคำขอของคุณไม่ได้รับอนุมัติ ติดต่อร้านหากยังต้องการอุปกรณ์",
      tone: ok ? "good" : "bad",
      sections: [
        { title: L("Gear", "อุปกรณ์"), items },
        { title: L("Request", "คำขอ"), rows: [...gearRows(req, tz), ...(by ? [[ok ? L("Approved by", "อนุมัติโดย") : L("Decided by", "พิจารณาโดย"), by]] : [])] },
      ],
      link: { url: APP_PATH, label: "Open Pick Shoot Return" },
    },
  };
}

// ── EARLY PICKUP / EARLY RETURN ─────────────────────────────────────────────
const earlyLabel = (type) => type === "early-pickup" ? { en: "Early pickup", th: "รับอุปกรณ์ก่อนกำหนด" } : { en: "Early return", th: "คืนอุปกรณ์ก่อนกำหนด" };

function earlyRows(req, job, tz) {
  return [
    [L("Crew", "ทีมงาน"), req.employeeName || "-"],
    [L("Job", "งาน"), req.jobName || (job && job.name) || "-"],
    ...(job && job.production ? [[L("Production", "โปรดักชั่น"), job.production]] : []),
    ...(job ? [[L("Shoot days", "วันถ่าย"), fmtDateRange(job.dates) || "-"]] : []),
    [req.type === "early-pickup" ? L("Wants to pick up on", "ขอรับวันที่") : L("Wants to return on", "ขอคืนวันที่"), fmtDay(req.requestedDate) || "-"],
    ...(req.submittedAt ? [[L("Requested", "ขอเมื่อ"), fmtWhen(req.submittedAt, tz)]] : []),
  ];
}

export function earlyRequestEmail(req, { job = null, tz } = {}) {
  const lab = earlyLabel(req.type);
  return {
    to: { admin: true },
    message: {
      subject: `[${lab.en} request] ${req.employeeName || "Crew"} · ${req.jobName || ""}`.trim(),
      heading: `${L(`${lab.en} request`, `ขอ${lab.th}`)}: ${req.employeeName || ""}`.trim(),
      intro: "Approve or reject it in the app (Dashboard > Approvals).\nอนุมัติหรือปฏิเสธได้ในแอป หน้า Dashboard > คำขออนุมัติ",
      tone: "warn",
      sections: [{ title: L("Request", "คำขอ"), rows: earlyRows(req, job, tz) }],
      link: { url: APP_PATH, label: "Review the request" },
    },
  };
}

export function earlyOutcomeEmail(req, ok, { job = null, by = "", tz } = {}) {
  const lab = earlyLabel(req.type);
  return {
    to: { employeeIds: [req.employeeId] },
    message: {
      subject: `[${lab.en} ${ok ? "approved" : "not approved"}] ${req.jobName || ""}`.trim(),
      heading: `${L(lab.en, lab.th)}: ${ok ? L("approved", "อนุมัติแล้ว") : L("not approved", "ไม่อนุมัติ")}`,
      intro: ok ? "You can go ahead in the app.\nดำเนินการในแอปได้เลย" : "Keep to the job's normal dates, or talk to the house.\nใช้ตามวันปกติของงาน หรือติดต่อร้าน",
      tone: ok ? "good" : "bad",
      sections: [{ title: L("Request", "คำขอ"), rows: [...earlyRows(req, job, tz), ...(by ? [[L("Decided by", "พิจารณาโดย"), by]] : [])] }],
      link: { url: APP_PATH, label: "Open Pick Shoot Return" },
    },
  };
}

// ── RETURNS OUTSIDE THE GPS RADIUS ─────────────────────────────────────────
const dist = (m) => m == null ? "" : m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`;
const CONDITION = { ok: L("OK", "ปกติ"), damaged: L("Damaged", "เสียหาย"), missing: L("Missing parts", "ของไม่ครบ"), lost: L("Lost", "สูญหาย") };

function geoRows(req, tz) {
  return [
    [L("Crew", "ทีมงาน"), req.employeeName || "-"],
    [L("Item", "อุปกรณ์"), `${req.eqName || req.name || req.eqId || "?"} × ${+req.qty || 1}`],
    [L("Job", "งาน"), req.jobName || "-"],
    ...(req.condition ? [[L("Condition", "สภาพ"), CONDITION[req.condition] || req.condition]] : []),
    ...(req.note ? [[L("Note", "หมายเหตุ"), req.note]] : []),
    ...(req.distance != null ? [[L("Distance from pickup spot", "ระยะจากจุดรับ"), dist(req.distance)]] : []),
    ...(req.homeDistance != null ? [[L("Distance from the shop", "ระยะจากร้าน"), dist(req.homeDistance)]] : []),
    ...(req.threshold != null ? [[L("Allowed radius", "รัศมีที่อนุญาต"), dist(req.threshold)]] : []),
    ...(req.submittedAt ? [[L("Returned", "คืนเมื่อ"), fmtWhen(req.submittedAt, tz)]] : []),
  ];
}

export function geoReturnRequestEmail(req, { tz } = {}) {
  return {
    to: { admin: true },
    message: {
      subject: `[Return needs approval] ${req.employeeName || "Crew"} · ${req.eqName || req.name || ""}`.trim(),
      heading: `${L("Return waiting for approval", "การคืนรออนุมัติ")}: ${req.employeeName || ""}`.trim(),
      intro: "This return was made outside the allowed GPS radius (or without a location), so it waits for you. The return photo is in the app (Dashboard > Approvals).\nการคืนนี้อยู่นอกรัศมี GPS (หรือไม่มีตำแหน่ง) จึงรออนุมัติ ดูรูปการคืนได้ในแอป",
      tone: "warn",
      sections: [{ title: L("Return", "การคืน"), rows: geoRows(req, tz) }],
      link: { url: APP_PATH, label: "Review the return" },
    },
  };
}

// One crew member's outcome; `reqs` may be several returns decided together
// ("Approve all" on the dashboard), which become ONE email listing every item.
export function geoReturnOutcomeEmail(reqs, ok, { by = "", tz } = {}) {
  const list = (Array.isArray(reqs) ? reqs : [reqs]).filter(Boolean);
  const req = list[0] || {};
  const many = list.length > 1;
  const itemLine = (r) => [`${r.eqName || r.name || r.eqId || "?"} × ${+r.qty || 1}`, r.jobName, r.condition ? CONDITION[r.condition] || r.condition : "", r.distance != null ? `${dist(r.distance)} from pickup` : ""].filter(Boolean).join(" · ");
  return {
    to: { employeeIds: [req.employeeId] },
    message: {
      subject: `[Return ${ok ? "approved" : "rejected"}] ${many ? `${list.length} items` : (req.eqName || req.name || "")}`.trim(),
      heading: ok ? L("Return approved", "อนุมัติการคืนแล้ว") : L("Return rejected", "ไม่อนุมัติการคืน"),
      intro: ok ? `The gear below is now marked as returned.\nอุปกรณ์ด้านล่างบันทึกว่าคืนแล้ว`
        : "The gear below still counts as out with you. Bring it back to the shop and return it there, or talk to the house.\nอุปกรณ์ด้านล่างยังนับว่าอยู่กับคุณ กรุณานำมาคืนที่ร้าน หรือติดต่อร้าน",
      tone: ok ? "good" : "bad",
      sections: many
        ? [{ title: L(`Items (${list.length})`, `อุปกรณ์ (${list.length})`), items: list.map(itemLine) }, { title: L("Decision", "ผลการพิจารณา"), rows: [[L("Crew", "ทีมงาน"), req.employeeName || "-"], ...(by ? [[L("Decided by", "พิจารณาโดย"), by]] : [])] }]
        : [{ title: L("Return", "การคืน"), rows: [...geoRows(req, tz), ...(by ? [[L("Decided by", "พิจารณาโดย"), by]] : [])] }],
      link: { url: APP_PATH, label: "Open Pick Shoot Return" },
    },
  };
}

// ── DAMAGE REPORT ───────────────────────────────────────────────────────────
export function damageReportEmail(report, { tz } = {}) {
  const who = (report.reportedBy && report.reportedBy.name) || "Crew";
  const photos = (report.photos || []).length;
  return {
    to: { admin: true },
    message: {
      subject: `[Damage report] ${report.eqName || "Gear"} · ${who}`,
      heading: `${L("Damage report", "แจ้งอุปกรณ์เสียหาย")}: ${report.eqName || ""}`.trim(),
      intro: `${who} reported a problem.${photos ? ` ${photos} photo${photos === 1 ? "" : "s"} attached in the app.` : ""}\n${who} แจ้งปัญหาอุปกรณ์${photos ? ` มีรูป ${photos} รูปในแอป` : ""}`,
      tone: "bad",
      sections: [{
        title: L("Report", "รายงาน"),
        rows: [
          [L("Item", "อุปกรณ์"), `${report.eqName || "-"}${report.qty > 1 ? ` × ${report.qty}` : ""}`],
          [L("What happened", "รายละเอียด"), report.description || "-"],
          ...(report.jobName ? [[L("Job", "งาน"), report.jobName]] : []),
          ...(report.production ? [[L("Production", "โปรดักชั่น"), report.production]] : []),
          [L("When", "เมื่อ"), fmtWhen(report.ts, tz) || "-"],
          [L("Reported by", "แจ้งโดย"), who],
        ],
      }],
      link: { url: APP_PATH, label: "Open the report" },
    },
  };
}

// ── INVOICE / DOCUMENT SENT BY A CREW MEMBER ───────────────────────────────
export function invoiceEmail(inv, { name, docNo, total, shareUrl, expiresAt, tz } = {}) {
  return {
    to: { admin: true },
    message: {
      subject: `[Invoice] ${docNo || ""} · ${name || ""} · ฿${Number(total || 0).toLocaleString("en-US")}`.replace(/\s+·\s+·/g, " ·"),
      heading: `${L("Invoice", "ใบแจ้งหนี้")} ${docNo || ""}`.trim(),
      intro: `${name || "A crew member"} sent you this document. The button opens it${expiresAt ? ` (link works until ${fmtWhen(expiresAt, tz)})` : ""}.\n${name || "ทีมงาน"} ส่งเอกสารนี้ให้คุณ กดปุ่มเพื่อเปิดดู`,
      tone: "info",
      sections: [{
        title: L("Document", "เอกสาร"),
        rows: [
          [L("Number", "เลขที่"), docNo || "-"],
          [L("From", "จาก"), name || "-"],
          [L("Job", "งาน"), inv.jobName || "-"],
          ...(inv.productionCompany ? [[L("Bill to", "เรียกเก็บจาก"), inv.productionCompany]] : []),
          [L("Total", "ยอดรวม"), `฿${Number(total || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`],
          [L("Status", "สถานะ"), inv.status || "Pending"],
          ...(inv.dueDate ? [[L("Due", "ครบกำหนด"), fmtDay(inv.dueDate)]] : []),
        ],
      }],
      link: { url: shareUrl || APP_PATH, label: "Open the invoice" },
    },
  };
}
