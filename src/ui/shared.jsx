// Shared UI kernel (P3-8 code split): the API client, actor / time prefs, theme
// helpers, icons, the S style table, hooks, Modal / LazyPhoto / QRScanner and the
// availability wrappers every view uses. App.jsx and every lazy view chunk import
// from here; this file imports no view.
import { useState, useEffect, useRef, createContext, useContext } from "react";
import { LANG } from "../i18n/index.js";
import { availability, availabilitySpan, jobHoldDates } from "../logic/availability.js";
import { roleOptions } from "../logic/positions.js";
import { Dialog } from "../components/dialog.jsx";
import { formatDate } from "../i18n/format.js";
import { kpiPeriod as kpiPeriodAt, kpiScore as kpiScoreAt, kpiEventsInPeriod as kpiEventsInPeriodAt } from "../logic/kpi.js";
import { qrSvg } from "../vendor/qrcodegen.js";

// jsQR (≈50 KB) is loaded on demand the first time a scanner opens (P3-8:
// keeps the decoder out of the main bundle; most sessions never scan).
export let jsQRModule = null;
export const loadJsQR = () => jsQRModule || (jsQRModule = import("jsqr").then(m => m.default || m));

// ─── CONSTANTS ───────────────────────────────────────────────────────────────
export const JOB_STATUSES = ["Pencil", "Confirmed", "Cancelled", "Declined"];
// Global source of truth for job-status chip colors (badge tokens): Confirmed=green, Cancelled=red, Pencil=yellow(amber), Declined=grey.
export const JOB_STATUS_BADGE = { Pencil: "amber", Confirmed: "green", Cancelled: "red", Declined: "gray" };
export const SHOOT_TIMES = ["Day", "Night", "Half Day / Half Night", "Half Night / Half Day"];
export const LOCATIONS = ["Local (Bangkok)", "Out of Town", "Overseas"];

// ─── CLOUD API ───────────────────────────────────────────────────────────────
// Every call is same-origin and rides on the httpOnly session cookie the server
// sets at /api/login (P0-2); nothing here ever carries a PIN except the login /
// PIN-change calls themselves. `j(r)` = status + parsed body, never throws on HTTP errors.
export const j = (r) => r.json().catch(() => ({})).then(b => ({ status: r.status, ...b }));
export const post = (url, body) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
export const api = {
  // session
  me: () => fetch("/api/me", { cache: "no-store" }).then(r => r.status === 401 ? null : r.ok ? r.json().then(d => d.user || null) : r.json().catch(() => ({})).then(d => Promise.reject(Object.assign(new Error(d.error || "me failed"), { status: r.status, server: true })))),
  login: (body) => post("/api/login", body).then(j),
  logout: () => post("/api/logout").catch(() => {}),
  publicInfo: () => fetch("/api/public", { cache: "no-store" }).then(r => { if (!r.ok) throw new Error("public failed"); return r.json(); }),
  register: (body) => post("/api/register", body).then(j),
  changePin: (oldPin, newPin) => post("/api/pin", { oldPin, newPin }).then(j),
  setEmployeePin: (id, pin, name) => post(`/api/employees/${encodeURIComponent(id)}/pin`, name ? { pin, name } : { pin }).then(j),
  approveMember: (requestId, approve) => post("/api/approve-member", { requestId, approve }).then(j),
  staffAdd: (body) => post("/api/staff", body).then(j),
  staffRename: (id, name) => fetch(`/api/staff/${encodeURIComponent(id)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }).then(j),
  staffRemove: (id) => fetch(`/api/staff/${encodeURIComponent(id)}`, { method: "DELETE" }).then(j),
  staffPin: (id, pin) => post(`/api/staff/${encodeURIComponent(id)}/pin`, { pin }).then(j),
  calendarToken: (rotate) => post("/api/calendar-token", { rotate: !!rotate }).then(j),
  audit: (entry) => post("/api/audit", entry).catch(() => {}),
  // Per-user LINE link (P3-6): own record for crew, ?employeeId= for the house.
  lineLink: (employeeId) => fetch(`/api/line-link${employeeId ? `?employeeId=${encodeURIComponent(employeeId)}` : ""}`).then(j),
  lineLinkCode: (employeeId) => post("/api/line-link", employeeId ? { employeeId } : {}).then(j),
  lineUnlink: (employeeId) => fetch(`/api/line-link${employeeId ? `?employeeId=${encodeURIComponent(employeeId)}` : ""}`, { method: "DELETE" }).then(j),
  // data
  getData: () => fetch("/api/data").then(r => { if (!r.ok) { const e = new Error("load failed"); e.status = r.status; throw e; } return r.json(); }),
  putData: (body, opts = {}) => fetch("/api/data", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), ...(opts.keepalive ? { keepalive: true } : {}) }),
  getProfile: (empId) => fetch(`/api/profile/${empId}`).then(r => r.ok ? r.json() : null),
  putProfile: (empId, profileObj) => fetch(`/api/profile/${empId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(profileObj) }),
  notify: (body) => fetch("/api/notify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => {}),
  shareInvoice: (html) => fetch("/api/invoice-share", { method: "POST", headers: { "Content-Type": "text/html" }, body: html }).then(r => { if (!r.ok) throw new Error("share failed"); return r.json(); }),
  // Owner-only share status / revoke (needs the token returned by shareInvoice).
  shareStatus: (key, token) => fetch(`/api/invoice-share?key=${encodeURIComponent(key)}&token=${encodeURIComponent(token)}`).then(r => r.ok ? r.json() : { found: false }).catch(() => ({ found: false })),
  revokeShare: (key, token) => fetch(`/api/invoice-share?key=${encodeURIComponent(key)}&token=${encodeURIComponent(token)}`, { method: "DELETE" }).then(r => r.ok),
  getBackup: () => fetch("/api/backup").then(r => r.ok ? r.json() : null),
  putBackup: (body) => fetch("/api/backup", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) }),
  getBackupAuto: () => fetch("/api/backup_auto").then(r => r.ok ? r.json() : null),
  putBackupAuto: (body) => fetch("/api/backup_auto", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) }),
  // Dated backup versions (P2-7): list, download one, restore one server-side.
  listBackups: () => fetch("/api/backup?list=1").then(r => r.ok ? r.json() : { backups: [] }).then(d => d.backups || []).catch(() => []),
  getBackupById: (id) => fetch(`/api/backup?id=${encodeURIComponent(id)}`).then(r => r.ok ? r.json() : null),
  restoreBackup: (id) => post("/api/backup", { id }).then(j),
  // Server-side deletes that stick (P0-5): a tombstone for one record, or the
  // whole pickup/return history (takes a safety backup first).
  deleteRecord: (field, id) => post("/api/tombstone", { field, id }).then(j),
  clearHistory: () => post("/api/history-clear").then(j),
  // Photo storage migration (P0-1): progress + one batch.
  migrateStatus: () => fetch("/api/migrate-photos").then(r => r.ok ? r.json() : null).catch(() => null),
  migratePhotos: (limit = 20) => post("/api/migrate-photos", { limit }).then(j),
  // Lazy per-entry verification photos (boot payload ships them stripped). Scoped
  // server-side to checkouts + adminRequests. Returns { [id]: dataUrl }.
  getPhotos: (field, ids) => fetch(`/api/photo?field=${encodeURIComponent(field)}&ids=${ids.map(encodeURIComponent).join(",")}`)
    .then(r => r.ok ? r.json() : { photos: {} }).then(d => d.photos || {}).catch(() => ({})),
};

// Who is acting (P2-6): the signed-in session, set by App whenever `user`
// changes. Event writers stamp `by: actorName()` so an approval, return, KPI
// deduction or delete carries the staff member's name, not a bare "admin".
export let ACTOR = { role: null, id: null, name: "" };
export function setActor(u) { ACTOR = u ? { role: u.role, id: u.id, name: u.name || (u.role === "admin" ? "Admin" : "") } : { role: null, id: null, name: "" }; }
export const actorName = () => ACTOR.name || (ACTOR.role === "admin" ? "Admin" : "");
export const SESSION_KEY = "psr_user";     // cached session view (role/id/name only, never a PIN) for the offline path
export const PENDING_KEY = "psr_pending";  // name of the member-register request sent from this device (P2-8)

export const CACHE_KEY = "psr_cache"; // localStorage key for offline fallback cache

// Top-level fields the client persists to KV (the server FIELDS list in
// functions/_lib/store.js also holds the server-owned adminPinHash / staff /
// calendarToken / auditLog, which the client only reads).
export const DATA_FIELDS = ["equipment", "jobs", "checkouts", "employees", "reports", "productionCompanies", "invoices", "companyName", "equipmentRequests", "adminRequests", "lineGroupId", "timezone", "timeFormat", "kpiConfig", "punishments", "kpiEvents", "photoVerification", "navOrder", "verificationConfig", "invoicePresets", "chatEnabled", "theme", "roleList"];

// Admin theme (P3-8): saved per tenant in KV as { style, palette }; localStorage
// only caches it so the first paint after a reload already has the right look.
export const THEME_STYLES = ["flat", "neumorphism", "glassmorphism", "skeuomorphism"];
export const DEFAULT_THEME = { style: "flat", palette: "white-blue" };
export function readCachedTheme() {
  try {
    const raw = JSON.parse(localStorage.getItem("psr_theme") || "null");
    if (raw && typeof raw === "object") return normalizeTheme(raw);
    // pre-P3-8 per-device keys
    return normalizeTheme({ style: localStorage.getItem("psr_theme_style2"), palette: localStorage.getItem("psr_theme_palette2") });
  } catch { return DEFAULT_THEME; }
}
export function normalizeTheme(t) {
  const style = THEME_STYLES.includes(t && t.style) ? t.style : DEFAULT_THEME.style;
  const palette = t && t.palette && Object.prototype.hasOwnProperty.call(PALETTES, t.palette) ? t.palette : DEFAULT_THEME.palette;
  return { style, palette };
}

// Replace inline base64 verification photos with a lightweight marker before a
// snapshot is cached. Keeps the localStorage cache well under quota (the full
// payload's photos are tens of MB); the cache is read-only in the offline path so
// the stripped copy never round-trips back into KV.
export function stripSnapshotPhotos(d) {
  if (!d || typeof d !== "object") return d;
  const strip = (arr) => Array.isArray(arr)
    ? arr.map(e => (e && typeof e.photo === "string" && e.photo.startsWith("data:")) ? { ...e, photo: null, hasPhoto: true } : e)
    : arr;
  return { ...d, checkouts: strip(d.checkouts), adminRequests: strip(d.adminRequests) };
}
export function writeCache(snapshot) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(stripSnapshotPhotos(snapshot))); }
  catch (e) { console.warn("[psr] offline cache write failed:", e && e.name); }
}

// ─── ADMIN THEME SYSTEM ───────────────────────────────────────────────────────
export const PALETTES = {
  "black-white":  { bg: "#111", s1: "#1e1e1e", s2: "#2b2b2b", bdr: "#3a3a3a", text: "#f0f0f0", muted: "#888", acc: "#e0e0e0", accT: "#111" },
  "teal-orange":  { bg: "#051414", s1: "#0c2424", s2: "#153535", bdr: "#225050", text: "#dff5f0", muted: "#5a9a8a", acc: "#ff6a2a", accT: "#fff" },
  "black-red":    { bg: "#0e0808", s1: "#1c0e0e", s2: "#281414", bdr: "#3e1818", text: "#f0dddd", muted: "#9a6060", acc: "#dd3333", accT: "#fff" },
  "white-blue":   { bg: "#F4F7FB", s1: "#FFFFFF", s2: "#EAF0F7", bdr: "#D8E1EC", text: "#16324A", muted: "#4E6B84", acc: "#2563EB", accT: "#FFFFFF" },
  "black-yellow": { bg: "#0e0e08", s1: "#191910", s2: "#232318", bdr: "#353520", text: "#f0f0dc", muted: "#8a8a68", acc: "#e8b84b", accT: "#0e0e08" },
  "black-blue":   { bg: "#07090e", s1: "#0e121e", s2: "#151c2c", bdr: "#1c2c44", text: "#c8d8f0", muted: "#5878a8", acc: "#3a80e8", accT: "#fff" },
};
export const hexRgb = (h) => { const n = parseInt(h.replace("#",""), 16); return `${(n>>16)&255},${(n>>8)&255},${n&255}`; };
export const isLight = (hex) => { const n = parseInt(hex.replace("#",""),16); const r=(n>>16)&255,g=(n>>8)&255,b=n&255; return (0.299*r+0.587*g+0.114*b)>128; };

// Dialogs portal to <body> (outside #admin-layout), so the palette variables are
// also emitted for a dialog backdrop while an admin is logged in (body.psr-admin,
// toggled by the theme effect). The crew portal never gets the admin palette.
export const THEME_SCOPE = "#admin-layout,body.psr-admin [data-dialog-backdrop]";
export function buildThemeCss(style, palette) {
  const p = PALETTES[palette]; if (!p) return "";
  const light = isLight(p.bg);
  const [accR, s1R, bgR, txtR] = [hexRgb(p.acc), hexRgb(p.s1), hexRgb(p.bg), hexRgb(p.text)];

  const base = `${THEME_SCOPE}{--bg:${p.bg};--surface:${p.s1};--surface2:${p.s2};--border-color:${p.bdr};--text:${p.text};--text-muted:${p.muted};--accent:${p.acc};--accent-rgb:${accR};--accent-text:${p.accT};--logo-bg:${light ? "#16324A" : p.s2};--btn-primary-bg:${p.acc};--btn-primary-color:${p.accT};--section-title-color:${p.muted};--divider-color:${p.bdr};--tag-bg:${p.s2};--tag-color:${p.muted};}`;

  let sv = "";
  if (style === "flat") {
    // Shop Job Board look: plain white planes, hairline borders, one soft shadow, no blur
    const sh = light ? "0 1px 2px rgba(22,50,74,0.06),0 4px 16px rgba(22,50,74,0.08)" : "0 1px 2px rgba(0,0,0,0.3),0 4px 16px rgba(0,0,0,0.3)";
    sv = `${THEME_SCOPE}{--card-border:1px solid ${p.bdr};--card-radius:10px;--card-backdrop:none;--card-shadow:${sh};--input-bg:${p.s1};--input-border:1px solid ${p.bdr};--input-shadow:none;--btn-radius:6px;--btn-shadow:none;--topbar-bg:${p.s1};--topbar-border:1px solid ${p.bdr};--topbar-shadow:none;--nav-bg:${p.s1};--nav-border:1px solid ${p.bdr};--nav-shadow:none;}`;
  } else if (style === "neumorphism") {
    const dSh = light ? "rgba(0,0,0,0.18)" : "rgba(0,0,0,0.48)";
    const lSh = light ? "rgba(255,255,255,0.88)" : "rgba(255,255,255,0.04)";
    sv = `${THEME_SCOPE}{--card-border:none;--card-radius:18px;--card-backdrop:none;--card-shadow:8px 8px 18px ${dSh},-5px -5px 12px ${lSh};--input-bg:${p.bg};--input-border:none;--input-shadow:inset 4px 4px 9px ${dSh},inset -3px -3px 6px ${lSh};--btn-radius:12px;--btn-shadow:5px 5px 12px ${dSh},-3px -3px 7px ${lSh};--topbar-bg:${p.s1};--topbar-border:none;--topbar-shadow:0 4px 18px ${dSh};--nav-bg:${p.s1};--nav-border:none;--nav-shadow:0 -4px 18px ${dSh};}`;
  } else if (style === "glassmorphism") {
    sv = `${THEME_SCOPE}{--bg:radial-gradient(ellipse at 20% 20%,rgba(${accR},0.22) 0%,transparent 52%),radial-gradient(ellipse at 80% 78%,rgba(${s1R},0.42) 0%,transparent 55%),${p.bg};--surface:rgba(${s1R},0.2);--card-border:1px solid rgba(${txtR},0.1);--card-radius:16px;--card-shadow:0 8px 32px rgba(0,0,0,0.25);--card-backdrop:blur(20px);--input-bg:rgba(${bgR},0.52);--input-border:1px solid rgba(${txtR},0.14);--input-shadow:none;--btn-radius:10px;--btn-shadow:0 4px 16px rgba(0,0,0,0.2);--topbar-bg:rgba(${bgR},0.65);--topbar-border:none;--topbar-shadow:none;--nav-bg:rgba(${bgR},0.72);--nav-border:none;--nav-shadow:none;--tag-bg:rgba(${s1R},0.45);}`;
  } else if (style === "skeuomorphism") {
    sv = `${THEME_SCOPE}{--surface:linear-gradient(145deg,${p.s2} 0%,${p.s1} 100%);--card-border:1px solid ${p.bdr};--card-radius:8px;--card-backdrop:none;--card-shadow:0 2px 0 rgba(0,0,0,0.5),0 6px 20px rgba(0,0,0,0.3),inset 0 1px 0 rgba(255,255,255,0.07);--input-bg:${p.bg};--input-border:2px solid ${p.bdr};--input-shadow:inset 0 2px 5px rgba(0,0,0,0.45);--btn-radius:6px;--btn-shadow:0 3px 0 rgba(0,0,0,0.5),0 5px 12px rgba(0,0,0,0.3),inset 0 1px 0 rgba(255,255,255,0.15);--topbar-bg:linear-gradient(180deg,${p.s2} 0%,${p.bg} 100%);--topbar-border:1px solid ${p.bdr};--topbar-shadow:0 3px 12px rgba(0,0,0,0.4);--nav-bg:linear-gradient(0deg,${p.bg} 0%,${p.s2} 100%);--nav-border:1px solid ${p.bdr};--nav-shadow:0 -3px 12px rgba(0,0,0,0.4);}`;
  }
  return base + sv;
}

// ─── ICON COMPONENTS ─────────────────────────────────────────────────────────
export const Icon = ({ d, size = 18, color = "currentColor", fill = "none", strokeW = 1.8, ...rest }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={color} strokeWidth={strokeW} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
    {Array.isArray(d) ? d.map((p, i) => <path key={i} d={p} />) : <path d={d} />}
  </svg>
);

export const icons = {
  camera: "M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z",
  job: "M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01",
  plus: "M12 5v14 M5 12h14",
  check: "M20 6L9 17l-5-5",
  x: "M18 6L6 18 M6 6l12 12",
  edit: "M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7 M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z",
  trash: "M3 6h18 M8 6V4h8v2 M19 6l-1 14H6L5 6",
  history: "M12 8v4l3 3 M3.05 11a9 9 0 1 0 .5-3",
  arrow_left: "M19 12H5 M12 19l-7-7 7-7",
  user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9",
  photo: "M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  lock: "M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2z M7 11V7a5 5 0 0 1 10 0v4",
  map: "M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z M12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  calendar: "M3 9h18 M8 3v4 M16 3v4 M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5z",
  film: "M2 8h20 M2 16h20 M6 2v20 M18 2v20 M2 2h20v20H2z",
  alert: "M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z M12 9v4 M12 17h.01",
  invoice: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8",
  building: "M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10",
  bell: "M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9 M13.73 21a2 2 0 0 1-3.46 0",
  package: ["M16.5 9.4l-9-5.19", "M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z", "M3.27 6.96L12 12.01l8.73-5.05", "M12 22.08V12"],
  qr: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h3v3h-3z M17 17h3v3h-3z M14 20h3 M20 14v3",
  chart: "M3 3v18h18 M7 15l4-5 4 3 5-7",
  chat: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  send: "M22 2L11 13 M22 2L15 22l-4-9-9-4 22-7z",
  save: "M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z M17 21v-8H7v8 M7 3v5h8",
  star: "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 6v6l4 2",
  eye: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  print: "M6 9V2h12v7 M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2 M6 14h12v8H6z",
  link: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71 M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
  copy: "M20 9h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2z M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1",
  flag: "M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z M4 22v-7",
  receipt: "M4 2v20l3-2 3 2 3-2 3 2 3-2 3 2V2l-3 2-3-2-3 2-3-2-3 2z M8 8h8 M8 12h8 M8 16h5",
  hourglass: "M5 22h14 M5 2h14 M17 22v-4.17a2 2 0 0 0-.59-1.42L12 12l-4.41 4.41A2 2 0 0 0 7 17.83V22 M7 2v4.17a2 2 0 0 0 .59 1.42L12 12l4.41-4.41A2 2 0 0 0 17 6.17V2",
  chevron_right: "M9 18l6-6-6-6",
  chevron_down: "M6 9l6 6 6-6",
  chevron_up: "M18 15l-6-6-6 6",
  undo: "M3 7v6h6 M21 17a9 9 0 0 0-15-6.7L3 13",
  palette: "M12 22a10 10 0 1 1 0-20c5.5 0 10 3.6 10 8a5 5 0 0 1-5 5h-2a2 2 0 0 0-1.5 3.3c.3.4.5.9.5 1.4a2 2 0 0 1-2 2.3z M7.5 10.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2z M12 7.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2z M16.5 10.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2z",
};

// ─── UTILITY: Date / time helpers ────────────────────────────────────────────
// Admin-configurable, updated from cloud data on load so date math & time display
// never depend on the device's locale/timezone guess.
export let APP_TZ = "Asia/Bangkok";   // IANA timezone id
export let TIME_FMT = "24";           // "12" | "24"
export function setTimePrefs(tz, fmt) { if (tz) APP_TZ = tz; if (fmt) TIME_FMT = fmt; }

export const today = () => {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: APP_TZ }).format(new Date()); }
  catch { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
};

// Format an "HH:MM" 24-hour string per the admin time-format preference.
export function fmtClock(t) {
  if (!t) return "—";
  const [h, m] = t.slice(0, 5).split(":").map(Number);
  if (Number.isNaN(h)) return "—";
  if (TIME_FMT === "12") { const ampm = h >= 12 ? "PM" : "AM"; const h12 = h % 12 || 12; return `${h12}:${String(m).padStart(2, "0")} ${ampm}`; }
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// hoursWorked / DEFAULT_OT_TIERS / calcOtAmount live in src/logic/money.js
export const TIMEZONES = [
  { id: "Asia/Bangkok", label: "Bangkok / Hanoi / Jakarta (GMT+7)" },
  { id: "Asia/Ho_Chi_Minh", label: "Ho Chi Minh City (GMT+7)" },
  { id: "Asia/Yangon", label: "Yangon (GMT+6:30)" },
  { id: "Asia/Singapore", label: "Singapore / Kuala Lumpur (GMT+8)" },
  { id: "Asia/Hong_Kong", label: "Hong Kong (GMT+8)" },
  { id: "Asia/Manila", label: "Manila (GMT+8)" },
  { id: "Asia/Shanghai", label: "Beijing / Shanghai (GMT+8)" },
  { id: "Asia/Tokyo", label: "Tokyo / Seoul (GMT+9)" },
  { id: "Asia/Kolkata", label: "India (GMT+5:30)" },
  { id: "Asia/Dubai", label: "Dubai (GMT+4)" },
  { id: "Australia/Sydney", label: "Sydney (GMT+10/+11)" },
  { id: "Europe/London", label: "London (GMT+0/+1)" },
  { id: "Europe/Paris", label: "Paris / Berlin (GMT+1/+2)" },
  { id: "America/New_York", label: "New York (GMT-5/-4)" },
  { id: "America/Los_Angeles", label: "Los Angeles (GMT-8/-7)" },
  { id: "UTC", label: "UTC (GMT+0)" },
];

export const haversineMeters = (lat1, lon1, lat2, lon2) => { const R=6371000,φ1=lat1*Math.PI/180,φ2=lat2*Math.PI/180,Δφ=(lat2-lat1)*Math.PI/180,Δλ=(lon2-lon1)*Math.PI/180,a=Math.sin(Δφ/2)**2+Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2; return 2*R*Math.atan2(Math.sqrt(a),Math.sqrt(1-a)); };
// formatDate / formatDateTime / formatDay live in src/i18n/format.js (locale follows the app language, P1-6)
export const addDaysStr = (ds, n) => { const d = new Date(ds + "T00:00:00"); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
// jobFirstDate / jobLastDate / effPickupDate / effReturnDate live in src/logic/availability.js

// ─── KPI scoring ─────────────────────────────────────────────────────────────
// Logic lives in src/logic/kpi.js (P3-2: deductions AND positive adjustments).
// These wrappers pin "today" to the app timezone.
export const kpiPeriod = (config) => kpiPeriodAt(config, today());
export const kpiScore = (employeeId, kpiEvents, config) => kpiScoreAt(employeeId, kpiEvents, config, today());
export const kpiEventsInPeriod = (employeeId, kpiEvents, config) => kpiEventsInPeriodAt(employeeId, kpiEvents, config, today());

// 5-star rating with fractional fill (0.1 resolution).
export function StarRating({ value, size = 18 }) {
  const pct = Math.max(0, Math.min(100, (value / 5) * 100));
  return (
    <div style={{ position: "relative", display: "inline-block", fontSize: size, lineHeight: 1, letterSpacing: 2, fontFamily: "Arial, sans-serif" }}>
      <div style={{ color: "var(--border-color,#D8E1EC)" }}>★★★★★</div>
      <div style={{ position: "absolute", top: 0, left: 0, width: pct + "%", overflow: "hidden", whiteSpace: "nowrap", color: "var(--accent,#2563EB)" }}>★★★★★</div>
    </div>
  );
}

// Downscale + JPEG-compress an image (File or dataURL) BEFORE it is stored in KV.
// Photos from phones are multi-MB; this keeps the single `data` record and profile
// records small (KV per-key cap is 25 MB). Returns a Promise<dataURL>.
export function compressImage(input, { maxDim = 1200, quality = 0.72 } = {}) {
  return new Promise((resolve) => {
    const draw = (src) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        try { resolve(canvas.toDataURL("image/jpeg", quality)); }
        catch { resolve(typeof src === "string" ? src : null); }
      };
      img.onerror = () => resolve(typeof src === "string" ? src : null);
      img.src = src;
    };
    if (typeof input === "string") draw(input);
    else { const r = new FileReader(); r.onload = (e) => draw(e.target.result); r.onerror = () => resolve(null); r.readAsDataURL(input); }
  });
}

// ─── STYLES ──────────────────────────────────────────────────────────────────
// CSS variables with fallbacks — admin layout overrides via #admin-layout selector.
// Employee view never has #admin-layout so always uses the fallback (dark cinema).
export const S = {
  app: { minHeight: "100vh", background: "var(--bg,#F4F7FB)", color: "var(--text,#16324A)", fontFamily: "'Inter','SF Pro Display',system-ui,sans-serif", fontSize: 14 },
  topbar: { height: 54, background: "var(--topbar-bg,#FFFFFF)", borderBottom: "var(--topbar-border,1px solid #D8E1EC)", boxShadow: "var(--topbar-shadow,none)", backdropFilter: "var(--card-backdrop,none)", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px", position: "sticky", top: 0, zIndex: 100 },
  main: { minHeight: "calc(100vh - 54px)", padding: "20px 16px" },
  logo: { display: "flex", alignItems: "center", gap: 8 },
  logoText: { fontSize: 15, fontWeight: 700, letterSpacing: "0.04em", color: "var(--accent,#2563EB)" },
  logoSub: { fontSize: 10, color: "var(--text-muted,#5F7A91)", letterSpacing: "0.12em", textTransform: "uppercase" },
  navItem: (active) => ({ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", cursor: "pointer", color: active ? "var(--accent,#2563EB)" : "var(--text,#16324A)", background: active ? "rgba(var(--accent-rgb,37,99,235),0.07)" : "transparent", borderLeft: active ? "3px solid var(--accent,#2563EB)" : "3px solid transparent", fontSize: 14, fontWeight: active ? 700 : 400 }),
  card: { background: "var(--surface,#FFFFFF)", border: "var(--card-border,1px solid #D8E1EC)", borderRadius: "var(--card-radius,10px)", padding: 20, boxShadow: "var(--card-shadow,0 1px 2px rgba(22,50,74,0.06),0 4px 16px rgba(22,50,74,0.08))", backdropFilter: "var(--card-backdrop,none)" },
  cardGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 14 },
  // Status badges: sm (default, inline text) / md (readable on phones). Chips = tappable badges, 32px min.
  badge: (color, size = "sm") => ({ display: "inline-flex", alignItems: "center", gap: 4, boxSizing: "border-box", borderRadius: 20, fontWeight: 600, letterSpacing: "0.04em", whiteSpace: "nowrap",
    ...(size === "md" ? { padding: "4px 10px", fontSize: 12, minHeight: 24 } : size === "chip" ? { padding: "6px 12px", fontSize: 12, minHeight: 32, cursor: "pointer", border: "none", fontFamily: "inherit" } : { padding: "2px 8px", fontSize: 11 }), ...(color === "green" ? { background: "rgba(47,133,90,0.12)", color: "#2F855A" } : color === "amber" ? { background: "rgba(var(--accent-rgb,37,99,235),0.12)", color: "var(--accent,#2563EB)" } : color === "red" ? { background: "rgba(197,48,48,0.12)", color: "#C53030" } : color === "blue" ? { background: "rgba(37,99,235,0.12)", color: "#2563EB" } : color === "gray" ? { background: "rgba(148,163,184,0.1)", color: "#7B8794" } : {}) }),
  input: { width: "100%", background: "var(--input-bg,#FFFFFF)", border: "var(--input-border,1px solid #D8E1EC)", boxShadow: "var(--input-shadow,none)", borderRadius: "var(--btn-radius,7px)", padding: "9px 12px", color: "var(--text,#16324A)", fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box" },
  select: { width: "100%", background: "var(--input-bg,#FFFFFF)", border: "var(--input-border,1px solid #D8E1EC)", boxShadow: "var(--input-shadow,none)", borderRadius: "var(--btn-radius,7px)", padding: "9px 12px", color: "var(--text,#16324A)", fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box", cursor: "pointer" },
  label: { display: "block", marginBottom: 5, fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", color: "var(--section-title-color,#4E6B84)", textTransform: "uppercase" },
  // Three control sizes (P2-12): sm 28px (dense admin rows), md 36px (default),
  // lg 44px (anything a crew member taps on Today / Checkout).
  btn: (variant = "primary", size = "md") => ({
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, boxSizing: "border-box", fontFamily: "inherit",
    ...(size === "sm" ? { minHeight: 28, padding: "3px 10px", fontSize: 12 } : size === "lg" ? { minHeight: 44, padding: "10px 18px", fontSize: 14 } : { minHeight: 36, padding: "7px 14px", fontSize: 13 }),
    borderRadius: "var(--btn-radius,7px)", fontWeight: 600, cursor: "pointer", border: "none", transition: "all 0.15s",
    ...(variant === "primary" ? { background: "var(--btn-primary-bg,#2563EB)", color: "var(--btn-primary-color,#FFFFFF)", boxShadow: "var(--btn-shadow,none)" } : variant === "ghost" ? { background: "transparent", color: "var(--text-muted,#4E6B84)", border: "var(--input-border,1px solid #D8E1EC)" } : variant === "danger" ? { background: "rgba(197,48,48,0.12)", color: "#C53030", border: "1px solid rgba(197,48,48,0.2)" } : variant === "success" ? { background: "rgba(47,133,90,0.12)", color: "#2F855A", border: "1px solid rgba(47,133,90,0.2)" } : {})
  }),
  sectionTitle: { fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--section-title-color,#4E6B84)", marginBottom: 16 },
  pageTitle: { fontSize: 22, fontWeight: 700, marginBottom: 4, color: "var(--text,#16324A)" },
  pageSubtitle: { fontSize: 13, color: "var(--text-muted,#5F7A91)", marginBottom: 28 },
  divider: { borderTop: "1px solid var(--divider-color,#D8E1EC)", margin: "20px 0" },
  row: { display: "flex", alignItems: "center", gap: 12 },
  col: { display: "flex", flexDirection: "column", gap: 12 },
  tag: { display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 11, background: "var(--tag-bg,#D8E1EC)", color: "var(--tag-color,#4E6B84)", fontWeight: 500 },
  // Filter / sort chip (P2-12): >= 32px tall, 12px label, one look everywhere.
  chip: (active) => ({ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4, boxSizing: "border-box", minHeight: 32, padding: "6px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", cursor: "pointer", fontFamily: "inherit", transition: "all .12s",
    ...(active ? { background: "var(--accent,#2563EB)", color: "var(--accent-text,#FFFFFF)", border: "1px solid var(--accent,#2563EB)" } : { background: "var(--surface,#FFFFFF)", color: "var(--text-muted,#4E6B84)", border: "1px solid var(--border-color,#D8E1EC)" }) }),
};

// ─── VIEWPORT ────────────────────────────────────────────────────────────────
// true when the viewport is at least `px` wide (re-evaluated on resize).
export function useMinWidth(px) {
  const [ok, setOk] = useState(() => typeof window !== "undefined" && window.innerWidth >= px);
  useEffect(() => {
    const on = () => setOk(window.innerWidth >= px);
    on();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, [px]);
  return ok;
}

// Sidebar / bottom-nav order: the saved navOrder first, then any page it does
// not know yet (a page added after the order was saved still shows up).
export function orderNav(items, navOrder) {
  if (!Array.isArray(navOrder) || navOrder.length === 0) return items;
  const known = navOrder.map(k => items.find(n => n.key === k)).filter(Boolean);
  const seen = new Set(known.map(n => n.key));
  return [...known, ...items.filter(n => !seen.has(n.key))];
}

// ─── MODAL ───────────────────────────────────────────────────────────────────
// Thin wrapper over the portal-rendered Dialog primitive (src/components/dialog.jsx,
// P2-13): role=dialog, aria-modal, Esc + backdrop close (with a discard confirm
// when `dirty`), focus trap and focus return. Callers keep using <Modal>.
export function Modal({ title, onClose, children, wide, dirty }) {
  const t = useT();
  return (
    <Dialog title={title} onClose={onClose} wide={wide} dirty={dirty} confirmText={t("dialogDiscardConfirm")} closeLabel={t("dialogClose")} icon={<Icon d={icons.x} size={16} />}>
      {children}
    </Dialog>
  );
}

// ─── LAZY VERIFICATION PHOTO ─────────────────────────────────────────────────
// Verification photos are stripped from the boot payload (they are tens of MB and
// only viewed on demand). If `photo` is present it renders immediately; otherwise
// when `hasPhoto` is set it fetches the base64 from /api/photo on first mount.
export function LazyPhoto({ field, id, photo, hasPhoto, style, alt }) {
  const [src, setSrc] = useState(photo || null);
  useEffect(() => {
    if (photo) { setSrc(photo); return; }
    if (!hasPhoto || !id) { setSrc(null); return; }
    let alive = true;
    setSrc(null);
    api.getPhotos(field, [id]).then(m => { if (alive && m && m[id]) setSrc(m[id]); }).catch(() => {});
    return () => { alive = false; };
  }, [field, id, photo, hasPhoto]);
  if (!src && !hasPhoto) return null;
  if (!src) return <div style={{ ...style, background: "var(--surface2,#EAF0F7)", border: "1px dashed var(--border-color,#D8E1EC)", display: "flex", alignItems: "center", justifyContent: "center", color: "#4a5060", fontSize: 10 }}>…</div>;
  return <img src={src} alt={alt || ""} style={style} />;
}

// ─── AVAILABILITY BAR ────────────────────────────────────────────────────────
export function AvailBar({ available, total }) {
  return (
    <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} style={{ width: 12, height: 12, borderRadius: 3, background: i < available ? "var(--accent,#2563EB)" : "var(--border-color,#D8E1EC)" }} />
      ))}
    </div>
  );
}

// ─── PHOTO CAPTURE (geo-locked) ──────────────────────────────────────────────
// Uses the phone's NATIVE camera via a file input (capture="environment").
// This works in every mobile browser INCLUDING in-app webviews (LINE, Instagram,
// Facebook) where the live getUserMedia() preview is blocked — that was the cause
// of the "Open Camera does nothing" reports. Geo-lock is preserved by stamping the
// timestamp + GPS onto the captured still.
//
// usePhotoCapture() owns the hidden input + decoding so a list row's Photo button
// can call `open()` SYNCHRONOUSLY inside the tap (P2-14: no empty intermediate
// screen); the decoded, stamped photo then shows in <GeoPhoto> for a "Use photo /
// Retake" decision BEFORE anything is committed (P1-4).
export function usePhotoCapture() {
  const fileRef = useRef(null);
  const [photo, setPhoto] = useState(null);
  const [location, setLocation] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);       // i18n key
  const [locErr, setLocErr] = useState(null); // i18n key
  const seq = useRef(0);

  const getGPS = () => new Promise(resolve => {
    if (!navigator.geolocation) { setLocErr("photoNoGps"); return resolve(null); }
    navigator.geolocation.getCurrentPosition(
      (pos) => { const l = { lat: pos.coords.latitude.toFixed(5), lng: pos.coords.longitude.toFixed(5), acc: Math.round(pos.coords.accuracy) }; setLocation(l); resolve(l); },
      () => { setLocErr("photoNoGps"); resolve(null); },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
    );
  });

  // Scale down and burn timestamp + GPS into the image.
  const stamp = (img, loc) => {
    const sw = img.naturalWidth || img.width, sh = img.naturalHeight || img.height;
    const scale = Math.min(1, 1200 / Math.max(sw, sh));
    const w = Math.round(sw * scale), h = Math.round(sh * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, w, h);
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, h - 60, w, 60);
    ctx.fillStyle = "#e8b84b";
    ctx.font = "bold 14px Inter, sans-serif";
    ctx.fillText(new Date().toLocaleString(), 10, h - 38);
    ctx.fillText(loc ? `GPS: ${loc.lat}, ${loc.lng} (±${loc.acc}m)` : "No GPS", 10, h - 16);
    return canvas.toDataURL("image/jpeg", 0.72);
  };

  const onFilePicked = (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = ""; // allow re-picking the same file
    if (!f) return;
    const my = ++seq.current;
    setBusy(true); setErr(null); setLocErr(null); setPhoto(null); setLocation(null);
    const gpsP = getGPS(); // request GPS while the image decodes
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = async () => {
        const loc = await gpsP.catch(() => null);
        if (my !== seq.current) return; // superseded by a newer pick
        setPhoto(stamp(img, loc));
        setBusy(false);
      };
      img.onerror = () => { if (my === seq.current) { setErr("photoReadFail"); setBusy(false); } };
      img.src = ev.target.result;
    };
    reader.onerror = () => { if (my === seq.current) { setErr("photoReadFail"); setBusy(false); } };
    reader.readAsDataURL(f);
  };

  const open = () => { if (fileRef.current) fileRef.current.click(); };
  const reset = () => { seq.current++; setPhoto(null); setLocation(null); setBusy(false); setErr(null); setLocErr(null); };
  // The input must be mounted on whichever screen calls open(); one ref, one at a time.
  const input = <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={onFilePicked} data-testid="photo-input" />;
  return { input, open, reset, photo, location, busy, err, locErr };
}

// Preview + decide. `capture` = usePhotoCapture(). Renders the stamped photo with
// Use photo / Retake; `children` (e.g. return qty/condition fields) sit between the
// photo and the buttons. Falls back to an "Open camera" button when there is no
// photo yet (permission denied, cancelled picker, decode error).
export function GeoPhoto({ capture, label, onUse, useLabel, children, disabled }) {
  const t = useT();
  const { photo, location, busy, err, locErr } = capture;
  return (
    <div style={{ ...S.card, background: "var(--surface2,#EAF0F7)" }}>
      <p style={S.label}>{label || "Capture Verification Photo"}</p>
      {capture.input}
      {!photo && (
        <>
          <button style={{ ...S.btn("primary"), justifyContent: "center", padding: "14px", fontSize: 16, width: "100%" }} onClick={capture.open} disabled={busy}>
            <Icon d={icons.camera} size={18} /> {busy ? t("photoProcessing") : t("photoOpenCamera")}
          </button>
          {!busy && !err && <p style={{ fontSize: 12, color: "var(--text-muted,#5F7A91)", marginTop: 8, textAlign: "center" }}>{t("photoTapToRetry")}</p>}
        </>
      )}
      {err && <p style={{ fontSize: 12, color: "#C53030", marginTop: 8 }}>{t(err)}</p>}
      {locErr && photo && <p style={{ fontSize: 12, color: "#B7791F", marginTop: 8 }}>{t(locErr)}</p>}
      {photo && (
        <div style={{ marginTop: 12 }}>
          <img src={photo} alt="captured" style={{ width: "100%", borderRadius: 8 }} />
          <p style={{ fontSize: 11, color: "#2F855A", margin: "8px 0 0" }}>✓ {location ? t("photoCapturedGps") : t("photoCaptured")}</p>
          {children}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button style={{ ...S.btn("ghost"), flex: 1, justifyContent: "center", padding: "12px" }} onClick={() => { capture.reset(); capture.open(); }}>↻ {t("photoRetake")}</button>
            <button style={{ ...S.btn("primary"), flex: 2, justifyContent: "center", padding: "12px", fontSize: 15 }} disabled={disabled} onClick={() => onUse(photo, location)}><Icon d={icons.check} size={16} /> {useLabel || t("photoUse")}</button>
          </div>
        </div>
      )}
    </div>
  );
}

// Return details (P1-1): units coming back (capped at what is out), condition, note.
// Shared by the crew preview screen, the crew none-mode modal, the barcode-lane
// modal and the admin Receive modal.
export function ReturnDetailsFields({ value, onChange, outstanding, showQty = true, compact, hintKey = "partialHint" }) {
  const t = useT();
  const set = (patch) => onChange({ ...value, ...patch });
  const minQty = value.condition === "missing" ? 0 : 1;
  const qty = Math.max(minQty, Math.min(outstanding, value.qty ?? outstanding));
  const conds = [["ok", "condOk", "green"], ["damaged", "condDamaged", "amber"], ["missing", "condMissing", "red"]];
  return (
    <div style={{ marginTop: compact ? 8 : 12, display: "flex", flexDirection: "column", gap: 10 }}>
      {showQty && outstanding > 1 && (
        <div>
          <label style={S.label}>{t("returnQty")} <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>{t("returnQtyOf").replace("{n}", outstanding)}</span></label>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button type="button" aria-label="minus" style={{ ...S.btn("ghost"), padding: "8px 14px", fontSize: 16 }} disabled={qty <= minQty} onClick={() => set({ qty: Math.max(minQty, qty - 1) })}>−</button>
            <span style={{ minWidth: 48, textAlign: "center", fontSize: 20, fontWeight: 800, color: "var(--text,#16324A)" }} data-testid="return-qty">{qty}</span>
            <button type="button" aria-label="plus" style={{ ...S.btn("ghost"), padding: "8px 14px", fontSize: 16 }} disabled={qty >= outstanding} onClick={() => set({ qty: Math.min(outstanding, qty + 1) })}>+</button>
            {qty < outstanding && <span style={{ ...S.badge("red") }}>{t("missingN").replace("{n}", outstanding - qty)}</span>}
          </div>
          <p style={{ fontSize: 11, color: "var(--text-muted,#5F7A91)", margin: "6px 0 0" }}>{t(hintKey).replace("{n}", outstanding)}</p>
        </div>
      )}
      <div>
        <label style={S.label}>{t("condition")}</label>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {conds.map(([id, key, color]) => {
            const active = (value.condition || "ok") === id;
            return (
              <button key={id} type="button" onClick={() => set({ condition: id, qty: id === "missing" ? Math.min(qty, outstanding) : Math.max(1, qty) })}
                style={{ ...S.btn(active ? "primary" : "ghost"), padding: "7px 12px", fontSize: 12, ...(active && color === "red" ? { background: "#C53030" } : active && color === "amber" ? { background: "#B7791F" } : {}) }}>
                {t(key)}
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <label style={S.label}>{t("returnNote")}</label>
        <input style={S.input} value={value.note || ""} placeholder={t("returnNotePh")} onChange={e => set({ note: e.target.value })} />
      </div>
    </div>
  );
}

// ─── QR SCANNER ──────────────────────────────────────────────────────────────
// Live camera viewfinder that decodes QR codes frame-by-frame using jsQR.
// Calls onScan(rawValue, geoLocation) the first time a valid QR is decoded.
// Equipment QR codes encode the equipment ID as plain text: "psr_eq:{eqId}"
export function QRScanner({ onScan, onClose, label }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const scannedRef = useRef(false);
  const [err, setErr] = useState(null);
  const [status, setStatus] = useState("starting"); // starting | scanning | found

  const getGPS = () => new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude.toFixed(5), lng: pos.coords.longitude.toFixed(5), acc: Math.round(pos.coords.accuracy) }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
    );
  });

  useEffect(() => {
    let stopped = false;
    let jsQR = null;
    // Decoder and camera start in parallel; scanning begins once both are ready.
    loadJsQR().then(fn => { jsQR = fn; }).catch(() => setErr("Scanner failed to load. Check your connection and try again."));
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then(stream => {
        if (stopped) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().then(() => { setStatus("scanning"); tick(); }).catch(() => setErr("Camera error."));
        }
      })
      .catch(() => setErr("Camera access denied. Allow the camera in your browser settings."));

    const tick = () => {
      if (stopped || scannedRef.current) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || !jsQR || video.readyState < 2) { rafRef.current = requestAnimationFrame(tick); return; }
      const w = video.videoWidth, h = video.videoHeight;
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(video, 0, 0, w, h);
      const imgData = ctx.getImageData(0, 0, w, h);
      const code = jsQR(imgData.data, w, h, { inversionAttempts: "dontInvert" });
      if (code && code.data.startsWith("psr_eq:")) {
        scannedRef.current = true;
        setStatus("found");
        getGPS().then(loc => { if (!stopped) onScan(code.data.slice(7), loc); });
      } else {
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    return () => {
      stopped = true;
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ position: "relative" }}>
      {label && <p style={S.label}>{label}</p>}
      <div style={{ position: "relative", width: "100%", borderRadius: 12, overflow: "hidden", background: "#000", aspectRatio: "4/3" }}>
        <video ref={videoRef} playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover", display: status === "found" ? "none" : "block" }} />
        <canvas ref={canvasRef} style={{ display: "none" }} />
        {/* Viewfinder overlay */}
        {status === "scanning" && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
            <div style={{ width: "55%", aspectRatio: "1", border: "2px solid rgba(var(--accent-rgb,37,99,235),0.8)", borderRadius: 16, boxShadow: "0 0 0 9999px rgba(22,50,74,0.12)" }} />
          </div>
        )}
        {status === "found" && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(47,133,90,0.15)" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 52 }}>✓</div>
              <p style={{ color: "#2F855A", fontWeight: 700, fontSize: 16, margin: "6px 0 0" }}>QR Detected</p>
              <p style={{ color: "var(--text-muted,#4E6B84)", fontSize: 12, margin: "4px 0 0" }}>Capturing GPS…</p>
            </div>
          </div>
        )}
        {err && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "var(--surface2,#EAF0F7)" }}>
            <p style={{ color: "#C53030", fontSize: 13, textAlign: "center" }}>{err}</p>
          </div>
        )}
      </div>
      {status === "scanning" && <p style={{ fontSize: 11, color: "var(--text-muted,#4E6B84)", textAlign: "center", marginTop: 8 }}>Point camera at the QR code on the gear</p>}
      {onClose && <button style={{ ...S.btn("ghost"), marginTop: 10, width: "100%", justifyContent: "center" }} onClick={onClose}>Cancel</button>}
    </div>
  );
}

// ─── LANG / TRANSLATIONS ─────────────────────────────────────────────────────
// The dictionary lives in src/i18n/base.js; fix tracks add keys in src/i18n/tracks/*.js
// and src/i18n/index.js merges them (see src/i18n/tracks/README.md).

export const LangCtx = createContext("en");
// The house's own crew-role list (KV `roleList`, P3-4 F18). Empty = the built-in
// department list. Context so every picker (crew profile, admin positions, job
// roster, invoice position) reads one source without threading a prop through
// ten components.
export const RolesCtx = createContext(null);
export const useRoleList = (lang) => roleOptions(lang, useContext(RolesCtx));
export const useT = () => {
  const lang = useContext(LangCtx);
  return (key) => LANG[lang]?.[key] ?? LANG.en[key] ?? key;
};

export function LangPill({ setLang }) {
  const lang = useContext(LangCtx);
  return (
    <div style={{ display: "flex", background: "var(--divider-color,#D8E1EC)", borderRadius: 6, overflow: "hidden", border: "1px solid var(--border-color,#D8E1EC)", flexShrink: 0 }}>
      {["en", "th"].map(l => (
        <button key={l} onClick={() => setLang(l)} aria-pressed={lang === l} style={{ background: lang === l ? "var(--accent,#2563EB)" : "transparent", color: lang === l ? "var(--accent-text,#FFFFFF)" : "var(--text-muted,#7B8FA3)", border: "none", minHeight: 34, minWidth: 40, padding: "6px 10px", fontSize: 11, fontWeight: 800, cursor: "pointer", letterSpacing: "0.05em", fontFamily: "inherit" }}>
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

// ─── AVAILABILITY CALCULATOR ─────────────────────────────────────────────────
// isPickEvt / isReturnEvt / isLostEvt / isVoidEvt live in src/logic/checkoutState.js;
// the availability model lives in src/logic/availability.js.
// ONE function everywhere (equipment badges, assign modal, dashboard, crew request
// picker, crew gear tab): available = total - other Confirmed jobs across their
// pickup..return window - units picked and not returned - approved loans - open
// damage reports. Never clamped: a negative number is an over-booking to show.
//   ctx = { jobs, checkouts, equipmentRequests, reports }   opts = { excludeJobId }
export function calcAvailable(equipment, targetDate, ctx = {}, opts = {}) {
  return availability(equipment || [], targetDate || today(), { ...ctx, today: today() }, opts);
}
// Dates on which a job holds its gear (pickup..return window; daily mode = shoot days).
export const jobHoldDatesOf = (job) => { const d = jobHoldDates(job || {}); return d.length ? d : [today()]; };
// Availability across a multi-day span = the WORST (minimum) day, with that day's reasons.
export function calcAvailableSpan(equipment, dates, ctx = {}, opts = {}) {
  return availabilitySpan(equipment || [], dates, { ...ctx, today: today() }, opts);
}
// Human-readable "why" lines for an availability row (used by badges + modals).
export function describeReasons(reasons, t) {
  const fmtSince = (v) => !v ? "" : typeof v === "number" ? formatDate(new Intl.DateTimeFormat("en-CA", { timeZone: APP_TZ }).format(new Date(v))) : formatDate(v);
  return (reasons || []).map(r => {
    const fill = (key) => t(key).replace("{n}", r.qty).replace("{job}", r.label || "?").replace("{date}", fmtSince(r.since)).replace("{name}", r.employeeName || "?").replace("{label}", r.label || "");
    if (r.kind === "job") return fill("avBooked");
    if (r.kind === "out") return fill(r.gone ? "avStillOutGone" : r.overdue ? "avStillOutOverdue" : "avStillOut");
    if (r.kind === "loan") return fill("avLoan");
    if (r.kind === "damage") return fill("avDamage");
    if (r.kind === "lost") return fill("avLost");
    if (r.kind === "pencil") return fill("avPencil");
    return "";
  }).filter(Boolean);
}
// Compact availability chip: green free / amber partial / red none / red CONFLICT when negative.
export function AvChip({ av, t, size = 10 }) {
  const title = describeReasons(av.reasons, t).join("\n") || undefined;
  if (av.available < 0) return <span title={title} style={{ ...S.badge("red"), fontSize: size, fontWeight: 800 }}>{t("avConflict")} {av.available}</span>;
  if (av.available === 0) return <span title={title} style={{ ...S.badge("red"), fontSize: size }}>{t("eqUnavail") || "Unavail."}</span>;
  if (av.available < av.total) return <span title={title} style={{ ...S.badge("amber"), fontSize: size }}>{av.available}/{av.total}</span>;
  return <span title={title} style={{ ...S.badge("green"), fontSize: size }}>{av.available}/{av.total}</span>;
}
// One-line reason summary under a card ("1 still out on TVC Toyota since 13 Sept").
export function AvReasons({ av, t, max = 2, style }) {
  const lines = describeReasons(av.reasons, t);
  if (!lines.length) return null;
  const hasBad = (av.reasons || []).some(r => r.kind === "out" || r.kind === "damage" || r.kind === "lost");
  return (
    <div title={lines.join("\n")} style={{ fontSize: 10, lineHeight: 1.35, color: hasBad ? "#C53030" : "var(--text-muted,#5F7A91)", ...style }}>
      {lines.slice(0, max).map((l, i) => <div key={i} style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l}</div>)}
      {lines.length > max && <div>+{lines.length - max}</div>}
    </div>
  );
}

// ─── EQUIPMENT PAGE ───────────────────────────────────────────────────────────
// QR labels for laser/inkjet: one label per item TYPE, encoding "psr_eq:<eqId>"
// (what QRScanner accepts). The QR is rendered as inline SVG by the vendored
// encoder (src/vendor/qrcodegen.js), so the print window works offline (P3-8).
export function printQRForItems(items, autoprint = true, title = "QR Labels") {
  const escHtml = (v) => String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const rows = items.map(eq => `
    <div class="label">
      <div class="qr">${qrSvg("psr_eq:" + eq.id, { size: "100%", margin: 1 })}</div>
      <div class="info">
        <div class="name">${escHtml(eq.name)}</div>
        <div class="cat">${escHtml(eq.category || "")}${eq.total > 1 ? ` · ×${+eq.total}` : ""}</div>
        <div class="code">psr_eq:${escHtml(eq.id)}</div>
      </div>
    </div>`).join("");
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escHtml(title)}</title>
<style>
  body{margin:0;padding:10mm;font-family:sans-serif;background:#fff;color:#000}
  .grid{display:flex;flex-wrap:wrap;gap:6mm}
  .label{width:55mm;border:1px solid #ccc;border-radius:3mm;padding:4mm;display:flex;align-items:center;gap:3mm;page-break-inside:avoid;box-sizing:border-box}
  .qr{width:24mm;height:24mm;flex-shrink:0}
  .qr svg{width:100%;height:100%;display:block}
  .info{flex:1;min-width:0;overflow:hidden}
  .name{font-weight:700;font-size:10pt;line-height:1.2;word-break:break-word}
  .cat{font-size:8pt;color:#555;margin-top:2px}
  .code{font-size:6pt;color:#aaa;margin-top:3px;word-break:break-all}
  @media print{body{padding:5mm}@page{size:A4;margin:10mm}}
</style></head><body>
<h2 style="margin:0 0 6mm;font-size:13pt">${escHtml(title)} (${items.length} item${items.length !== 1 ? "s" : ""})</h2>
<div class="grid">${rows}</div>
${autoprint ? "<script>setTimeout(function(){window.print();},400);<\/script>" : ""}
</body></html>`;
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export const EQ_SORT_OPTIONS = [
  { key: "name_az", label: "Name A→Z", labelKey: "sortNameAz" },
  { key: "name_za", label: "Name Z→A", labelKey: "sortNameZa" },
  { key: "cat",     label: "Category", labelKey: "sortCategory" },
  { key: "qty_lo",  label: "Qty ↑", labelKey: "sortQtyLo" },
  { key: "qty_hi",  label: "Qty ↓", labelKey: "sortQtyHi" },
  { key: "latest",  label: "Latest Used", labelKey: "sortLatest" },
  { key: "most",    label: "Most Used", labelKey: "sortMost" },
];

// Calendar feed URL with the per-tenant token (P0-2). Same host as the page so
// a local run points at the local server.
export const calendarUrl = (token) => `${window.location.origin}/api/calendar${token ? `?token=${encodeURIComponent(token)}` : ""}`;
