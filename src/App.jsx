import { useState, useEffect, useRef, useCallback, createContext, useContext } from "react";
import jsQR from "jsqr";

// ─── CONSTANTS ───────────────────────────────────────────────────────────────
const JOB_STATUSES = ["Pencil", "Confirmed", "Cancelled"];
const SHOOT_TIMES = ["Day", "Night", "Half Day / Half Night", "Half Night / Half Day"];
const LOCATIONS = ["Local (Bangkok)", "Out of Town", "Overseas"];

// ─── CLOUD API ───────────────────────────────────────────────────────────────
const api = {
  getData: () => fetch("/api/data").then(r => { if (!r.ok) throw new Error("load failed"); return r.json(); }),
  putData: (body) => fetch("/api/data", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  getProfile: (empId) => fetch(`/api/profile/${empId}`).then(r => r.ok ? r.json() : null),
  putProfile: (empId, profileObj) => fetch(`/api/profile/${empId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(profileObj) }),
  notify: (body) => fetch("/api/notify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => {}),
  shareInvoice: (html) => fetch("/api/invoice-share", { method: "POST", headers: { "Content-Type": "text/html" }, body: html }).then(r => r.json()),
  getBackup: () => fetch("/api/backup").then(r => r.ok ? r.json() : null),
  putBackup: (body) => fetch("/api/backup", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  getBackupAuto: () => fetch("/api/backup_auto").then(r => r.ok ? r.json() : null),
  putBackupAuto: (body) => fetch("/api/backup_auto", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
};

const CACHE_KEY = "psr_cache"; // localStorage key for offline fallback cache

// ─── ADMIN THEME SYSTEM ───────────────────────────────────────────────────────
const PALETTES = {
  "black-white":  { bg: "#111", s1: "#1e1e1e", s2: "#2b2b2b", bdr: "#3a3a3a", text: "#f0f0f0", muted: "#888", acc: "#e0e0e0", accT: "#111" },
  "teal-orange":  { bg: "#051414", s1: "#0c2424", s2: "#153535", bdr: "#225050", text: "#dff5f0", muted: "#5a9a8a", acc: "#ff6a2a", accT: "#fff" },
  "black-red":    { bg: "#0e0808", s1: "#1c0e0e", s2: "#281414", bdr: "#3e1818", text: "#f0dddd", muted: "#9a6060", acc: "#dd3333", accT: "#fff" },
  "white-blue":   { bg: "#edf2f8", s1: "#ffffff", s2: "#dce8f5", bdr: "#b8d0e8", text: "#162030", muted: "#5878a0", acc: "#1a60d0", accT: "#fff" },
  "black-yellow": { bg: "#0e0e08", s1: "#191910", s2: "#232318", bdr: "#353520", text: "#f0f0dc", muted: "#8a8a68", acc: "#e8b84b", accT: "#0e0e08" },
  "black-blue":   { bg: "#07090e", s1: "#0e121e", s2: "#151c2c", bdr: "#1c2c44", text: "#c8d8f0", muted: "#5878a8", acc: "#3a80e8", accT: "#fff" },
};
const hexRgb = (h) => { const n = parseInt(h.replace("#",""), 16); return `${(n>>16)&255},${(n>>8)&255},${n&255}`; };
const isLight = (hex) => { const n = parseInt(hex.replace("#",""),16); const r=(n>>16)&255,g=(n>>8)&255,b=n&255; return (0.299*r+0.587*g+0.114*b)>128; };

function buildThemeCss(style, palette) {
  const p = PALETTES[palette]; if (!p) return "";
  const light = isLight(p.bg);
  const [accR, s1R, bgR, txtR] = [hexRgb(p.acc), hexRgb(p.s1), hexRgb(p.bg), hexRgb(p.text)];

  const base = `#admin-layout{--bg:${p.bg};--surface:${p.s1};--surface2:${p.s2};--border-color:${p.bdr};--text:${p.text};--text-muted:${p.muted};--accent:${p.acc};--accent-text:${p.accT};--btn-primary-bg:${p.acc};--btn-primary-color:${p.accT};--section-title-color:${p.muted};--divider-color:${p.bdr};--tag-bg:${p.s2};--tag-color:${p.muted};}`;

  let sv = "";
  if (style === "neumorphism") {
    const dSh = light ? "rgba(0,0,0,0.18)" : "rgba(0,0,0,0.48)";
    const lSh = light ? "rgba(255,255,255,0.88)" : "rgba(255,255,255,0.04)";
    sv = `#admin-layout{--card-border:none;--card-radius:18px;--card-backdrop:none;--card-shadow:8px 8px 18px ${dSh},-5px -5px 12px ${lSh};--input-bg:${p.bg};--input-border:none;--input-shadow:inset 4px 4px 9px ${dSh},inset -3px -3px 6px ${lSh};--btn-radius:12px;--btn-shadow:5px 5px 12px ${dSh},-3px -3px 7px ${lSh};--topbar-bg:${p.s1};--topbar-border:none;--topbar-shadow:0 4px 18px ${dSh};--nav-bg:${p.s1};--nav-border:none;--nav-shadow:0 -4px 18px ${dSh};}`;
  } else if (style === "glassmorphism") {
    sv = `#admin-layout{--bg:radial-gradient(ellipse at 20% 20%,rgba(${accR},0.22) 0%,transparent 52%),radial-gradient(ellipse at 80% 78%,rgba(${s1R},0.42) 0%,transparent 55%),${p.bg};--surface:rgba(${s1R},0.2);--card-border:1px solid rgba(${txtR},0.1);--card-radius:16px;--card-shadow:0 8px 32px rgba(0,0,0,0.25);--card-backdrop:blur(20px);--input-bg:rgba(${bgR},0.52);--input-border:1px solid rgba(${txtR},0.14);--input-shadow:none;--btn-radius:10px;--btn-shadow:0 4px 16px rgba(0,0,0,0.2);--topbar-bg:rgba(${bgR},0.65);--topbar-border:none;--topbar-shadow:none;--nav-bg:rgba(${bgR},0.72);--nav-border:none;--nav-shadow:none;--tag-bg:rgba(${s1R},0.45);}`;
  } else if (style === "skeuomorphism") {
    sv = `#admin-layout{--surface:linear-gradient(145deg,${p.s2} 0%,${p.s1} 100%);--card-border:1px solid ${p.bdr};--card-radius:8px;--card-backdrop:none;--card-shadow:0 2px 0 rgba(0,0,0,0.5),0 6px 20px rgba(0,0,0,0.3),inset 0 1px 0 rgba(255,255,255,0.07);--input-bg:${p.bg};--input-border:2px solid ${p.bdr};--input-shadow:inset 0 2px 5px rgba(0,0,0,0.45);--btn-radius:6px;--btn-shadow:0 3px 0 rgba(0,0,0,0.5),0 5px 12px rgba(0,0,0,0.3),inset 0 1px 0 rgba(255,255,255,0.15);--topbar-bg:linear-gradient(180deg,${p.s2} 0%,${p.bg} 100%);--topbar-border:1px solid ${p.bdr};--topbar-shadow:0 3px 12px rgba(0,0,0,0.4);--nav-bg:linear-gradient(0deg,${p.bg} 0%,${p.s2} 100%);--nav-border:1px solid ${p.bdr};--nav-shadow:0 -3px 12px rgba(0,0,0,0.4);}`;
  }
  return base + sv;
}

// ─── ICON COMPONENTS ─────────────────────────────────────────────────────────
const Icon = ({ d, size = 18, color = "currentColor", fill = "none", strokeW = 1.8 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={color} strokeWidth={strokeW} strokeLinecap="round" strokeLinejoin="round">
    {Array.isArray(d) ? d.map((p, i) => <path key={i} d={p} />) : <path d={d} />}
  </svg>
);

const icons = {
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
};

// ─── UTILITY: Date / time helpers ────────────────────────────────────────────
// Admin-configurable, updated from cloud data on load so date math & time display
// never depend on the device's locale/timezone guess.
let APP_TZ = "Asia/Bangkok";   // IANA timezone id
let TIME_FMT = "24";           // "12" | "24"
function setTimePrefs(tz, fmt) { if (tz) APP_TZ = tz; if (fmt) TIME_FMT = fmt; }

const today = () => {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: APP_TZ }).format(new Date()); }
  catch { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
};

// Format an "HH:MM" 24-hour string per the admin time-format preference.
function fmtClock(t) {
  if (!t) return "—";
  const [h, m] = t.slice(0, 5).split(":").map(Number);
  if (Number.isNaN(h)) return "—";
  if (TIME_FMT === "12") { const ampm = h >= 12 ? "PM" : "AM"; const h12 = h % 12 || 12; return `${h12}:${String(m).padStart(2, "0")} ${ampm}`; }
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// Hours between two "HH:MM" times (handles an overnight wrap).
function hoursWorked(call, wrap) {
  if (!call || !wrap) return 0;
  const [ch, cm] = call.slice(0, 5).split(":").map(Number);
  const [wh, wm] = wrap.slice(0, 5).split(":").map(Number);
  let mins = (wh * 60 + wm) - (ch * 60 + cm);
  if (mins < 0) mins += 24 * 60;
  return mins / 60;
}

const DEFAULT_OT_TIERS = [{ untilHour: 14, mult: 1.5 }, { untilHour: 16, mult: 2 }, { untilHour: 18, mult: 3 }];

// Overtime amount (THB) for one day worked, under a position's rate rules.
// ratePerHour = dayRate / hoursPerDay. Flat OT = otHours × ratePerHour × otMultiplier.
// Variable OT walks tiered multipliers by total-hour bands (e.g. 12–14h ×1.5, 14–16h ×2…).
function calcOtAmount(call, wrap, pos) {
  if (!pos) return 0;
  const base = parseFloat(pos.hoursPerDay) || 12;
  const worked = hoursWorked(call, wrap);
  if (worked <= base) return 0;
  const dayRate = parseFloat(pos.dayRate) || 0;
  const ratePerHour = base > 0 ? dayRate / base : 0;
  if (pos.variableOT && (pos.otTiers || []).length) {
    const tiers = (pos.otTiers || [])
      .map(tr => ({ untilHour: parseFloat(tr.untilHour), mult: parseFloat(tr.mult) }))
      .filter(tr => tr.untilHour > 0 && tr.mult > 0)
      .sort((a, b) => a.untilHour - b.untilHour);
    let cursor = base, amount = 0;
    for (const tr of tiers) {
      if (tr.untilHour <= cursor) continue;
      const segEnd = Math.min(worked, tr.untilHour);
      if (segEnd > cursor) { amount += (segEnd - cursor) * ratePerHour * tr.mult; cursor = segEnd; }
      if (cursor >= worked) break;
    }
    if (cursor < worked) {
      const lastMult = tiers.length ? tiers[tiers.length - 1].mult : (parseFloat(pos.otMultiplier) || 1.5);
      amount += (worked - cursor) * ratePerHour * lastMult;
    }
    return amount;
  }
  const mult = parseFloat(pos.otMultiplier) || 1.5;
  return (worked - base) * ratePerHour * mult;
}

const TIMEZONES = [
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

const haversineMeters = (lat1, lon1, lat2, lon2) => { const R=6371000,φ1=lat1*Math.PI/180,φ2=lat2*Math.PI/180,Δφ=(lat2-lat1)*Math.PI/180,Δλ=(lon2-lon1)*Math.PI/180,a=Math.sin(Δφ/2)**2+Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2; return 2*R*Math.atan2(Math.sqrt(a),Math.sqrt(1-a)); };
const formatDate = (d) => new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const formatDateTime = (ts) => new Date(ts).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

// ─── KPI scoring ─────────────────────────────────────────────────────────────
const KPI_MAX_DEFAULT = 100; // 100 pts == 5 stars
const kpiAddMonths = (d, m) => { const x = new Date(d); x.setMonth(x.getMonth() + m); return x; };
const kpiMax = (config) => parseFloat(config && config.maxPoints) || KPI_MAX_DEFAULT;
// Current scoring window [start, end) from config.startDate (default Jan 1) + resetMonths.
function kpiPeriod(config) {
  const startStr = (config && config.startDate) || `${new Date().getFullYear()}-01-01`;
  const start = new Date(startStr + "T00:00:00");
  const months = Math.max(1, parseInt(config && config.resetMonths) || 12);
  const now = new Date(today() + "T00:00:00");
  if (now < start) return { start, end: kpiAddMonths(start, months) };
  let s = new Date(start), guard = 0;
  while (guard++ < 4000) { const e = kpiAddMonths(s, months); if (now < e) return { start: s, end: e }; s = e; }
  return { start, end: kpiAddMonths(start, months) };
}
// Points remaining this period for an employee (max minus deductions).
function kpiScore(employeeId, kpiEvents, config) {
  const max = kpiMax(config);
  const { start, end } = kpiPeriod(config);
  const used = (kpiEvents || [])
    .filter(ev => ev.employeeId === employeeId && ev.ts >= start.getTime() && ev.ts < end.getTime())
    .reduce((s, ev) => s + (parseFloat(ev.points) || 0), 0);
  return Math.max(0, Math.min(max, max - used));
}
const kpiStars = (score, config) => { const max = kpiMax(config); return max > 0 ? (score / max) * 5 : 0; };

// 5-star rating with fractional fill (0.1 resolution).
function StarRating({ value, size = 18 }) {
  const pct = Math.max(0, Math.min(100, (value / 5) * 100));
  return (
    <div style={{ position: "relative", display: "inline-block", fontSize: size, lineHeight: 1, letterSpacing: 2, fontFamily: "Arial, sans-serif" }}>
      <div style={{ color: "#3a3f4a" }}>★★★★★</div>
      <div style={{ position: "absolute", top: 0, left: 0, width: pct + "%", overflow: "hidden", whiteSpace: "nowrap", color: "#e8b84b" }}>★★★★★</div>
    </div>
  );
}

// Downscale + JPEG-compress an image (File or dataURL) BEFORE it is stored in KV.
// Photos from phones are multi-MB; this keeps the single `data` record and profile
// records small (KV per-key cap is 25 MB). Returns a Promise<dataURL>.
function compressImage(input, { maxDim = 1200, quality = 0.72 } = {}) {
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
const S = {
  app: { minHeight: "100vh", background: "var(--bg,#0f1117)", color: "var(--text,#e8e4dc)", fontFamily: "'Inter','SF Pro Display',system-ui,sans-serif", fontSize: 14 },
  topbar: { height: 54, background: "var(--topbar-bg,#161920)", borderBottom: "var(--topbar-border,1px solid #252830)", boxShadow: "var(--topbar-shadow,none)", backdropFilter: "var(--card-backdrop,none)", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px", position: "sticky", top: 0, zIndex: 100 },
  main: { minHeight: "calc(100vh - 54px)", padding: "20px 16px" },
  logo: { display: "flex", alignItems: "center", gap: 8 },
  logoText: { fontSize: 15, fontWeight: 700, letterSpacing: "0.04em", color: "var(--accent,#e8b84b)" },
  logoSub: { fontSize: 10, color: "var(--text-muted,#666)", letterSpacing: "0.12em", textTransform: "uppercase" },
  navItem: (active) => ({ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", cursor: "pointer", color: active ? "var(--accent,#e8b84b)" : "var(--text,#e8e4dc)", background: active ? "rgba(232,184,75,0.07)" : "transparent", borderLeft: active ? "3px solid var(--accent,#e8b84b)" : "3px solid transparent", fontSize: 14, fontWeight: active ? 700 : 400 }),
  card: { background: "var(--surface,#1a1e27)", border: "var(--card-border,1px solid #252830)", borderRadius: "var(--card-radius,10px)", padding: 20, boxShadow: "var(--card-shadow,none)", backdropFilter: "var(--card-backdrop,none)" },
  cardGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 14 },
  badge: (color) => ({ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", ...(color === "green" ? { background: "rgba(52,211,153,0.12)", color: "#34d399" } : color === "amber" ? { background: "rgba(232,184,75,0.12)", color: "#e8b84b" } : color === "red" ? { background: "rgba(239,68,68,0.12)", color: "#f87171" } : color === "blue" ? { background: "rgba(96,165,250,0.12)", color: "#60a5fa" } : color === "gray" ? { background: "rgba(148,163,184,0.1)", color: "#94a3b8" } : {}) }),
  input: { width: "100%", background: "var(--input-bg,#0f1117)", border: "var(--input-border,1px solid #2e3340)", boxShadow: "var(--input-shadow,none)", borderRadius: "var(--btn-radius,7px)", padding: "9px 12px", color: "var(--text,#e8e4dc)", fontSize: 13, outline: "none", boxSizing: "border-box" },
  select: { width: "100%", background: "var(--input-bg,#0f1117)", border: "var(--input-border,1px solid #2e3340)", boxShadow: "var(--input-shadow,none)", borderRadius: "var(--btn-radius,7px)", padding: "9px 12px", color: "var(--text,#e8e4dc)", fontSize: 13, outline: "none", boxSizing: "border-box", cursor: "pointer" },
  label: { display: "block", marginBottom: 5, fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", color: "var(--section-title-color,#8a8f9d)", textTransform: "uppercase" },
  btn: (variant = "primary") => ({
    display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: "var(--btn-radius,7px)", fontSize: 13, fontWeight: 600, cursor: "pointer", border: "none", transition: "all 0.15s",
    ...(variant === "primary" ? { background: "var(--btn-primary-bg,#e8b84b)", color: "var(--btn-primary-color,#0f1117)", boxShadow: "var(--btn-shadow,none)" } : variant === "ghost" ? { background: "transparent", color: "var(--text-muted,#8a8f9d)", border: "var(--input-border,1px solid #2e3340)" } : variant === "danger" ? { background: "rgba(239,68,68,0.12)", color: "#f87171", border: "1px solid rgba(239,68,68,0.2)" } : variant === "success" ? { background: "rgba(52,211,153,0.12)", color: "#34d399", border: "1px solid rgba(52,211,153,0.2)" } : {})
  }),
  sectionTitle: { fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--section-title-color,#8a8f9d)", marginBottom: 16 },
  pageTitle: { fontSize: 22, fontWeight: 700, marginBottom: 4, color: "var(--text,#e8e4dc)" },
  pageSubtitle: { fontSize: 13, color: "var(--text-muted,#666)", marginBottom: 28 },
  divider: { borderTop: "1px solid var(--divider-color,#252830)", margin: "20px 0" },
  row: { display: "flex", alignItems: "center", gap: 12 },
  col: { display: "flex", flexDirection: "column", gap: 12 },
  tag: { display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 11, background: "var(--tag-bg,#252830)", color: "var(--tag-color,#8a8f9d)", fontWeight: 500 },
};

// ─── MODAL ───────────────────────────────────────────────────────────────────
function Modal({ title, onClose, children, wide }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ background: "#1a1e27", border: "1px solid #2e3340", borderRadius: 12, width: "100%", maxWidth: wide ? 700 : 480, maxHeight: "90vh", overflow: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 24px", borderBottom: "1px solid #252830" }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{title}</h3>
          <button onClick={onClose} style={{ ...S.btn("ghost"), padding: "4px 8px" }}><Icon d={icons.x} size={16} /></button>
        </div>
        <div style={{ padding: 24 }}>{children}</div>
      </div>
    </div>
  );
}

// ─── AVAILABILITY BAR ────────────────────────────────────────────────────────
function AvailBar({ available, total }) {
  return (
    <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} style={{ width: 12, height: 12, borderRadius: 3, background: i < available ? "#e8b84b" : "#2e3340" }} />
      ))}
    </div>
  );
}

// ─── PHOTO CAPTURE (geo-locked) ──────────────────────────────────────────────
// Uses the phone's NATIVE camera via a file input (capture="environment").
// This works in every mobile browser INCLUDING in-app webviews (LINE, Instagram,
// Facebook) where the live getUserMedia() preview is blocked — that was the cause
// of the "Open Camera does nothing" reports. Geo-lock is preserved by stamping the
// timestamp + GPS onto the captured still; onCapture(dataUrl, location) is unchanged.
function GeoPhoto({ onCapture, label }) {
  const fileRef = useRef(null);
  const [location, setLocation] = useState(null);
  const [locErr, setLocErr] = useState(null);
  const [photo, setPhoto] = useState(null);
  const [busy, setBusy] = useState(false);

  // Best-effort GPS. Resolves with the location object or null.
  const getGPS = () => new Promise(resolve => {
    if (!navigator.geolocation) { setLocErr("Location unavailable — photo still saved with timestamp."); return resolve(null); }
    navigator.geolocation.getCurrentPosition(
      (pos) => { const l = { lat: pos.coords.latitude.toFixed(5), lng: pos.coords.longitude.toFixed(5), acc: Math.round(pos.coords.accuracy) }; setLocation(l); resolve(l); },
      () => { setLocErr("Location unavailable — photo still saved with timestamp."); resolve(null); },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );
  });

  // Scale down and burn timestamp + GPS into the image.
  const stamp = (img, loc) => {
    const sw = img.naturalWidth || img.width, sh = img.naturalHeight || img.height;
    const scale = Math.min(1, 1600 / Math.max(sw, sh));
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
    return canvas.toDataURL("image/jpeg", 0.85);
  };

  const onFilePicked = (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = ""; // allow re-picking the same file
    if (!f) return;
    setBusy(true);
    setLocErr(null);
    const gpsP = getGPS(); // request GPS while the image decodes
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = async () => {
        const loc = await gpsP.catch(() => null);
        const dataUrl = stamp(img, loc);
        setPhoto(dataUrl);
        setBusy(false);
        onCapture(dataUrl, loc);
      };
      img.onerror = () => { setLocErr("Could not read that photo. Please try again."); setBusy(false); };
      img.src = ev.target.result;
    };
    reader.onerror = () => { setLocErr("Could not read that photo. Please try again."); setBusy(false); };
    reader.readAsDataURL(f);
  };

  return (
    <div style={{ ...S.card, background: "#0f1117" }}>
      <p style={S.label}>{label || "Capture Verification Photo"}</p>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={onFilePicked} />
      {!photo && (
        <button style={{ ...S.btn("primary"), justifyContent: "center", padding: "14px", fontSize: 16, width: "100%" }} onClick={() => fileRef.current && fileRef.current.click()} disabled={busy}>
          <Icon d={icons.camera} size={18} /> {busy ? "Processing…" : "Open Camera"}
        </button>
      )}
      {locErr && <p style={{ fontSize: 12, color: "#f59e0b", marginTop: 8 }}>{locErr}</p>}
      {photo && (
        <div style={{ marginTop: 12 }}>
          <img src={photo} alt="captured" style={{ width: "100%", borderRadius: 8 }} />
          <p style={{ fontSize: 11, color: "#34d399", margin: "8px 0 0" }}>✓ Photo captured with timestamp{location ? " & GPS" : ""}</p>
          <button style={{ ...S.btn("ghost"), marginTop: 8, justifyContent: "center", width: "100%" }} onClick={() => { setPhoto(null); setLocation(null); setLocErr(null); fileRef.current && fileRef.current.click(); }}>↻ Retake Photo</button>
        </div>
      )}
    </div>
  );
}

// ─── QR SCANNER ──────────────────────────────────────────────────────────────
// Live camera viewfinder that decodes QR codes frame-by-frame using jsQR.
// Calls onScan(rawValue, geoLocation) the first time a valid QR is decoded.
// Equipment QR codes encode the equipment ID as plain text: "psr_eq:{eqId}"
function QRScanner({ onScan, onClose, label }) {
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
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );
  });

  useEffect(() => {
    let stopped = false;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then(stream => {
        if (stopped) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().then(() => { setStatus("scanning"); tick(); }).catch(() => setErr("Camera error."));
        }
      })
      .catch(() => setErr("Camera access denied — allow camera in browser settings."));

    const tick = () => {
      if (stopped || scannedRef.current) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < 2) { rafRef.current = requestAnimationFrame(tick); return; }
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
            <div style={{ width: "55%", aspectRatio: "1", border: "2px solid rgba(232,184,75,0.8)", borderRadius: 16, boxShadow: "0 0 0 9999px rgba(0,0,0,0.35)" }} />
          </div>
        )}
        {status === "found" && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(52,211,153,0.15)" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 52 }}>✓</div>
              <p style={{ color: "#34d399", fontWeight: 700, fontSize: 16, margin: "6px 0 0" }}>QR Detected</p>
              <p style={{ color: "#8a8f9d", fontSize: 12, margin: "4px 0 0" }}>Capturing GPS…</p>
            </div>
          </div>
        )}
        {err && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "#0f1117" }}>
            <p style={{ color: "#f87171", fontSize: 13, textAlign: "center" }}>{err}</p>
          </div>
        )}
      </div>
      {status === "scanning" && <p style={{ fontSize: 11, color: "#8a8f9d", textAlign: "center", marginTop: 8 }}>Point camera at the QR code on the gear</p>}
      {onClose && <button style={{ ...S.btn("ghost"), marginTop: 10, width: "100%", justifyContent: "center" }} onClick={onClose}>Cancel</button>}
    </div>
  );
}

// ─── LANG / TRANSLATIONS ─────────────────────────────────────────────────────
const LANG = {
  en: {
    // Nav
    navDashboard: "Dashboard", navEquipment: "Equipment", navJobs: "Job Bookings",
    navTeam: "Team", navReports: "Reports", navInvoice: "Invoice", navCheckout: "Checkout",
    tabInvoice: "Invoice",
    personalInfo: "Personal Info", documents: "Documents", legalAddress: "Legal Address",
    phone: "Phone", email: "Email", lineId: "Line ID", idCard: "ID Card", promptPayQR: "PromptPay / Bank QR",
    myInvoices: "My Invoices", createInvoice: "Create Invoice", noInvoicesYet: "No invoices yet.",
    confirmJobs: "Confirmed Jobs", selectJob: "Select a confirmed job to invoice",
    // Employee tabs
    tabToday: "Today", tabSchedule: "Schedule", tabProfile: "Profile", tabReport: "Report",
    // Today tab
    crew: "Crew",
    todaysJobs: "Today's Jobs",
    noJobsToday: "No confirmed jobs with assigned equipment today.",
    allReturned: "✓ All Returned",
    onShoot: "🎬 On Shoot — Tap to Return",
    gearOutTitle: "Gear Out — Tap to Return",
    outBadge: "out",
    readyPick: "Ready to Pick Up",
    itemsAssigned: "items assigned",
    // Schedule tab
    jobSchedule: "Job Schedule",
    tapJobBar: "Tap any job bar to see details",
    // Profile tab
    myProfile: "My Profile",
    crewCard: "Your crew card",
    cameraCrew: "Camera Crew",
    uploadPhoto: "Upload Photo", replacePhoto: "Replace", uploadSignature: "Upload Signature",
    takeSelfie: "Take Selfie",
    removePhoto: "Remove Photo",
    recentActivity: "My Recent Activity",
    noActivity: "No activity yet.",
    pickEvt: "PICK", returnEvt: "RETURN",
    // Checkout flow
    pickPhase: "Pick Up", returnPhase: "Return",
    tickWhenReady: "— Tick each item when ready",
    alreadyProcessed: "Already processed",
    tickAllWarning: "⚠ Tick all items before proceeding.",
    proceedPhoto: "Proceed to Photo Verification →",
    pickUpPhoto: "Pick-Up Photo", returnPhoto: "Return Photo",
    photoInstruction: "Take a group photo of all equipment — it will be geo-stamped as proof.",
    photoLiveWarning: "Photo must be taken live. Gallery not allowed.",
    capturePickPhoto: "Capture Equipment Pick-Up Photo",
    captureReturnPhoto: "Capture Equipment Return Photo",
    confirmPickUp: "Confirm Pick Up", confirmReturn: "Confirm Return",
    backToJobs: "← Back to Jobs",
    gearPickedUp: "Gear Picked Up!", gearReturned: "Gear Returned!",
    savedGPS: "Saved with timestamp and GPS.", savedNoGPS: "Saved with timestamp.",
    // Reports
    reportTitle: "Damage Reports", reportNew: "New Report", reportNone: "No damage reports yet.",
    reportDescription: "Description *", reportDate: "Date & Time of Incident",
    reportEquipment: "Related Equipment", reportNoEquipment: "— No specific equipment —",
    reportOther: "Other / specify below", reportOtherName: "Equipment name",
    reportPhotos: "Photos", reportCamera: "Camera", reportGallery: "Gallery",
    reportSubmit: "Submit Report", reportSubmitted: "Report submitted!",
    reportStatusOpen: "Open", reportStatusSolved: "Solved", reportStatusDiscarded: "Discarded",
    reportSolve: "Mark Solved", reportDiscard: "Discard", reportUnresolved: "unresolved",
    reportBy: "Reported by", reportAll: "All",
    myReports: "My damage reports",
    // Gear requests (employee)
    gearRequests: "Gear Requests", noGearRequests: "No gear requests yet.", requestBtn: "Request",
    reqWork: "Work: ", reqPractice: "Practice",
    reqGearModalTitle: "Request Gear Checkout", datesNeeded: "Dates Needed", tapDatesHint: "Tap dates to select — availability updates per date",
    selectEquipment: "Select Equipment", purposeLabel: "Purpose",
    purposePractice: "Practice / Personal Use", purposeWork: "Work (Production)",
    productionHouse: "Production House", reasonLabel: "Reason", reasonPlaceholder: "Why do you need this gear?",
    submitRequest: "Submit Request",
    // Profile
    firstName: "First Name", lastName: "Last Name", nickname: "Nickname", shownInPortal: "(shown in portal)",
    bankDetails: "Bank Details", bankNameLabel: "Bank Name", accountNameLabel: "Account Name", accountNumberLabel: "Account Number",
    changePasscode: "Change Passcode", newPinLabel: "New PIN (4–6 digits)", confirmPinLabel: "Confirm PIN", updatePasscode: "Update Passcode",
    signatureSection: "Signature (on white background)", signatureHint: "Sign on white paper, photograph it. The system will automatically remove the white background.",
    calendarSync: "Calendar Sync",
    kpiMyScore: "⭐ My KPI Score", kpiFullScore: "✓ Full score — no deductions this period. Keep it up!",
    kpiDeductions: "Deductions",
    kpiPts: "pts",
    profileSaveBtn: "Save Profile", profileSaving: "Saving…", profileSaved: "✓ Profile Saved", profileSaveFail: "Save Failed — Tap to Retry",
    positionsTitle: "Positions & Day Rates",
    positionsDesc: "Add up to 5 roles. Picking a role on an invoice auto-fills its day rate, and overtime is calculated from your call/wrap times.",
    positionsEmpty: "No roles yet — add one to auto-fill your invoices.",
    addRoleBtn: "Add Role", roleLabel: "Role",
    positionName: "Position Name", dayRateLabel: "Day Rate (฿)", hoursPerDayLabel: "Hours / Day",
    hourlyRate: "Hourly rate", perHr: "/hr",
    otLabel: "Overtime (after {h}h)", flatOT: "Flat OT", variableOT: "Variable OT",
    otMultiplierLabel: "OT Multiplier (× hourly rate)",
    otTiersLabel: "OT Tiers (hour band → multiplier)", addTierBtn: "Tier",
    otTiersNote: "Each tier covers hours up to its limit. Hours beyond the last tier use the last multiplier.",
    // Job form (admin)
    newJob: "New Job", editJob: "Edit Job",
    jobNameField: "Job Name", productionCoField: "Production Company",
    jobStatusField: "Job Status", shootTimeField: "Shoot Time", locationField: "Location Type",
    contactPersonField: "Contact Person", contactPlatformField: "Contact Platform",
    datesField: "Production Dates (tap to select/deselect)", viewNextMonth: "View next month →", saveJob: "Save Job",
    // Common
    cancel: "Cancel", save: "Save", logout: "Log Out", back: "Back", loading: "Loading…",
    qty: "Qty",
    // Equipment page (admin)
    eqLibrary: "Equipment Library", eqAvailToday: "available today", eqAdd: "Add",
    eqAddModal: "Add Equipment", eqEditModal: "Edit Equipment",
    eqItemName: "Item Name", eqCategory: "Category", eqTotalUnits: "Total Units Owned",
    eqOptNotes: "Optional notes", eqChangePhoto: "Change Photo", eqSaveEquipment: "Save Equipment",
    eqNoHistory: "No checkout history yet.", eqSelectCat: "— Select category —",
    eqNewCat: "＋ Add new category…", eqDeleteConfirm: "Delete this equipment?", eqAll: "All",
    eqUnavail: "Unavail.", eqHistoryTitle: "History",
    // Jobs page (admin)
    jobBookings: "Job Bookings", jobNewJob: "New Job", jobNoJobs: "No jobs yet. Add your first job above.",
    jobAssignGear: "Assign Gear", jobProductionDates: "Production Dates", jobAssignedEq: "Assigned Equipment",
    jobReturnMode: "Return Mode",
    jobSpanLabel: "Pick first · Return last day", jobSpanDesc: "Gear stays out for the whole shoot",
    jobDailyLabel: "Pick & Return every day", jobDailyDesc: "Crew returns gear at the end of each shoot day",
    jobTapAssign: "Tap a card to assign or unassign. Use +/− for multi-unit items.",
    jobAssigned: "Assigned", jobSaveAssign: "Save Assignment", jobDeleteConfirm: "Delete this job?",
    jobRoles: "Verification Roles", jobRolesBarcode: "Barcode scanner", jobRolesPhoto: "Photographer",
    jobRolesAnyone: "Anyone", jobRolesFixed: "Fixed member",
    jobDailyReturn: "Daily return", jobAvailable: "Available", jobUnavailable: "Unavailable",
    // Dashboard (admin)
    dashOverview: "Overview", dashTodayJobsLabel: "Today's Jobs",
    dashConfirmedLabel: "Confirmed Jobs", dashPencilLabel: "Pencil Jobs",
    statusConfirmed: "Confirmed", statusPencil: "Pencil", statusCancelled: "Cancelled",
    dashNoJobsCategory: "No jobs in this category.",
    dashEqOutToday: "Equipment Out Today", dashAllAvail: "✓ All equipment available.",
    dashStillOut: "Not Returned", dashStillOutOverdue: "OVERDUE", dashStillOutActive: "OUT",
    dashStillOutEmpty: "✓ All gear has been returned.",
    dashRecentActivity: "Recent Activity", dashNoActivity: "No activity recorded yet.",
    dashPicked: "PICKED", dashReturned: "RETURNED",
    dashGearRequests: "Gear Requests", dashNoRequests: "No requests yet.",
    dashApprovals: "Approvals", dashEdit: "Edit",
    dashItems: "items", dashItem: "item",
    dashApproveAll: "Approve all", dashApprove: "Approve", dashDeny: "Deny", dashReject: "Reject",
    dashClose: "Close", dashPending: "pending", dashResolved: "resolved",
    dashPendingFilter: "Pending", dashResolvedFilter: "Resolved", dashAllFilter: "All",
    dashNoPending: "No pending approvals — you're all caught up.",
    dashNoResolved: "No resolved requests yet.", dashNoAll: "No approval requests yet.",
    dashGearReqDetail: "Gear Request Detail", dashRequestedItems: "Requested Items",
    dashDateNeeded: "Date Needed", dashDatesNeeded: "Dates Needed",
    dashPurpose: "Purpose", dashReason: "Reason", dashCheckoutStatus: "Checkout Status",
    dashByLabel: "by", dashGuest: "Guest", dashReturn: "Return",
    dashGpsFrom: "m from pickup", dashGpsUnavail: "GPS unavailable at return",
    dashTypeProductionHouse: "Production House", dashTypeEquipment: "Equipment", dashTypeNewMember: "New Member",
    dashRequested: "Requested",
    // Team (admin)
    teamTitle: "Team", teamManageCrew: "Manage crew access", teamAddMember: "Add Member",
    teamMembers: "Team Members", teamNoMembers: "No team members yet.",
    teamEqRequests: "Equipment Requests", teamNoEqRequests: "No equipment requests yet.",
    teamPinShow: "show", teamPinHide: "hide", teamRemoveConfirm: "Remove this team member?",
    teamAddTitle: "Add Team Member", teamEditTitle: "Edit Team Member",
    teamNameLabel: "Name", teamPinLabel: "PIN (4–6 digits)",
    teamAddMemberBtn: "Add Member", teamSaveChanges: "Save Changes",
    teamNameRequired: "Name is required.", teamPinRequired: "PIN is required.", teamPinInvalid: "PIN must be 4–6 digits.",
    teamKpiScore: "⭐ KPI Score", teamKpiPeriod: "Period",
    teamKpiCustomDeduction: "Custom deduction…", teamKpiPoints: "Points",
    teamKpiReason: "Reason (shown to employee)", teamKpiDeduct: "Deduct Points",
    teamKpiDeductionsThisPeriod: "Deductions this period", teamKpiUndo: "Undo",
    teamKpiErrPoints: "Enter points to deduct.", teamKpiErrReason: "Reason is required.",
    teamKpiDeductedMsg: "Deducted {pts} pts.", teamKpiPeriodLabel: "Period:",
    teamNoProfileDocs: "No profile documents uploaded yet.",
    teamPractice: "Practice", teamWork: "Work",
    teamPendingReqs: "pending", teamApprove: "Approve", teamDeny: "Deny",
    // Settings
    settingsTitle: "Settings", settingsLanguage: "Language",
    settingsNavOrder: "Navigation Order", settingsNavOrderDesc: "Set the order of the bottom tabs.", settingsNavOrderReset: "Reset to Default",
    settingsTheme: "🎨 Theme", settingsThemeStyle: "Style", settingsThemeColor: "Color",
    settingsUsesDefault: "uses default",
    settingsCompany: "Company", settingsCompanyHint: "Appears in the top bar and login screen.",
    settingsDateTime: "Date & Time", settingsTimezone: "Timezone",
    settingsTimezoneHint: "Used for \"today\" date calculations and the job calendar, so the app never guesses from the device.",
    settingsTimeFormat: "Time Format", settingsTimeFormatHint: "Applies to call/wrap times shown on invoices.",
    settingsCheckout: "Checkout Verification",
    settingsVerifNone: "None", settingsVerifNoneDesc: "Tap to confirm — no photo, no scan, no GPS.",
    settingsVerifPhoto: "Photo + GPS", settingsVerifPhotoDesc: "Crew photograph each item. Return GPS matched to pickup (±50 m).",
    settingsVerifBarcode: "Barcode + GPS", settingsVerifBarcodeDesc: "Crew scan the QR label on each item. GPS captured at scan time.",
    settingsVerifBoth: "Both (Photo & Barcode)", settingsVerifBothDesc: "Both a QR scan and a photo are required. Roles assigned per job.",
    settingsClearHistory: "Clear Pickup/Return History", settingsClearHistoryDesc: "Removes all pick and return records. Equipment items are NOT deleted — only the transaction log is cleared.",
    settingsClearHistoryCount: "{n} records", settingsClearHistoryConfirm: "This will permanently delete all pickup/return history. Equipment stays intact. Are you sure?",
    settingsClearHistoryYes: "Yes, Clear History", settingsClearHistoryDone: "✓ History cleared.",
    settingsPhotoOn: "Photo verification ON", settingsPhotoOff: "Photo verification OFF",
    settingsPhotoOnDesc: "Crew take a photo of each item when checking out / returning. Return GPS is matched to pickup (within 50 m, else admin approval).",
    settingsPhotoOffDesc: "Crew tap each item to check out / return instantly — no photo, no GPS check.",
    settingsKpiTitle: "⭐ KPI Scoring", settingsKpiPeriodStart: "Period Start",
    settingsKpiReset: "Reset (months)", settingsKpiMaxPoints: "Starting Points",
    settingsKpiPunishments: "Punishments", settingsKpiNoPunishments: "No punishments yet.",
    settingsKpiAddPunishment: "Add",
    settingsKpiPunDesc: "Preset deductions you can pick when scoring a teammate. Label is shown to the employee as the reason.",
    settingsKpiEveryoneStarts: "Everyone starts each period at", settingsKpiCurrPeriod: "Current period:",
    settingsKpiDefaultStart: "Default start is Jan 1.",
    settingsLineTitle: "Line OA Notifications",
    settingsLineConnected: "Group chat connected", settingsLineNotConnected: "No group chat connected",
    settingsLineRefresh: "↻ Refresh", settingsLineDisconnect: "Disconnect",
    settingsLineMuted: "🔕 Notifications muted", settingsLineActive: "🔔 Notifications active",
    settingsLineMutedDesc: "No messages sent to LINE — testing mode",
    settingsLineActiveDesc: "All job/report/request events notify the group",
    settingsCalSync: "📅 Calendar Sync", settingsCopyCalUrl: "📋 Copy Calendar URL",
    settingsAdminPin: "Admin PIN", settingsCurrPin: "Current admin PIN",
    settingsNewPin: "New PIN (4–6 digits)", settingsConfirmPin: "Confirm PIN",
    settingsChangePin: "Change Admin PIN", settingsPinUpdated: "Admin PIN updated.",
    settingsPinMismatch: "PINs do not match.", settingsPinInvalid: "PIN must be 4–6 digits.",
    settingsBackup: "💾 Data Backup",
    settingsBackupDesc: "Saves a full snapshot of all data (crew, equipment, jobs, invoices) to a separate cloud slot that auto-save never touches.",
    settingsLastBackup: "Last backup", settingsBackupSaved: "✓ Backup saved to cloud.",
    settingsBackupError: "Backup failed — check connection and try again.",
    settingsBackupRestored: "✓ Data restored from backup.", settingsBackupNoBackup: "No backup found. Create one first.",
    settingsCreateBackup: "Create Backup", settingsSavingBackup: "Saving…",
    settingsDownloadJson: "Download JSON",
    settingsRestoreConfirmMsg: "This will overwrite ALL current data with the backup. Are you sure?",
    settingsYesRestore: "Yes, Restore", settingsRestoring: "Restoring…",
    settingsRestoreFromBackup: "Restore from Backup",
    settingsLineGroupConnected: "All job notifications go to the group. Free tier: 200 messages/month.",
    settingsLineGroupNotConnected: "Without a group, notifications go to individual team members via their Line User ID above.",
    settingsCalDescTitle: "Subscribe on iPhone:", settingsCopyUrl: "Copy",
    settingsSystemInfo: "System Info",
    settingsSysDesc1: "All data is stored in Cloudflare KV — synced across all devices automatically.",
    settingsSysDesc2: "Geo-locked photos use the browser's camera API — location metadata is embedded in the image stamp.",
    settingsPinReEnter: "Re-enter PIN",
    settingsSaveAll: "💾 Save All Settings", settingsSaving: "Saving…",
    settingsSaved: "✓ All settings saved to cloud", settingsSaveFailed: "Save Failed — tap to retry",
    settingsSavedAt: "Saved",
    settingsSaveHint: "Changes also auto-save in the background — this button forces an immediate save and confirms it went through.",
    // Login
    loginSystem: "Equipment Checkout System", loginAdmin: "Admin Login", loginEmployee: "Employee Login",
    loginRegisterLink: "Request to register as teammate", loginRegisterTitle: "Request to Join",
    loginRegisterDesc: "Your request will be sent to the admin for approval.",
    loginYourName: "Your Name", loginFullName: "Full name",
    loginDesiredPin: "Desired PIN (4–6 digits)", loginSendRequest: "Send Request",
    loginPinPrompt: "Enter PIN", loginIncorrectPin: "Incorrect PIN.",
    loginAccount: "Account", loginSelectAccount: "Select account…",
    loginTooManyAttempts: "Too many attempts — try again in ",
    loginSeconds: "s", loginLocked: "Locked", loginUnlock: "Unlock",
    loginEnterName: "Please enter your name.", loginPinDigits: "PIN must be 4–6 digits.",
    loginPinMatch: "PINs do not match.", loginPendingExists: "A request with this name is already pending.",
    loginRequestSent: "Request sent! Ask your admin to approve it.",
    // Notifications (admin topbar)
    notifTitle: "Notifications", notifAllCaughtUp: "✓ All caught up",
    notifItemsAttention: "items need attention",
    notifAdminApprovals: "Admin Approvals", notifEquipRequests: "Equipment Requests", notifDamageReports: "Damage Reports",
    // Admin checkout
    adminCheckoutTitle: "Gear Checkout", adminCheckoutDesc: "Pick or return equipment for any confirmed job",
    adminNoConfirmedJobs: "No confirmed jobs with assigned equipment.",
    adminPickLabel: "Pick up", adminReturnLabel: "Return",
    adminNoItemsOut: "No items currently checked out.", adminAllPicked: "All items picked up.",
    adminAllReturned: "All items returned.",
  },
  th: {
    // Nav
    navDashboard: "ภาพรวม", navEquipment: "อุปกรณ์", navJobs: "งาน",
    navTeam: "ทีม", navReports: "แจ้งปัญหา", navInvoice: "ใบแจ้งหนี้", navCheckout: "รับ-คืน",
    tabInvoice: "ใบแจ้งหนี้",
    personalInfo: "ข้อมูลส่วนตัว", documents: "เอกสาร", legalAddress: "ที่อยู่ตามทะเบียนบ้าน",
    phone: "โทรศัพท์", email: "อีเมล", lineId: "ไลน์ไอดี", idCard: "บัตรประชาชน", promptPayQR: "พร้อมเพย์ / QR ธนาคาร",
    myInvoices: "ใบแจ้งหนี้ของฉัน", createInvoice: "สร้างใบแจ้งหนี้", noInvoicesYet: "ยังไม่มีใบแจ้งหนี้",
    confirmJobs: "งานที่ยืนยันแล้ว", selectJob: "เลือกงานที่ต้องการออกใบแจ้งหนี้",
    // Employee tabs
    tabToday: "วันนี้", tabSchedule: "ตาราง", tabProfile: "โปรไฟล์", tabReport: "แจ้งปัญหา",
    // Today tab
    crew: "ทีมงาน",
    todaysJobs: "งานวันนี้",
    noJobsToday: "ไม่มีงานยืนยันที่มีอุปกรณ์พร้อมในวันนี้",
    allReturned: "✓ คืนครบแล้ว",
    onShoot: "🎬 กำลังถ่าย — แตะเพื่อคืน",
    gearOutTitle: "อุปกรณ์ที่ยังไม่คืน — แตะเพื่อคืน",
    outBadge: "ชิ้น",
    readyPick: "พร้อมรับอุปกรณ์",
    itemsAssigned: "รายการ",
    // Schedule tab
    jobSchedule: "ตารางงาน",
    tapJobBar: "แตะแถบงานเพื่อดูรายละเอียด",
    // Profile tab
    myProfile: "โปรไฟล์ของฉัน",
    crewCard: "บัตรทีมงาน",
    cameraCrew: "ทีมกล้อง",
    uploadPhoto: "อัปโหลดรูป", replacePhoto: "แทนที่", uploadSignature: "อัปโหลดลายเซ็น",
    takeSelfie: "ถ่ายเซลฟี่",
    removePhoto: "ลบรูป",
    recentActivity: "กิจกรรมล่าสุด",
    noActivity: "ยังไม่มีกิจกรรม",
    pickEvt: "รับ", returnEvt: "คืน",
    // Checkout flow
    pickPhase: "รับอุปกรณ์", returnPhase: "คืนอุปกรณ์",
    tickWhenReady: "— ติ๊กรายการเมื่อพร้อม",
    alreadyProcessed: "ดำเนินการแล้ว",
    tickAllWarning: "⚠ ติ๊กรายการทั้งหมดก่อนดำเนินการต่อ",
    proceedPhoto: "ไปถ่ายรูปยืนยัน →",
    pickUpPhoto: "รูปรับอุปกรณ์", returnPhoto: "รูปคืนอุปกรณ์",
    photoInstruction: "ถ่ายรูปอุปกรณ์ทั้งหมด — จะประทับ GPS เป็นหลักฐาน",
    photoLiveWarning: "ต้องถ่ายสดเท่านั้น ไม่อนุญาตให้เลือกจากคลัง",
    capturePickPhoto: "ถ่ายรูปรับอุปกรณ์",
    captureReturnPhoto: "ถ่ายรูปคืนอุปกรณ์",
    confirmPickUp: "ยืนยันการรับ", confirmReturn: "ยืนยันการคืน",
    backToJobs: "← กลับสู่รายการงาน",
    gearPickedUp: "รับอุปกรณ์เรียบร้อย!", gearReturned: "คืนอุปกรณ์เรียบร้อย!",
    savedGPS: "บันทึกพร้อมวันเวลาและ GPS", savedNoGPS: "บันทึกพร้อมวันเวลา",
    // Reports
    reportTitle: "รายงานอุปกรณ์เสียหาย", reportNew: "แจ้งปัญหาใหม่", reportNone: "ยังไม่มีรายงาน",
    reportDescription: "รายละเอียด *", reportDate: "วันและเวลาที่เกิดเหตุ",
    reportEquipment: "อุปกรณ์ที่เกี่ยวข้อง", reportNoEquipment: "— ไม่มีอุปกรณ์ที่เกี่ยวข้อง —",
    reportOther: "อื่นๆ / ระบุด้านล่าง", reportOtherName: "ชื่ออุปกรณ์",
    reportPhotos: "รูปภาพ", reportCamera: "ถ่ายรูป", reportGallery: "คลังรูป",
    reportSubmit: "ส่งรายงาน", reportSubmitted: "ส่งรายงานเรียบร้อย!",
    reportStatusOpen: "รอดำเนินการ", reportStatusSolved: "แก้ไขแล้ว", reportStatusDiscarded: "ยกเลิก",
    reportSolve: "แก้ไขแล้ว", reportDiscard: "ยกเลิก", reportUnresolved: "รายการรอแก้ไข",
    reportBy: "แจ้งโดย", reportAll: "ทั้งหมด",
    myReports: "รายงานของฉัน",
    // Gear requests (employee)
    gearRequests: "คำขอยืมอุปกรณ์", noGearRequests: "ยังไม่มีคำขอ", requestBtn: "ขอยืม",
    reqWork: "งาน: ", reqPractice: "ฝึกซ้อม",
    reqGearModalTitle: "ขอยืมอุปกรณ์", datesNeeded: "วันที่ต้องการ", tapDatesHint: "แตะวันที่เพื่อเลือก",
    selectEquipment: "เลือกอุปกรณ์", purposeLabel: "วัตถุประสงค์",
    purposePractice: "ฝึกซ้อม / ใช้ส่วนตัว", purposeWork: "งาน (กองถ่าย)",
    productionHouse: "บริษัทผลิต", reasonLabel: "เหตุผล", reasonPlaceholder: "ทำไมต้องการอุปกรณ์นี้?",
    submitRequest: "ส่งคำขอ",
    // Profile
    firstName: "ชื่อจริง", lastName: "นามสกุล", nickname: "ชื่อเล่น", shownInPortal: "(แสดงในระบบ)",
    bankDetails: "ข้อมูลธนาคาร", bankNameLabel: "ชื่อธนาคาร", accountNameLabel: "ชื่อบัญชี", accountNumberLabel: "เลขบัญชี",
    changePasscode: "เปลี่ยนรหัสผ่าน", newPinLabel: "รหัสใหม่ (4–6 หลัก)", confirmPinLabel: "ยืนยันรหัส", updatePasscode: "อัปเดตรหัส",
    signatureSection: "ลายเซ็น (บนกระดาษขาว)", signatureHint: "เซ็นบนกระดาษขาวแล้วถ่ายรูป ระบบจะลบพื้นหลังขาวอัตโนมัติ",
    calendarSync: "ซิงก์ปฏิทิน",
    kpiMyScore: "⭐ คะแนน KPI ของฉัน", kpiFullScore: "✓ คะแนนเต็ม — ไม่มีการหักคะแนนในช่วงนี้ เยี่ยมมาก!",
    kpiDeductions: "การหักคะแนน",
    kpiPts: "คะแนน",
    profileSaveBtn: "บันทึกโปรไฟล์", profileSaving: "กำลังบันทึก…", profileSaved: "✓ บันทึกโปรไฟล์แล้ว", profileSaveFail: "บันทึกล้มเหลว — แตะเพื่อลองใหม่",
    positionsTitle: "ตำแหน่งและค่าจ้าง",
    positionsDesc: "เพิ่มได้สูงสุด 5 ตำแหน่ง การเลือกตำแหน่งในใบแจ้งหนี้จะกรอกค่าจ้างอัตโนมัติ",
    positionsEmpty: "ยังไม่มีตำแหน่ง — เพิ่มเพื่อกรอกใบแจ้งหนี้อัตโนมัติ",
    addRoleBtn: "เพิ่มตำแหน่ง", roleLabel: "ตำแหน่ง",
    positionName: "ชื่อตำแหน่ง", dayRateLabel: "ค่าจ้างต่อวัน (฿)", hoursPerDayLabel: "ชั่วโมง/วัน",
    hourlyRate: "อัตราชั่วโมงละ", perHr: "/ชม.",
    otLabel: "โอที (หลัง {h} ชม.)", flatOT: "โอทีแบบคงที่", variableOT: "โอทีแบบขั้น",
    otMultiplierLabel: "ตัวคูณโอที (× อัตราชั่วโมง)",
    otTiersLabel: "ขั้นโอที (ช่วงชั่วโมง → ตัวคูณ)", addTierBtn: "เพิ่มขั้น",
    otTiersNote: "แต่ละขั้นครอบคลุมชั่วโมงจนถึงขีดจำกัด ชั่วโมงเกินขั้นสุดท้ายใช้ตัวคูณสุดท้าย",
    // Job form (admin)
    newJob: "งานใหม่", editJob: "แก้ไขงาน",
    jobNameField: "ชื่องาน", productionCoField: "บริษัทผลิต",
    jobStatusField: "สถานะ", shootTimeField: "ช่วงเวลาถ่าย", locationField: "ประเภทสถานที่",
    contactPersonField: "ผู้ติดต่อ", contactPlatformField: "ช่องทางติดต่อ",
    datesField: "วันถ่าย (แตะเพื่อเลือก)", viewNextMonth: "เดือนถัดไป →", saveJob: "บันทึก",
    // Common
    cancel: "ยกเลิก", save: "บันทึก", logout: "ออกจากระบบ", back: "กลับ", loading: "กำลังโหลด…",
    qty: "จำนวน",
    // Equipment page (admin)
    eqLibrary: "อุปกรณ์ทั้งหมด", eqAvailToday: "ว่างวันนี้", eqAdd: "เพิ่ม",
    eqAddModal: "เพิ่มอุปกรณ์", eqEditModal: "แก้ไขอุปกรณ์",
    eqItemName: "ชื่ออุปกรณ์", eqCategory: "หมวดหมู่", eqTotalUnits: "จำนวนทั้งหมดที่มี",
    eqOptNotes: "หมายเหตุ (ถ้ามี)", eqChangePhoto: "เปลี่ยนรูป", eqSaveEquipment: "บันทึกอุปกรณ์",
    eqNoHistory: "ยังไม่มีประวัติการยืม", eqSelectCat: "— เลือกหมวดหมู่ —",
    eqNewCat: "＋ เพิ่มหมวดหมู่ใหม่…", eqDeleteConfirm: "ลบอุปกรณ์นี้ใช่ไหม?", eqAll: "ทั้งหมด",
    eqUnavail: "ไม่ว่าง", eqHistoryTitle: "ประวัติ",
    // Jobs page (admin)
    jobBookings: "รายการงาน", jobNewJob: "เพิ่มงาน", jobNoJobs: "ยังไม่มีงาน",
    jobAssignGear: "มอบหมายอุปกรณ์", jobProductionDates: "วันถ่ายทำ", jobAssignedEq: "อุปกรณ์ที่มอบหมาย",
    jobReturnMode: "โหมดการคืน",
    jobSpanLabel: "รับวันแรก · คืนวันสุดท้าย", jobSpanDesc: "อุปกรณ์ออกตลอดช่วงงาน",
    jobDailyLabel: "รับ-คืนทุกวัน", jobDailyDesc: "ทีมงานคืนอุปกรณ์ทุกสิ้นวันถ่าย",
    jobTapAssign: "แตะการ์ดเพื่อมอบหมายหรือยกเลิก ใช้ +/− สำหรับอุปกรณ์หลายชิ้น",
    jobAssigned: "มอบหมายแล้ว", jobSaveAssign: "บันทึกการมอบหมาย", jobDeleteConfirm: "ลบงานนี้ใช่ไหม?",
    jobRoles: "บทบาทการยืนยัน", jobRolesBarcode: "ผู้สแกนบาร์โค้ด", jobRolesPhoto: "ผู้ถ่ายรูป",
    jobRolesAnyone: "ใครก็ได้", jobRolesFixed: "สมาชิกที่กำหนด",
    jobDailyReturn: "คืนทุกวัน", jobAvailable: "ว่าง", jobUnavailable: "ไม่ว่าง",
    // Dashboard (admin)
    dashOverview: "ภาพรวม", dashTodayJobsLabel: "งานวันนี้",
    dashConfirmedLabel: "งานยืนยัน", dashPencilLabel: "งานดินสอ",
    statusConfirmed: "ยืนยัน", statusPencil: "ดินสอ", statusCancelled: "ยกเลิก",
    dashNoJobsCategory: "ไม่มีงานในหมวดนี้",
    dashEqOutToday: "อุปกรณ์ออกวันนี้", dashAllAvail: "✓ อุปกรณ์ทุกชิ้นว่างอยู่",
    dashStillOut: "ยังไม่ได้คืน", dashStillOutOverdue: "เกินกำหนด", dashStillOutActive: "ออกอยู่",
    dashStillOutEmpty: "✓ อุปกรณ์ทุกชิ้นถูกคืนแล้ว",
    dashRecentActivity: "กิจกรรมล่าสุด", dashNoActivity: "ยังไม่มีกิจกรรม",
    dashPicked: "รับแล้ว", dashReturned: "คืนแล้ว",
    dashGearRequests: "คำขอยืมอุปกรณ์", dashNoRequests: "ยังไม่มีคำขอ",
    dashApprovals: "รออนุมัติ", dashEdit: "แก้ไข",
    dashItems: "รายการ", dashItem: "รายการ",
    dashApproveAll: "อนุมัติทั้งหมด", dashApprove: "อนุมัติ", dashDeny: "ปฏิเสธ", dashReject: "ปฏิเสธ",
    dashClose: "ปิด", dashPending: "รอดำเนินการ", dashResolved: "ดำเนินการแล้ว",
    dashPendingFilter: "รอดำเนินการ", dashResolvedFilter: "ดำเนินการแล้ว", dashAllFilter: "ทั้งหมด",
    dashNoPending: "ไม่มีคำขอรอดำเนินการ",
    dashNoResolved: "ยังไม่มีคำขอที่ดำเนินการแล้ว", dashNoAll: "ยังไม่มีคำขออนุมัติ",
    dashGearReqDetail: "รายละเอียดคำขอยืมอุปกรณ์", dashRequestedItems: "อุปกรณ์ที่ขอ",
    dashDateNeeded: "วันที่ต้องการ", dashDatesNeeded: "วันที่ต้องการ",
    dashPurpose: "วัตถุประสงค์", dashReason: "เหตุผล", dashCheckoutStatus: "สถานะการยืม",
    dashByLabel: "โดย", dashGuest: "ผู้เยี่ยมชม", dashReturn: "คืน",
    dashGpsFrom: "ม. จากจุดรับ", dashGpsUnavail: "ไม่มีข้อมูล GPS ณ จุดคืน",
    dashTypeProductionHouse: "บริษัทผลิต", dashTypeEquipment: "อุปกรณ์", dashTypeNewMember: "สมาชิกใหม่",
    dashRequested: "ขอเมื่อ",
    // Team (admin)
    teamTitle: "ทีมงาน", teamManageCrew: "จัดการสิทธิ์ทีมงาน", teamAddMember: "เพิ่มสมาชิก",
    teamMembers: "สมาชิกทีม", teamNoMembers: "ยังไม่มีสมาชิก",
    teamEqRequests: "คำขอยืมอุปกรณ์", teamNoEqRequests: "ยังไม่มีคำขอยืมอุปกรณ์",
    teamPinShow: "แสดง", teamPinHide: "ซ่อน", teamRemoveConfirm: "ลบสมาชิกคนนี้ใช่ไหม?",
    teamAddTitle: "เพิ่มสมาชิก", teamEditTitle: "แก้ไขสมาชิก",
    teamNameLabel: "ชื่อ", teamPinLabel: "PIN (4–6 หลัก)",
    teamAddMemberBtn: "เพิ่มสมาชิก", teamSaveChanges: "บันทึกการเปลี่ยนแปลง",
    teamNameRequired: "กรุณากรอกชื่อ", teamPinRequired: "กรุณากรอก PIN", teamPinInvalid: "PIN ต้องมี 4–6 หลัก",
    teamKpiScore: "⭐ คะแนน KPI", teamKpiPeriod: "ช่วงเวลา",
    teamKpiCustomDeduction: "กำหนดเอง…", teamKpiPoints: "คะแนน",
    teamKpiReason: "เหตุผล (แสดงให้ทีมงานเห็น)", teamKpiDeduct: "หักคะแนน",
    teamKpiDeductionsThisPeriod: "การหักในช่วงนี้", teamKpiUndo: "ยกเลิก",
    teamKpiErrPoints: "กรุณากรอกคะแนนที่จะหัก", teamKpiErrReason: "ต้องระบุเหตุผล",
    teamKpiDeductedMsg: "หัก {pts} คะแนนแล้ว", teamKpiPeriodLabel: "ช่วงเวลา:",
    teamNoProfileDocs: "ยังไม่มีเอกสารโปรไฟล์",
    teamPractice: "ฝึกซ้อม", teamWork: "งาน",
    teamPendingReqs: "รอดำเนินการ", teamApprove: "อนุมัติ", teamDeny: "ปฏิเสธ",
    // Settings
    settingsTitle: "การตั้งค่า", settingsLanguage: "ภาษา",
    settingsNavOrder: "ลำดับเมนูด้านล่าง", settingsNavOrderDesc: "กำหนดลำดับแท็บด้านล่าง", settingsNavOrderReset: "รีเซ็ตค่าเริ่มต้น",
    settingsTheme: "🎨 ธีม", settingsThemeStyle: "สไตล์", settingsThemeColor: "สี",
    settingsUsesDefault: "ใช้ค่าเริ่มต้น",
    settingsCompany: "บริษัท", settingsCompanyHint: "แสดงในแถบบนและหน้าเข้าสู่ระบบ",
    settingsDateTime: "วันและเวลา", settingsTimezone: "เขตเวลา",
    settingsTimezoneHint: "ใช้สำหรับคำนวณ \"วันนี้\" และปฏิทินงาน",
    settingsTimeFormat: "รูปแบบเวลา", settingsTimeFormatHint: "ใช้กับเวลาในใบแจ้งหนี้",
    settingsCheckout: "การยืนยันการรับ-คืน",
    settingsVerifNone: "ไม่มี", settingsVerifNoneDesc: "แตะเพื่อยืนยัน ไม่ต้องถ่ายรูป ไม่ต้องสแกน ไม่ต้อง GPS",
    settingsVerifPhoto: "รูปภาพ + GPS", settingsVerifPhotoDesc: "ทีมถ่ายรูปอุปกรณ์แต่ละชิ้น ตรวจ GPS ณ จุดคืน (±50 ม.)",
    settingsVerifBarcode: "บาร์โค้ด + GPS", settingsVerifBarcodeDesc: "ทีมสแกน QR บนอุปกรณ์ บันทึก GPS ณ เวลาสแกน",
    settingsVerifBoth: "ทั้งคู่ (รูปภาพ & บาร์โค้ด)", settingsVerifBothDesc: "ต้องใช้ทั้งสแกน QR และถ่ายรูป กำหนดบทบาทต่อแต่ละงาน",
    settingsClearHistory: "ล้างประวัติรับ/คืนอุปกรณ์", settingsClearHistoryDesc: "ลบบันทึกการรับและคืนทั้งหมด อุปกรณ์จะไม่ถูกลบ — ล้างเฉพาะประวัติการทำรายการ",
    settingsClearHistoryCount: "{n} รายการ", settingsClearHistoryConfirm: "การดำเนินการนี้จะลบประวัติรับ/คืนทั้งหมดถาวร อุปกรณ์ยังคงอยู่ครบ แน่ใจหรือไม่?",
    settingsClearHistoryYes: "ใช่ ล้างประวัติ", settingsClearHistoryDone: "✓ ล้างประวัติแล้ว",
    settingsPhotoOn: "เปิดการยืนยันด้วยรูปภาพ", settingsPhotoOff: "ปิดการยืนยันด้วยรูปภาพ",
    settingsPhotoOnDesc: "ทีมงานต้องถ่ายรูปอุปกรณ์ทุกชิ้น ระบบตรวจ GPS ณ จุดคืน (ภายใน 50 ม. ผ่านทันที หรือรออนุมัติจากผู้ดูแล)",
    settingsPhotoOffDesc: "ทีมงานแตะรายการเพื่อรับ/คืนได้เลย ไม่ต้องถ่ายรูปหรือตรวจ GPS",
    settingsKpiTitle: "⭐ คะแนน KPI", settingsKpiPeriodStart: "เริ่มต้นช่วง",
    settingsKpiReset: "รีเซ็ตทุก (เดือน)", settingsKpiMaxPoints: "คะแนนเริ่มต้น",
    settingsKpiEveryoneStarts: "ทีมงานทุกคนเริ่มต้นแต่ละช่วงที่", settingsKpiCurrPeriod: "ช่วงปัจจุบัน:",
    settingsKpiDefaultStart: "ค่าเริ่มต้นคือวันที่ 1 มกราคม",
    settingsKpiPunishments: "การหักคะแนน", settingsKpiNoPunishments: "ยังไม่มีการหักคะแนน",
    settingsKpiAddPunishment: "เพิ่ม",
    settingsKpiPunDesc: "เหตุผลสำเร็จรูปสำหรับหักคะแนน ชื่อจะแสดงให้ทีมงานเห็น",
    settingsLineTitle: "LINE OA การแจ้งเตือน",
    settingsLineConnected: "เชื่อมต่อกลุ่มแชทแล้ว", settingsLineNotConnected: "ยังไม่ได้เชื่อมต่อกลุ่มแชท",
    settingsLineRefresh: "↻ รีเฟรช", settingsLineDisconnect: "ตัดการเชื่อมต่อ",
    settingsLineMuted: "🔕 ปิดการแจ้งเตือน", settingsLineActive: "🔔 เปิดการแจ้งเตือน",
    settingsLineMutedDesc: "ไม่ส่งข้อความไปที่ LINE — โหมดทดสอบ",
    settingsLineActiveDesc: "ส่งแจ้งเตือนงาน/รายงาน/คำขอไปที่กลุ่ม",
    settingsCalSync: "📅 ซิงก์ปฏิทิน", settingsCopyCalUrl: "📋 คัดลอก URL ปฏิทิน",
    settingsAdminPin: "PIN ผู้ดูแล", settingsCurrPin: "PIN ผู้ดูแลปัจจุบัน",
    settingsNewPin: "PIN ใหม่ (4–6 หลัก)", settingsConfirmPin: "ยืนยัน PIN",
    settingsChangePin: "เปลี่ยน PIN ผู้ดูแล", settingsPinUpdated: "อัปเดต PIN ผู้ดูแลแล้ว",
    settingsPinMismatch: "PIN ไม่ตรงกัน", settingsPinInvalid: "PIN ต้องมี 4–6 หลัก",
    settingsBackup: "💾 สำรองข้อมูล",
    settingsBackupDesc: "บันทึกสแนปช็อตข้อมูลทั้งหมด (ทีมงาน อุปกรณ์ งาน ใบแจ้งหนี้) ไปยังพื้นที่แยกที่การบันทึกอัตโนมัติไม่แตะต้อง",
    settingsLastBackup: "สำรองล่าสุด", settingsBackupSaved: "✓ บันทึกสำรองบนคลาวด์แล้ว",
    settingsBackupError: "บันทึกสำรองล้มเหลว — ตรวจสอบการเชื่อมต่อและลองใหม่",
    settingsBackupRestored: "✓ กู้คืนข้อมูลจากสำรองแล้ว", settingsBackupNoBackup: "ไม่พบข้อมูลสำรอง กรุณาสร้างก่อน",
    settingsCreateBackup: "สร้างข้อมูลสำรอง", settingsSavingBackup: "กำลังบันทึก…",
    settingsDownloadJson: "ดาวน์โหลด JSON",
    settingsRestoreConfirmMsg: "การดำเนินการนี้จะเขียนทับข้อมูลปัจจุบันทั้งหมดด้วยข้อมูลสำรอง แน่ใจหรือไม่?",
    settingsYesRestore: "ใช่ กู้คืนเลย", settingsRestoring: "กำลังกู้คืน…",
    settingsRestoreFromBackup: "กู้คืนจากสำรอง",
    settingsLineGroupConnected: "การแจ้งเตือนงานทั้งหมดส่งไปที่กลุ่ม ฟรีสูงสุด 200 ข้อความ/เดือน",
    settingsLineGroupNotConnected: "หากไม่มีกลุ่ม การแจ้งเตือนจะส่งถึงสมาชิกแต่ละคนผ่าน Line User ID",
    settingsCalDescTitle: "สมัครสมาชิกบน iPhone:", settingsCopyUrl: "คัดลอก",
    settingsSystemInfo: "ข้อมูลระบบ",
    settingsSysDesc1: "ข้อมูลทั้งหมดเก็บใน Cloudflare KV — ซิงก์อัตโนมัติทุกอุปกรณ์",
    settingsSysDesc2: "รูปถ่ายพร้อม GPS ใช้ Camera API ของเบราว์เซอร์ — ข้อมูลตำแหน่งฝังอยู่ในภาพ",
    settingsPinReEnter: "ป้อน PIN อีกครั้ง",
    settingsSaveAll: "💾 บันทึกการตั้งค่าทั้งหมด", settingsSaving: "กำลังบันทึก…",
    settingsSaved: "✓ บันทึกการตั้งค่าทั้งหมดบนคลาวด์แล้ว", settingsSaveFailed: "บันทึกล้มเหลว — แตะเพื่อลองใหม่",
    settingsSavedAt: "บันทึกเมื่อ",
    settingsSaveHint: "การเปลี่ยนแปลงจะบันทึกอัตโนมัติ ปุ่มนี้บังคับบันทึกทันทีและยืนยันว่าสำเร็จ",
    // Login
    loginSystem: "ระบบยืม-คืนอุปกรณ์", loginAdmin: "เข้าสู่ระบบผู้ดูแล", loginEmployee: "เข้าสู่ระบบทีมงาน",
    loginRegisterLink: "ขอลงทะเบียนเป็นทีมงาน", loginRegisterTitle: "ขอเข้าร่วม",
    loginRegisterDesc: "คำขอจะส่งให้ผู้ดูแลพิจารณาอนุมัติ",
    loginYourName: "ชื่อของคุณ", loginFullName: "ชื่อ-นามสกุล",
    loginDesiredPin: "PIN ที่ต้องการ (4–6 หลัก)", loginSendRequest: "ส่งคำขอ",
    loginPinPrompt: "ป้อน PIN", loginIncorrectPin: "PIN ไม่ถูกต้อง",
    loginAccount: "บัญชีผู้ใช้", loginSelectAccount: "เลือกบัญชี…",
    loginTooManyAttempts: "ผิดหลายครั้ง — ลองใหม่ใน ",
    loginSeconds: " วินาที", loginLocked: "ล็อค", loginUnlock: "ปลดล็อค",
    loginEnterName: "กรุณากรอกชื่อ", loginPinDigits: "PIN ต้องมี 4–6 หลัก",
    loginPinMatch: "PIN ไม่ตรงกัน", loginPendingExists: "มีคำขอชื่อนี้อยู่แล้ว",
    loginRequestSent: "ส่งคำขอแล้ว! รอผู้ดูแลอนุมัติ",
    // Notifications (admin topbar)
    notifTitle: "การแจ้งเตือน", notifAllCaughtUp: "✓ ไม่มีการแจ้งเตือน",
    notifItemsAttention: "รายการรอดำเนินการ",
    notifAdminApprovals: "รออนุมัติ", notifEquipRequests: "คำขออุปกรณ์", notifDamageReports: "แจ้งความเสียหาย",
    // Admin checkout
    adminCheckoutTitle: "ยืม-คืนอุปกรณ์", adminCheckoutDesc: "รับหรือคืนอุปกรณ์สำหรับงานที่ยืนยันแล้ว",
    adminNoConfirmedJobs: "ไม่มีงานยืนยันที่มีอุปกรณ์",
    adminPickLabel: "รับอุปกรณ์", adminReturnLabel: "คืนอุปกรณ์",
    adminNoItemsOut: "ไม่มีอุปกรณ์ที่ยืมออกอยู่", adminAllPicked: "รับอุปกรณ์ครบแล้ว",
    adminAllReturned: "คืนอุปกรณ์ครบแล้ว",
  },
};

const LangCtx = createContext("en");
const useT = () => {
  const lang = useContext(LangCtx);
  return (key) => LANG[lang]?.[key] ?? LANG.en[key] ?? key;
};

function LangPill({ setLang }) {
  const lang = useContext(LangCtx);
  return (
    <div style={{ display: "flex", background: "#252830", borderRadius: 6, overflow: "hidden", border: "1px solid #2e3340", flexShrink: 0 }}>
      {["en", "th"].map(l => (
        <button key={l} onClick={() => setLang(l)} style={{ background: lang === l ? "#e8b84b" : "transparent", color: lang === l ? "#0f1117" : "#555", border: "none", padding: "4px 10px", fontSize: 10, fontWeight: 800, cursor: "pointer", letterSpacing: "0.05em" }}>
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

// ─── AVAILABILITY CALCULATOR ─────────────────────────────────────────────────
function calcAvailable(equipment, jobs, checkouts, targetDate) {
  const date = targetDate || today();
  // Find confirmed jobs active on this date
  const activeJobIds = jobs.filter(j => j.status === "Confirmed" && j.dates.includes(date)).map(j => j.id);
  // Sum equipment assigned (and checked out) to those jobs
  let takenMap = {};
  activeJobIds.forEach(jid => {
    const job = jobs.find(j => j.id === jid);
    if (!job?.assignedEquipment) return;
    job.assignedEquipment.forEach(ae => {
      takenMap[ae.eqId] = (takenMap[ae.eqId] || 0) + ae.qty;
    });
  });
  return equipment.map(eq => {
    const taken = takenMap[eq.id] || 0;
    return { ...eq, available: Math.max(0, eq.total - taken), taken };
  });
}

// ─── EQUIPMENT PAGE ───────────────────────────────────────────────────────────
function printQRForItems(items, autoprint = true) {
  const rows = items.map(eq => `
    <div class="label">
      <div class="qr" id="qr_${eq.id}"></div>
      <div class="info">
        <div class="name">${eq.name.replace(/</g,"&lt;")}</div>
        <div class="cat">${(eq.category||"").replace(/</g,"&lt;")}${eq.total > 1 ? ` · ×${eq.total}` : ""}</div>
        <div class="code">psr_eq:${eq.id}</div>
      </div>
    </div>`).join("");
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>QR Labels</title>
<style>
  body{margin:0;padding:10mm;font-family:sans-serif;background:#fff;color:#000}
  .grid{display:flex;flex-wrap:wrap;gap:6mm}
  .label{width:55mm;border:1px solid #ccc;border-radius:3mm;padding:4mm;display:flex;align-items:center;gap:3mm;page-break-inside:avoid}
  .qr{width:24mm;height:24mm;flex-shrink:0}
  .qr canvas,.qr img{width:100%;height:100%}
  .info{flex:1;min-width:0;overflow:hidden}
  .name{font-weight:700;font-size:10pt;line-height:1.2;word-break:break-word}
  .cat{font-size:8pt;color:#555;margin-top:2px}
  .code{font-size:6pt;color:#aaa;margin-top:3px;word-break:break-all}
  @media print{body{padding:5mm}@page{size:A4;margin:10mm}}
</style></head><body>
<h2 style="margin:0 0 6mm;font-size:13pt">QR Labels (${items.length} item${items.length!==1?"s":""})</h2>
<div class="grid">${rows}</div>
<script src="https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js"><\/script>
<script>
  document.querySelectorAll(".label").forEach(function(el){
    var id=el.querySelector(".qr").id.replace("qr_","");
    new QRCode(el.querySelector(".qr"),{text:"psr_eq:"+id,width:90,height:90,correctLevel:QRCode.CorrectLevel.M});
  });
  ${autoprint ? "setTimeout(function(){window.print();},800);" : ""}
<\/script></body></html>`;
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

const EQ_SORT_OPTIONS = [
  { key: "name_az", label: "Name A→Z" },
  { key: "name_za", label: "Name Z→A" },
  { key: "cat",     label: "Category" },
  { key: "qty_lo",  label: "Qty ↑" },
  { key: "qty_hi",  label: "Qty ↓" },
  { key: "latest",  label: "Latest Used" },
  { key: "most",    label: "Most Used" },
];

function EquipmentPage({ equipment, setEquipment, jobs, checkouts, reports, setReports }) {
  const t = useT();
  const [eqTab, setEqTab] = useState("equipment"); // equipment | reports
  const [modal, setModal] = useState(null);
  const [editTarget, setEditTarget] = useState(null);
  const [form, setForm] = useState({ name: "", category: "", total: 1, notes: "", photo: null });
  const [newCatInput, setNewCatInput] = useState("");
  const [histTarget, setHistTarget] = useState(null);
  const [sortBy, setSortBy] = useState("name_az");
  const [filterCat, setFilterCat] = useState(null);
  const [qrTarget, setQrTarget] = useState(null); // equipment item to show single QR
  const [selectedIds, setSelectedIds] = useState(new Set()); // for multi-select print
  const [selectMode, setSelectMode] = useState(false);
  const fileRef = useRef(null);

  const availableList = calcAvailable(equipment, jobs, checkouts, today());
  const existingCategories = [...new Set(equipment.map(e => e.category).filter(Boolean))].sort();

  const openAdd = () => { setForm({ name: "", category: "", total: 1, notes: "", photo: null }); setNewCatInput(""); setModal("add"); };
  const openEdit = (eq) => { setEditTarget(eq); setForm({ ...eq }); setNewCatInput(""); setModal("edit"); };
  const openHistory = (eq) => { setHistTarget(eq); setModal("history"); };

  const handlePhoto = (e) => {
    const f = e.target.files[0]; if (!f) return;
    compressImage(f, { maxDim: 1200, quality: 0.72 }).then(d => d && setForm(p => ({ ...p, photo: d })));
  };

  const save = () => {
    if (!form.name.trim()) return;
    const cat = form.category === "__new__" ? newCatInput.trim() : form.category;
    if (!cat) return;
    const saved = { ...form, category: cat, total: +form.total };
    if (modal === "add") {
      setEquipment(p => [...p, { ...saved, id: "eq" + Date.now() }]);
    } else {
      setEquipment(p => p.map(e => e.id === editTarget.id ? { ...e, ...saved } : e));
    }
    setModal(null);
  };

  const del = (id) => { if (window.confirm(t("eqDeleteConfirm"))) setEquipment(p => p.filter(e => e.id !== id)); };

  const getHistory = (eqId) => checkouts.filter(c => c.eqId === eqId).sort((a, b) => b.ts - a.ts).slice(0, 20);

  // Generate a printable A4 sheet of QR code labels for all equipment.
  // Each QR encodes "psr_eq:{eqId}" — scanned by QRScanner in checkout flow.
  const printQRLabels = () => {
    const items = equipment.map(eq => ({ id: eq.id, name: eq.name, category: eq.category, total: eq.total }));
    const rows = [];
    items.forEach(eq => {
      // For multi-unit items, repeat the label `total` times (one sticker per physical unit isn't required;
      // one label per item type is enough — scan counts as confirming the assigned qty).
      rows.push(`
        <div class="label">
          <div class="qr" id="qr_${eq.id}"></div>
          <div class="info">
            <div class="name">${eq.name.replace(/</g,"&lt;")}</div>
            <div class="cat">${(eq.category||"").replace(/</g,"&lt;")}${eq.total > 1 ? ` · ×${eq.total}` : ""}</div>
            <div class="code">psr_eq:${eq.id}</div>
          </div>
        </div>`);
    });
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>QR Labels</title>
<style>
  body{margin:0;padding:10mm;font-family:sans-serif;background:#fff;color:#000}
  .grid{display:flex;flex-wrap:wrap;gap:6mm}
  .label{width:55mm;border:1px solid #ccc;border-radius:3mm;padding:4mm;display:flex;align-items:center;gap:3mm;page-break-inside:avoid}
  .qr{width:24mm;height:24mm;flex-shrink:0}
  .qr canvas,.qr img{width:100%;height:100%}
  .info{flex:1;min-width:0;overflow:hidden}
  .name{font-weight:700;font-size:10pt;line-height:1.2;word-break:break-word}
  .cat{font-size:8pt;color:#555;margin-top:2px}
  .code{font-size:6pt;color:#aaa;margin-top:3px;word-break:break-all}
  @media print{body{padding:5mm}@page{size:A4;margin:10mm}}
</style>
</head><body>
<h2 style="margin:0 0 6mm;font-size:13pt">Pick Shoot Return — QR Labels (${items.length} items)</h2>
<div class="grid">${rows.join("")}</div>
<script src="https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js"></script>
<script>
  document.querySelectorAll(".label").forEach(function(el){
    var id = el.querySelector(".qr").id.replace("qr_","");
    new QRCode(el.querySelector(".qr"),{text:"psr_eq:"+id,width:90,height:90,correctLevel:QRCode.CorrectLevel.M});
  });
  setTimeout(function(){window.print();},800);
<\/script>
</body></html>`;
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  const AvStatus = ({ av }) => {
    if (av.available === 0) return <span style={{ ...S.badge("red"), fontSize: 10 }}>{t("eqUnavail") || "Unavail."}</span>;
    if (av.available < av.total) return <span style={{ ...S.badge("amber"), fontSize: 10 }}>{av.available}/{av.total}</span>;
    return <span style={{ ...S.badge("green"), fontSize: 10 }}>{av.available}/{av.total}</span>;
  };

  // Sort + filter
  const filtered = filterCat ? availableList.filter(e => e.category === filterCat) : availableList;
  const sortedList = [...filtered].sort((a, b) => {
    switch (sortBy) {
      case "name_az": return a.name.localeCompare(b.name);
      case "name_za": return b.name.localeCompare(a.name);
      case "cat":     return (a.category || "").localeCompare(b.category || "") || a.name.localeCompare(b.name);
      case "qty_lo":  return a.total - b.total || a.name.localeCompare(b.name);
      case "qty_hi":  return b.total - a.total || a.name.localeCompare(b.name);
      case "latest": {
        const aTs = Math.max(0, ...checkouts.filter(c => c.eqId === a.id).map(c => c.ts), 0);
        const bTs = Math.max(0, ...checkouts.filter(c => c.eqId === b.id).map(c => c.ts), 0);
        return bTs - aTs;
      }
      case "most": {
        const aC = checkouts.filter(c => c.eqId === a.id).length;
        const bC = checkouts.filter(c => c.eqId === b.id).length;
        return bC - aC || a.name.localeCompare(b.name);
      }
      default: return 0;
    }
  });

  // Build category-grouped view when sortBy === "cat"
  const renderGrid = (items) => (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
      {items.map(eq => (
        <div key={eq.id} style={{ ...S.card, padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {/* Square photo */}
          <div style={{ position: "relative", width: "100%", aspectRatio: "1 / 1", overflow: "hidden", background: "#0f1117", flexShrink: 0 }}>
            {eq.photo
              ? <img src={eq.photo} alt={eq.name} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
              : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon d={icons.camera} size={36} color="#252830" />
                </div>
            }
            <div style={{ position: "absolute", top: 5, left: 5 }}><AvStatus av={eq} /></div>
          </div>
          {/* Info */}
          <div style={{ padding: "8px 10px 8px", flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={S.tag}>{eq.category}</span>
            <p style={{ margin: 0, fontWeight: 700, fontSize: 12, lineHeight: 1.3, color: "#e8e4dc" }}>{eq.name}</p>
            {eq.notes && <p style={{ margin: 0, fontSize: 10, color: "#555", lineHeight: 1.3 }}>{eq.notes}</p>}
            <div style={{ marginTop: 3 }}><AvailBar available={eq.available} total={eq.total} /></div>
            <div style={{ display: "flex", gap: 3, marginTop: 5, justifyContent: "flex-end" }}>
              {selectMode ? (
                <button style={{ ...S.btn(selectedIds.has(eq.id) ? "primary" : "ghost"), padding: "3px 8px", fontSize: 11 }}
                  onClick={() => setSelectedIds(s => { const n = new Set(s); n.has(eq.id) ? n.delete(eq.id) : n.add(eq.id); return n; })}>
                  {selectedIds.has(eq.id) ? "✓" : "QR"}
                </button>
              ) : (
                <button style={{ ...S.btn("ghost"), padding: "3px 6px" }} title="View & print QR" onClick={() => printQRForItems([eq], false)}><Icon d={icons.qr || icons.camera} size={11} /></button>
              )}
              <button style={{ ...S.btn("ghost"), padding: "3px 6px" }} onClick={() => openHistory(eq)}><Icon d={icons.history} size={11} /></button>
              <button style={{ ...S.btn("ghost"), padding: "3px 6px" }} onClick={() => openEdit(eq)}><Icon d={icons.edit} size={11} /></button>
              <button style={{ ...S.btn("danger"), padding: "3px 6px" }} onClick={() => del(eq.id)}><Icon d={icons.trash} size={11} /></button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button style={{ ...S.btn(eqTab === "equipment" ? "primary" : "ghost"), flex: 1 }} onClick={() => setEqTab("equipment")}>{t("eqLibrary")}</button>
        <button style={{ ...S.btn(eqTab === "reports" ? "primary" : "ghost"), flex: 1, position: "relative" }} onClick={() => setEqTab("reports")}>
          Reports
          {(reports || []).filter(r => r.status === "open").length > 0 && (
            <span style={{ ...S.badge("red"), position: "absolute", top: -4, right: -4, fontSize: 10, minWidth: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 9 }}>{(reports || []).filter(r => r.status === "open").length}</span>
          )}
        </button>
      </div>

      {eqTab === "reports" && <AdminReportsPage reports={reports} setReports={setReports} equipment={equipment} />}

      {eqTab === "equipment" && <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <h1 style={S.pageTitle}>{t("eqLibrary")}</h1>
          <p style={S.pageSubtitle}>{equipment.length} items · {availableList.filter(e => e.available > 0).length} {t("eqAvailToday")}</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={S.btn("ghost")} onClick={() => { setSelectMode(v => !v); setSelectedIds(new Set()); }} title="Select items to print QR">
            <Icon d={icons.qr || icons.camera} size={15} /> {selectMode ? "Cancel" : "Select QR"}
          </button>
          {selectMode && selectedIds.size > 0 && (
            <button style={S.btn("primary")} onClick={() => { printQRForItems(equipment.filter(e => selectedIds.has(e.id))); setSelectMode(false); setSelectedIds(new Set()); }}>
              Print {selectedIds.size} QR
            </button>
          )}
          {!selectMode && <button style={S.btn("ghost")} onClick={printQRLabels} title="Print all QR labels"><Icon d={icons.qr || icons.camera} size={15} /> All QR</button>}
          <button style={S.btn("primary")} onClick={openAdd}><Icon d={icons.plus} size={15} /> {t("eqAdd")}</button>
        </div>
      </div>


      {/* Category filter chips */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        <button onClick={() => setFilterCat(null)} style={{ ...S.badge(filterCat === null ? "amber" : "gray"), cursor: "pointer", border: "none", padding: "4px 10px" }}>{t("eqAll")}</button>
        {existingCategories.map(c => (
          <button key={c} onClick={() => setFilterCat(filterCat === c ? null : c)} style={{ ...S.badge(filterCat === c ? "amber" : "gray"), cursor: "pointer", border: "none", padding: "4px 10px" }}>{c}</button>
        ))}
      </div>

      {/* Sort bar */}
      <div style={{ display: "flex", gap: 5, overflowX: "auto", marginBottom: 14, paddingBottom: 2 }}>
        {EQ_SORT_OPTIONS.map(s => (
          <button key={s.key} onClick={() => setSortBy(s.key)} style={{ ...S.btn(sortBy === s.key ? "primary" : "ghost"), padding: "5px 10px", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0 }}>{s.label}</button>
        ))}
      </div>

      {/* Grid — grouped by category when cat sort is active */}
      {sortBy === "cat"
        ? existingCategories.filter(cat => !filterCat || cat === filterCat).map(cat => {
            const items = sortedList.filter(e => e.category === cat);
            if (!items.length) return null;
            return (
              <div key={cat} style={{ marginBottom: 20 }}>
                <p style={{ ...S.sectionTitle, marginBottom: 10 }}>{cat}</p>
                {renderGrid(items)}
              </div>
            );
          })
        : renderGrid(sortedList)
      }

      {/* Add/Edit Modal */}
      {(modal === "add" || modal === "edit") && (
        <Modal title={modal === "add" ? t("eqAddModal") : t("eqEditModal")} onClose={() => setModal(null)}>
          <div style={S.col}>
            <div><label style={S.label}>{t("eqItemName")}</label><input style={S.input} value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. ARRI Alexa Mini LF" /></div>
            <div>
              <label style={S.label}>{t("eqCategory")}</label>
              {form.category === "__new__" ? (
                <div style={{ display: "flex", gap: 8 }}>
                  <input style={{ ...S.input, flex: 1 }} value={newCatInput} onChange={e => setNewCatInput(e.target.value)} placeholder="New category name…" autoFocus />
                  <button style={{ ...S.btn("ghost"), padding: "8px 10px", flexShrink: 0 }} onClick={() => setForm(p => ({ ...p, category: "" }))}>✕</button>
                </div>
              ) : (
                <select style={S.select} value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}>
                  <option value="">{t("eqSelectCat")}</option>
                  {existingCategories.map(c => <option key={c} value={c}>{c}</option>)}
                  <option value="__new__">{t("eqNewCat")}</option>
                </select>
              )}
            </div>
            <div><label style={S.label}>{t("eqTotalUnits")}</label><input style={S.input} type="number" min={1} value={form.total} onChange={e => setForm(p => ({ ...p, total: e.target.value }))} /></div>
            <div><label style={S.label}>{t("eqOptNotes")}</label><input style={S.input} value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} placeholder={t("eqOptNotes")} /></div>
            <div>
              <label style={S.label}>{t("uploadPhoto")}</label>
              <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handlePhoto} />
              <button style={S.btn("ghost")} onClick={() => fileRef.current.click()}><Icon d={icons.photo} size={14} /> {form.photo ? t("eqChangePhoto") : t("uploadPhoto")}</button>
              {form.photo && <img src={form.photo} alt="preview" style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 6, marginTop: 8 }} />}
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
              <button style={S.btn("ghost")} onClick={() => setModal(null)}>{t("cancel")}</button>
              <button style={S.btn("primary")} onClick={save}>{t("eqSaveEquipment")}</button>
            </div>
          </div>
        </Modal>
      )}

      {/* History Modal */}
      {modal === "history" && histTarget && (
        <Modal title={`${t("eqHistoryTitle")} — ${histTarget.name}`} onClose={() => setModal(null)} wide>
          {getHistory(histTarget.id).length === 0 ? (
            <p style={{ color: "#666", fontSize: 13 }}>{t("eqNoHistory")}</p>
          ) : (
            <div style={S.col}>
              {getHistory(histTarget.id).map((c, i) => (
                <div key={i} style={{ ...S.card, background: "#0f1117", display: "flex", gap: 16, alignItems: "flex-start" }}>
                  <span style={{ ...S.badge(c.type === "pick" || c.type === "checkout" ? "amber" : "green"), flexShrink: 0 }}>{c.type === "pick" || c.type === "checkout" ? "PICK" : "RETURN"}</span>
                  <div style={{ flex: 1 }}>
                    <p style={{ margin: 0, fontWeight: 600, fontSize: 13 }}>{c.jobName}</p>
                    <p style={{ margin: "3px 0 0", fontSize: 12, color: "#666" }}>{formatDateTime(c.ts)} · {c.employeeName} · Qty: {c.qty}</p>
                    {c.photo && <img src={c.photo} alt="evidence" style={{ width: 120, borderRadius: 6, marginTop: 8 }} />}
                    {c.location && <p style={{ fontSize: 11, color: "#60a5fa", margin: "4px 0 0" }}>GPS: {c.location.lat}, {c.location.lng}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}
      </>}
    </div>
  );
}

// ─── JOBS PAGE ────────────────────────────────────────────────────────────────
// ─── INVOICE HELPERS ─────────────────────────────────────────────────────────
const POSITIONS = ["1st Steadicam Assistant", "2nd Steadicam Assistant", "Remote Head Tech"];

function fmtMoney(v) {
  const n = parseFloat((v || "").toString().replace(/,/g, "")) || 0;
  return n > 0 ? n.toLocaleString() : null;
}

function calcVatBreakdown(inv) {
  const rawItems = inv.items?.length ? inv.items : [
    { description: "Labor Fee", qty: 1, rate: inv.laborFee || 0, vat: true },
    { description: "Overtime", qty: 1, rate: inv.overtime || 0, vat: true },
    { description: "Travel Fee", qty: 1, rate: inv.travelFee || 0, vat: true },
    { description: "Per Diem", qty: 1, rate: inv.perDiem || 0, vat: true },
  ].filter(it => parseFloat(it.rate) > 0);
  let subtotal = 0, vatAmount = 0;
  rawItems.forEach(it => {
    const qty = parseFloat(it.qty) || 0;
    const rate = parseFloat((it.rate || "").toString().replace(/,/g, "")) || 0;
    const line = qty * rate;
    const hasVat = inv.vatEnabled && it.vat !== false;
    if (hasVat) {
      if (inv.vatType === "inclusive") {
        const exVat = line / 1.07;
        subtotal += exVat;
        vatAmount += line - exVat;
      } else {
        subtotal += line;
        vatAmount += line * 0.07;
      }
    } else {
      subtotal += line;
    }
  });
  return { subtotal, vatAmount, total: subtotal + vatAmount };
}

function calcTotal(inv) {
  if (inv.vatEnabled) return calcVatBreakdown(inv).total;
  if (inv.items?.length) {
    return inv.items.reduce((s, it) => s + (parseFloat(it.qty) || 0) * (parseFloat((it.rate || "").toString().replace(/,/g, "")) || 0), 0);
  }
  // legacy format
  return [inv.laborFee, inv.overtime, inv.travelFee, inv.perDiem]
    .map(v => parseFloat((v || "").toString().replace(/,/g, "")) || 0)
    .reduce((a, b) => a + b, 0);
}

function makeSignatureTransparent(base64src) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      // Scale down so huge phone photos don't bloat KV storage
      const maxDim = 1400;
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = id.data;

      // Collect all pixel luminances to find the actual paper brightness
      // (accounts for dim lighting, warm/cream paper, shadows)
      const lums = new Float32Array(d.length / 4);
      for (let i = 0, p = 0; i < d.length; i += 4, p++) {
        lums[p] = d[i] * 0.299 + d[i+1] * 0.587 + d[i+2] * 0.114;
      }
      const sorted = Float32Array.from(lums).sort();
      // 95th-percentile = the brightest area = paper white (not blown-out specular)
      const paperLum = sorted[Math.floor(sorted.length * 0.95)] || 230;
      // Ink cutoff: pixels brighter than 78% of paper → background
      const cutoff = paperLum * 0.78;

      for (let i = 0, p = 0; i < d.length; i += 4, p++) {
        const l = lums[p];
        if (l >= cutoff) {
          d[i+3] = 0;
        } else {
          // Keep original ink color, just set alpha by darkness
          const t = Math.pow((cutoff - l) / cutoff, 0.5);
          d[i+3] = Math.min(255, Math.round(t * 255));
        }
      }

      ctx.putImageData(id, 0, 0);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => resolve(base64src);
    img.src = base64src;
  });
}

function fmtInvoiceNo(inv) {
  const base = inv.invoiceNo || "";
  const rev = inv.revisions || 0;
  return rev > 0 ? base + "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[rev - 1] : base;
}

const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const LOGO_B64 = "data:image/png;base64,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AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFjG/weUIfsAh8CWaAAAAABJRU5ErkJggg==";

function buildInvoiceHTML({ invoice, employee, profileInfo, promptPayQR, idCard, signature, productionCompanies, companyName, autoPrint = false, headerLogo = null, headerLogoPos = null, watermarkLogo = null, watermarkLogoPos = null }) {
  const prodCo = productionCompanies.find(c => c.name === invoice.productionCompany);
  const total = calcTotal(invoice);
  const headerText = invoice.invoiceHeader != null ? invoice.invoiceHeader : (companyName || "GEAR DESK");
  const isAdminInvoice = employee?.id === "admin";

  const items = invoice.items?.length ? invoice.items : [
    { description: "Labor Fee", qty: 1, rate: invoice.laborFee || 0 },
    { description: "Overtime", qty: 1, rate: invoice.overtime || 0 },
    { description: "Travel Fee", qty: 1, rate: invoice.travelFee || 0 },
    { description: "Per Diem", qty: 1, rate: invoice.perDiem || 0 },
  ].filter(it => parseFloat(it.rate) > 0);

  const dateStr = (invoice.shootDates || [])
    .map(d => new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })).join(", ");
  const invDate = new Date(invoice.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const statusColor = invoice.status === "Paid" ? "#065f46" : "#92400e";
  const statusBg = invoice.status === "Paid" ? "#d1fae5" : "#fef3c7";

  const hasMixedVat = invoice.vatEnabled && items.some(it => it.vat === false) && items.some(it => it.vat !== false);
  const itemRows = items.map(it => {
    const qty = parseFloat(it.qty) || 0;
    const rate = parseFloat((it.rate || "").toString().replace(/,/g, "")) || 0;
    const lineTotal = qty * rate;
    const noVatMark = (invoice.vatEnabled && hasMixedVat && it.vat === false) ? `<sup style="color:#888">*</sup>` : "";
    return `<tr>
      <td>${esc(it.description)}${noVatMark}</td>
      <td class="num">${qty % 1 === 0 ? qty : qty.toFixed(2)}</td>
      <td class="num">฿${rate.toLocaleString()}</td>
      <td class="num"><strong>฿${lineTotal.toLocaleString()}</strong></td>
    </tr>`;
  }).join("");

  const html = `<!DOCTYPE html><html><head><title>${invoice.invoiceNo}</title><meta charset="utf-8"><meta name="format-detection" content="telephone=no,email=no,address=no,date=no"><style>
    @page{size:A4 portrait;margin:0}
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Helvetica Neue',Arial,sans-serif;color:#111;font-size:10.5px;background:#fff;padding:10mm}
    .hdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px}
    .divider{border-top:2px solid #111;margin-bottom:10px}
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:8px}
    .job-box{background:#f7f7f7;border-radius:5px;padding:7px 12px;margin-bottom:8px;border-left:3px solid #111}
    .lbl{font-size:8px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#888;margin-bottom:3px}
    table{width:100%;border-collapse:collapse;margin-bottom:8px}
    th{text-align:left;font-size:8px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#888;padding:4px 7px;border-bottom:1.5px solid #ccc;background:#fafafa}
    td{padding:5px 7px;border-bottom:1px solid #f0f0f0;font-size:10.5px}
    .num{text-align:right;width:76px}
    .total-row td{border-top:2px solid #111;border-bottom:none;font-weight:800;font-size:12px;padding-top:6px}
    .bottom-box{border:1.5px solid #ddd;border-radius:7px;padding:12px 16px;margin-top:10px;display:flex;gap:18px;align-items:center;justify-content:center}
    .id-wrap{width:160px;flex-shrink:0}
    .id-img{width:100%;height:auto;max-height:106px;border-radius:5px;display:block;border:1px solid #ddd}
    .sig-col{flex-shrink:0;display:flex;flex-direction:column;align-items:center}
    .sig-img{width:160px;height:auto;max-height:80px;opacity:.95}
    @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  </style></head><body style="position:relative">
  ${watermarkLogo && watermarkLogoPos ? `<img src="${watermarkLogo}" style="position:fixed;left:${watermarkLogoPos.x}mm;top:${watermarkLogoPos.y}mm;width:${watermarkLogoPos.width || 120}mm;opacity:${watermarkLogoPos.opacity ?? 0.08};pointer-events:none;z-index:0" />` : ""}
  ${headerLogo && headerLogoPos ? `<img src="${headerLogo}" style="position:fixed;left:${headerLogoPos.x}mm;top:${headerLogoPos.y}mm;width:${headerLogoPos.width || 40}mm;opacity:${headerLogoPos.opacity ?? 1};pointer-events:none;z-index:0" />` : ""}
  <div style="position:relative;z-index:1">
  <div class="hdr">
    <div>
      <div style="font-size:20px;font-weight:800;letter-spacing:.01em">${esc(headerText)}</div>
    </div>
    <div style="text-align:right">
      <div style="font-size:26px;font-weight:900;letter-spacing:.04em">${({ quotation: "QUOTATION", receipt: "RECEIPT" }[invoice.docType] || "INVOICE")}</div>
      <div style="font-size:11px;color:#555;margin-top:3px">#${fmtInvoiceNo(invoice)}</div>
      <div style="font-size:10px;color:#888;margin-top:2px">${invDate}</div>
      ${invoice.status === "Paid" ? `<div style="margin-top:6px;display:inline-block;padding:2px 10px;border-radius:20px;font-size:9.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;background:${statusBg};color:${statusColor}">PAID</div>` : ""}
    </div>
  </div>
  <div class="divider"></div>
  <div class="grid2">
    <div>
      <div class="lbl">Bill To</div>
      <div style="font-weight:700;font-size:13px">${esc(invoice.productionCompany || "—")}</div>
      ${prodCo?.address ? `<div style="font-size:10.5px;color:#555;white-space:pre-wrap;margin-top:3px;line-height:1.5">${esc(prodCo.address)}</div>` : ""}
    </div>
    <div>
      <div class="lbl">From</div>
      <div style="font-weight:700;font-size:13px">${profileInfo?.firstName ? esc(`${profileInfo.firstName} ${profileInfo.lastName || ""}`.trim()) : esc(employee.name)}</div>
      ${profileInfo?.legalAddress ? `<div style="font-size:10.5px;color:#555;white-space:pre-wrap;margin-top:3px;line-height:1.5">${esc(profileInfo.legalAddress)}</div>` : ""}
      ${profileInfo?.phone ? `<div style="font-size:10.5px;color:#555;margin-top:3px">Phone No.: ${esc(profileInfo.phone)}</div>` : ""}
      ${profileInfo?.email ? `<div style="font-size:10.5px;color:#555;margin-top:2px">Email: ${esc(profileInfo.email)}</div>` : ""}
    </div>
  </div>
  <div class="job-box">
    <div style="font-weight:700;font-size:13px;margin-bottom:3px">${esc(invoice.jobName)}</div>
    <div style="font-size:11px;color:#555">Position: <strong>${esc(invoice.position || "—")}</strong>${dateStr ? ` &nbsp;|&nbsp; Dates: ${dateStr}` : ""}</div>
  </div>
  ${invoice.callWrap && Object.keys(invoice.callWrap).some(d => invoice.callWrap[d]?.call || invoice.callWrap[d]?.wrap) ? `
  <table style="margin-bottom:8px;width:auto;min-width:260px">
    <thead><tr><th>Date</th><th>Call Time</th><th>Wrap Time</th></tr></thead>
    <tbody>${Object.keys(invoice.callWrap).sort().map(d => {
      const cw = invoice.callWrap[d];
      if (!cw?.call && !cw?.wrap) return "";
      const label = new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
      return `<tr><td>${label}</td><td>${fmtClock(cw.call)}</td><td>${fmtClock(cw.wrap)}</td></tr>`;
    }).join("")}</tbody>
  </table>` : ""}
  <table>
    <thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Total</th></tr></thead>
    <tbody>${itemRows}</tbody>
    <tfoot>${(() => {
      if (!invoice.vatEnabled) return `<tr class="total-row"><td colspan="3">TOTAL AMOUNT</td><td class="num">฿${total.toLocaleString()}</td></tr>`;
      const { subtotal: sub, vatAmount: vat, total: grand } = calcVatBreakdown(invoice);
      const fmt2 = n => n.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const vatLabel = invoice.vatType === "inclusive" ? "VAT 7% (incl.)" : "VAT 7%";
      const subLabel = invoice.vatType === "inclusive" ? "Subtotal (excl. VAT)" : "Subtotal";
      return `<tr><td colspan="3" style="font-size:10px;color:#888;font-weight:400;border-top:1px solid #ddd">${subLabel}</td><td class="num" style="font-size:10px;color:#888;border-top:1px solid #ddd">฿${fmt2(sub)}</td></tr>
      <tr><td colspan="3" style="font-size:10px;color:#888;font-weight:400">${vatLabel}</td><td class="num" style="font-size:10px;color:#888">฿${fmt2(vat)}</td></tr>
      <tr class="total-row"><td colspan="3">TOTAL AMOUNT (incl. VAT)</td><td class="num">฿${Math.round(grand).toLocaleString()}</td></tr>`;
    })()}</tfoot>
  </table>
  ${hasMixedVat ? `<p style="font-size:8.5px;color:#999;margin:2px 0 8px"><sup>*</sup> Non 7% VAT</p>` : ""}
  ${(promptPayQR || idCard || signature) ? `
  <div class="bottom-box">
    ${promptPayQR ? `<div style="text-align:center;flex-shrink:0">
      <div class="lbl" style="margin-bottom:6px">PromptPay / QR Payment</div>
      <img src="${promptPayQR}" style="width:208px;height:208px;object-fit:contain;border:1px solid #ddd;border-radius:6px;background:#fff"/>
      ${(profileInfo?.bankName || profileInfo?.bankAccount || profileInfo?.accountName) ? `<div style="margin-top:6px;font-size:10px;color:#444;line-height:1.7;text-align:center;pointer-events:none">
        ${profileInfo.bankName ? `<div style="font-weight:700">${esc(profileInfo.bankName)}</div>` : ""}
        ${profileInfo.accountName ? `<div>${esc(profileInfo.accountName)}</div>` : ""}
        ${profileInfo.bankAccount ? `<div>${esc(profileInfo.bankAccount)}</div>` : ""}
      </div>` : ""}
    </div>` : ""}
    ${idCard ? `<div class="id-wrap">
      <div class="lbl" style="margin-bottom:6px">ID Card</div>
      <img class="id-img" src="${idCard}" />
    </div>` : ""}
    ${signature ? `<div class="sig-col">
      <div style="font-size:8.5px;color:#888;text-align:center;line-height:1.6;margin-bottom:8px;max-width:180px">
        ข้อมูลและสำเนาถูกต้อง<br>ใช้สำหรับงาน <strong>${esc(invoice.jobName || "—")}</strong><br>ของ <strong>${esc(invoice.productionCompany || "—")}</strong>
      </div>
      <img class="sig-img" src="${signature}" />
    </div>` : ""}
  </div>` : ""}
  </div>
  ${(isAdminInvoice ? invoice.showWatermark : true) ? `<img src="${LOGO_B64}" style="position:fixed;bottom:15mm;right:10mm;width:31.5mm;opacity:0.12;pointer-events:none;z-index:0" />` : ""}
  ${autoPrint ? `<script>window.onload=()=>{setTimeout(()=>{window.print();window.onafterprint=()=>window.close();},600);}<\/script>` : ""}
  </body></html>`;
  return html;
}

function printInvoice({ invoice, employee, profileInfo, promptPayQR, idCard, signature, productionCompanies, companyName, print: doPrint = true }) {
  const html = buildInvoiceHTML({ invoice, employee, profileInfo, promptPayQR, idCard, signature, productionCompanies, companyName, autoPrint: doPrint });
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

const DEFAULT_ITEMS = [
  { id: "d1", description: "Labor (12hr)", qty: 1, rate: "", vat: true },
  { id: "d2", description: "Overtime", qty: 1, rate: "", vat: true },
  { id: "d3", description: "Travel Day Fee", qty: 1, rate: "", vat: true },
];

function migrateItems(inv) {
  if (inv?.items) return inv.items.map(it => ({ vat: true, ...it }));
  const items = [];
  const add = (desc, val) => { if (parseFloat(val) > 0) items.push({ id: "m" + desc, description: desc, qty: 1, rate: val, vat: true }); };
  add("Labor (12hr)", inv?.laborFee); add("Overtime", inv?.overtime);
  add("Travel Day Fee", inv?.travelFee); add("Per Diem", inv?.perDiem);
  return items.length ? items : JSON.parse(JSON.stringify(DEFAULT_ITEMS));
}

function InvoiceCreateModal({ job, existingInvoice, employee, positions = [], onSave, onClose, allInvoices, companyName = "", invoicePresets = [], invoicePrefix = "", productionCompanies = [], jobs = [], adminRequests = [] }) {
  const [jobName, setJobName] = useState(existingInvoice?.jobName || job?.name || "");
  const [productionCompany, setProductionCompany] = useState(existingInvoice?.productionCompany || job?.production || "");
  const [showCompanyPicker, setShowCompanyPicker] = useState(false);
  const [companySearch, setCompanySearch] = useState("");
  const [vatEnabled, setVatEnabled] = useState(existingInvoice?.vatEnabled ?? false);
  const [vatType, setVatType] = useState(existingInvoice?.vatType || "exclusive");
  const [shootDates, setShootDates] = useState(existingInvoice?.shootDates || job?.dates || []);
  const [linkedInvId, setLinkedInvId] = useState(existingInvoice?.linkedInvId || "");
  const [position, setPosition] = useState(existingInvoice?.position || "");
  const [status, setStatus] = useState(existingInvoice?.status || "Pending");
  const [docType, setDocType] = useState(existingInvoice?.docType || "invoice");
  const [invoiceHeader, setInvoiceHeader] = useState(existingInvoice?.invoiceHeader ?? companyName);
  const isAdminCreator = employee?.id === "admin";
  const [showWatermark, setShowWatermark] = useState(existingInvoice ? !!existingInvoice.showWatermark : !isAdminCreator);
  const [items, setItems] = useState(() => migrateItems(existingInvoice));
  const [callWrap, setCallWrap] = useState(() => {
    if (existingInvoice?.callWrap) return existingInvoice.callWrap;
    const obj = {};
    (existingInvoice?.shootDates || job?.dates || []).forEach(d => { obj[d] = { call: "", wrap: "" }; });
    return obj;
  });

  const updateItem = (id, field, val) => setItems(p => p.map(it => it.id === id ? { ...it, [field]: val } : it));
  const addItem = () => setItems(p => [...p, { id: "i" + Date.now(), description: "", qty: 1, rate: "", vat: true }]);
  const removeItem = (id) => setItems(p => p.filter(it => it.id !== id));
  const addShootDate = (d) => { setShootDates(p => p.includes(d) ? p : [...p, d].sort()); setCallWrap(p => ({ ...p, [d]: p[d] || { call: "", wrap: "" } })); };
  const removeShootDate = (d) => setShootDates(p => p.filter(x => x !== d));

  // Position list comes from the employee's profile rates; fall back to the static list.
  const positionNames = positions.length ? [...new Set(positions.map(p => p.name).filter(Boolean))] : POSITIONS;
  const selectedPos = positions.find(p => p.name === position);
  // Only auto-manage line items for new invoices, or older ones already built with auto rows.
  const autoFillEnabled = !existingInvoice || (existingInvoice.items || []).some(it => it.auto);

  // Auto-fill labor (day rate × days) and a single Overtime line from call/wrap times.
  useEffect(() => {
    if (!autoFillEnabled) return;
    if (!selectedPos) { setItems(prev => prev.some(it => it.auto) ? prev.filter(it => !it.auto) : prev); return; }
    const dayList = shootDates.length ? shootDates : Object.keys(callWrap);
    const daysWithTime = dayList.filter(d => callWrap[d]?.call && callWrap[d]?.wrap);
    const qtyDays = daysWithTime.length || dayList.length || 1;
    const hpd = parseFloat(selectedPos.hoursPerDay) || 12;
    let totalOt = 0;
    dayList.forEach(d => { const cw = callWrap[d]; if (cw?.call && cw?.wrap) totalOt += calcOtAmount(cw.call, cw.wrap, selectedPos); });
    totalOt = Math.round(totalOt);
    setItems(prev => {
      // keep manual rows, but drop the redundant empty default Labor/Overtime rows we now auto-generate
      const manual = prev.filter(it => !it.auto).filter(it => {
        const hasRate = (parseFloat((it.rate || "").toString().replace(/,/g, "")) || 0) > 0;
        const isLaborOrOt = /labor|overtime/i.test(it.description || "");
        return hasRate || !isLaborOrOt;
      });
      const auto = [{ id: "auto-labor", description: `${selectedPos.name} (${hpd}hr)`, qty: qtyDays, rate: parseFloat(selectedPos.dayRate) || 0, auto: "labor" }];
      if (totalOt > 0) auto.push({ id: "auto-ot", description: "Overtime", qty: 1, rate: totalOt, auto: "ot" });
      return [...auto, ...manual];
    });
  }, [position, callWrap, positions]); // eslint-disable-line

  const total = items.reduce((s, it) => s + (parseFloat(it.qty) || 0) * (parseFloat((it.rate || "").toString().replace(/,/g, "")) || 0), 0);

  const save = () => {
    if (docType === "receipt" && !existingInvoice && !linkedInvId) {
      window.alert("Please select a Paid invoice to link this Tax Receipt to.");
      return;
    }
    const now = Date.now();
    let invNo, revisions;
    if (existingInvoice) {
      invNo = existingInvoice.invoiceNo;
      revisions = (existingInvoice.revisions || 0) + 1;
    } else {
      const genSeq = (pfx) => {
        const yr = new Date().getFullYear().toString().slice(-2);
        const empPrefix = (employee?.invoicePrefix || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
        const prefix = empPrefix ? `${pfx}-${empPrefix}-${yr}-` : `${pfx}-${yr}-`;
        const reStr = empPrefix ? `${pfx}-${empPrefix}-\\d{2}-(\\d+)` : `${pfx}-\\d{2}-(\\d+)`;
        const re = new RegExp(reStr);
        const matches = (allInvoices || []).filter(inv => inv.invoiceNo?.startsWith(prefix));
        let maxSeq = 0;
        matches.forEach(inv => { const m = inv.invoiceNo.match(re); if (m) maxSeq = Math.max(maxSeq, parseInt(m[1])); });
        return `${prefix}${String(maxSeq + 1).padStart(4, "0")}`;
      };
      if (docType === "receipt" && linkedInvId) {
        const linkedInv = (allInvoices || []).find(i => i.id === linkedInvId);
        invNo = linkedInv ? (linkedInv.invoiceNo || "").replace(/^INV-/, "RTX-") : genSeq("RTX");
      } else {
        const docPfx = { invoice: "INV", quotation: "QUO", receipt: "RTX" }[docType] || "INV";
        invNo = genSeq(docPfx);
      }
      revisions = 0;
    }
    onSave({
      id: existingInvoice?.id || "inv" + now,
      invoiceNo: invNo,
      revisions,
      employeeId: employee.id,
      employeeName: employee.name,
      jobId: job?.id || existingInvoice?.jobId || "",
      createdAt: existingInvoice?.createdAt || now,
      updatedAt: now,
      jobName, productionCompany, shootDates, position, status, docType, items, callWrap, invoiceHeader, showWatermark, vatEnabled, vatType,
      ...(linkedInvId ? { linkedInvId } : {}),
    });
  };

  const dateStr = shootDates.map(d => new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })).join(", ");

  return (<>
    <Modal title={existingInvoice ? "Edit Document" : "Create Document"} onClose={onClose} wide>
      <div style={S.col}>
        <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
          {[{ id: "invoice", label: "INV Invoice" }, { id: "quotation", label: "QUO Quotation" }, { id: "receipt", label: "RTX Tax Receipt" }].map(dt => (
            <button key={dt.id} onClick={() => setDocType(dt.id)}
              style={{ ...S.btn(docType === dt.id ? "primary" : "ghost"), padding: "6px 16px", fontSize: 13, flex: 1 }}>
              {dt.label}
            </button>
          ))}
        </div>
        <div style={{ ...S.card, background: "rgba(232,184,75,0.04)", border: "1px solid rgba(232,184,75,0.15)" }}>
          <p style={S.sectionTitle}>Job Info</p>
          <div style={S.col}>
            <div><label style={S.label}>Invoice Header <span style={{ color: "var(--text-muted,#666)", fontWeight: 400 }}>(displayed at top of invoice)</span></label><input style={S.input} value={invoiceHeader} onChange={e => setInvoiceHeader(e.target.value)} placeholder={companyName || "Your name or company"} /></div>
            {isAdminCreator && (
              <button onClick={() => setShowWatermark(v => !v)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 8, background: showWatermark ? "rgba(232,184,75,0.05)" : "rgba(255,255,255,0.03)", border: `1px solid ${showWatermark ? "rgba(232,184,75,0.25)" : "#252830"}`, cursor: "pointer", userSelect: "none", textAlign: "left" }}>
                <div style={{ width: 36, height: 20, borderRadius: 10, background: showWatermark ? "var(--accent,#e8b84b)" : "#444", position: "relative", flexShrink: 0, transition: "background .2s" }}>
                  <div style={{ position: "absolute", top: 2, left: showWatermark ? 18 : 2, width: 16, height: 16, borderRadius: "50%", background: "#fff", transition: "left .2s", boxShadow: "0 1px 3px rgba(0,0,0,.3)" }} />
                </div>
                <div>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: showWatermark ? "var(--accent,#e8b84b)" : "var(--text,#e8e4dc)" }}>Pick Shoot Return watermark {showWatermark ? "ON" : "OFF"}</p>
                  <p style={{ margin: 0, fontSize: 11, color: "var(--text-muted,#666)", marginTop: 2 }}>{showWatermark ? "Faint logo shown at lower-right of invoice" : "No watermark on this invoice"}</p>
                </div>
              </button>
            )}
            <div><label style={S.label}>Job Name</label><input style={S.input} value={jobName} onChange={e => setJobName(e.target.value)} /></div>
            <div>
              <label style={S.label}>Production Company</label>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <div style={{ ...S.input, flex: 1, display: "flex", alignItems: "center", cursor: "pointer", minHeight: 38 }} onClick={() => { setCompanySearch(""); setShowCompanyPicker(true); }}>
                  {productionCompany ? <span style={{ color: "var(--text,#e8e4dc)", fontSize: 14 }}>{productionCompany}</span> : <span style={{ color: "#444", fontSize: 13 }}>Tap to select…</span>}
                </div>
                {productionCompany && <button style={{ ...S.btn("ghost"), padding: "6px 8px" }} onClick={() => setProductionCompany("")}><Icon d={icons.x} size={12} /></button>}
              </div>
            </div>
            {/* Shoot dates editor */}
            <div>
              <label style={S.label}>Shoot Dates</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                {shootDates.map(d => (
                  <div key={d} style={{ display: "flex", alignItems: "center", gap: 3, background: "rgba(232,184,75,0.08)", border: "1px solid rgba(232,184,75,0.2)", borderRadius: 5, padding: "4px 8px" }}>
                    <span style={{ fontSize: 12, color: "var(--text,#e8e4dc)" }}>{new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
                    <button onClick={() => removeShootDate(d)} style={{ background: "none", border: "none", cursor: "pointer", color: "#666", padding: "0 0 0 6px", fontSize: 15, lineHeight: 1 }}>×</button>
                  </div>
                ))}
                <input type="date" style={{ ...S.input, fontSize: 12, padding: "4px 8px", width: "auto", minWidth: 0 }}
                  onChange={e => { if (e.target.value) { addShootDate(e.target.value); e.target.value = ""; } }} />
              </div>
            </div>
            {/* RTX: link to paid INV only */}
            {docType === "receipt" && !existingInvoice && (() => {
              const paidInvs = (allInvoices || []).filter(i => (i.docType === "invoice" || !i.docType) && (isAdminCreator || i.employeeId === employee.id) && i.status === "Paid").sort((a, b) => b.updatedAt - a.updatedAt);
              return (
                <div>
                  <label style={S.label}>Linked Invoice <span style={{ color: "var(--text-muted,#666)", fontWeight: 400 }}>(RTX only issues for a Paid invoice)</span></label>
                  {paidInvs.length === 0 ? (
                    <div style={{ ...S.card, background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)", padding: "10px 14px" }}>
                      <p style={{ margin: 0, fontSize: 12, color: "#f87171" }}>No paid invoices yet. Mark an INV as Paid before issuing a Tax Receipt.</p>
                    </div>
                  ) : (
                    <>
                      <select style={S.select} value={linkedInvId} onChange={e => setLinkedInvId(e.target.value)}>
                        <option value="">Select paid invoice…</option>
                        {paidInvs.map(i => <option key={i.id} value={i.id}>{fmtInvoiceNo(i)} — {i.jobName}{isAdminCreator && i.employeeName ? ` (${i.employeeName})` : ""}</option>)}
                      </select>
                      {linkedInvId && (() => {
                        const li = paidInvs.find(i => i.id === linkedInvId);
                        return li ? <p style={{ fontSize: 11, color: "var(--accent,#e8b84b)", margin: "5px 0 0" }}>RTX will use: {(li.invoiceNo || "").replace(/^INV-/, "RTX-")}</p> : null;
                      })()}
                    </>
                  )}
                </div>
              );
            })()}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={S.label}>Position</label>
            <select style={S.select} value={position} onChange={e => setPosition(e.target.value)}>
              <option value="">Select position…</option>
              {positionNames.map(p => <option key={p} value={p}>{p}</option>)}
              {position && !positionNames.includes(position) && <option value={position}>{position}</option>}
            </select>
            {selectedPos && <p style={{ fontSize: 11, color: "var(--accent,#e8b84b)", margin: "5px 0 0" }}>฿{(parseFloat(selectedPos.dayRate) || 0).toLocaleString()} / {parseFloat(selectedPos.hoursPerDay) || 12}hr — rates auto-filled below</p>}
            {positions.length === 0 && <p style={{ fontSize: 11, color: "var(--text-muted,#666)", margin: "5px 0 0" }}>Add roles &amp; day rates in your Profile to auto-fill invoices.</p>}
          </div>
          <div>
            <label style={S.label}>Status</label>
            <select style={S.select} value={status} onChange={e => setStatus(e.target.value)}>
              <option>Pending</option>
              <option>Paid</option>
            </select>
          </div>
        </div>

        {/* Call / Wrap times */}
        {shootDates.length > 0 && (
          <div>
            <p style={{ ...S.sectionTitle, marginBottom: 8 }}>Call / Wrap Times</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
              {["Date", "Call", "Wrap"].map(h => (
                <div key={h} style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text-muted,#666)" }}>{h}</div>
              ))}
              {shootDates.map(d => {
                const cw = callWrap[d] || { call: "", wrap: "" };
                const label = new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
                return [
                  <div key={d + "_lbl"} style={{ fontSize: 12, color: "var(--text,#e8e4dc)", display: "flex", alignItems: "center", fontWeight: 600 }}>{label}</div>,
                  <input key={d + "_call"} style={{ ...S.input, fontSize: 12, padding: "6px 8px" }} type="time" value={cw.call} onChange={e => setCallWrap(p => ({ ...p, [d]: { ...p[d], call: e.target.value } }))} />,
                  <input key={d + "_wrap"} style={{ ...S.input, fontSize: 12, padding: "6px 8px" }} type="time" value={cw.wrap} onChange={e => setCallWrap(p => ({ ...p, [d]: { ...p[d], wrap: e.target.value } }))} />,
                ];
              })}
            </div>
          </div>
        )}

        {/* Auto overtime summary */}
        {selectedPos && (() => {
          const dayList = shootDates.length ? shootDates : Object.keys(callWrap);
          const hpd = parseFloat(selectedPos.hoursPerDay) || 12;
          const rows = dayList.map(d => {
            const cw = callWrap[d] || {};
            if (!cw.call || !cw.wrap) return null;
            const wk = hoursWorked(cw.call, cw.wrap);
            return { d, wk, otH: Math.max(0, wk - hpd), ot: calcOtAmount(cw.call, cw.wrap, selectedPos) };
          }).filter(Boolean);
          if (!rows.length) return null;
          const totalOt = Math.round(rows.reduce((s, r) => s + r.ot, 0));
          const fmtH = h => (h % 1 ? h.toFixed(1) : h);
          return (
            <div style={{ ...S.card, background: "rgba(232,184,75,0.04)", border: "1px solid rgba(232,184,75,0.15)", padding: 14 }}>
              <p style={{ ...S.sectionTitle, marginBottom: 8 }}>Overtime (auto-calculated)</p>
              {rows.map(r => {
                const label = new Date(r.d + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
                return (
                  <div key={r.d} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-muted,#888)", padding: "2px 0" }}>
                    <span>{label} · {fmtH(r.wk)}h worked{r.otH > 0 ? ` · OT ${fmtH(r.otH)}h` : " · no OT"}</span>
                    <span style={{ color: r.ot > 0 ? "var(--accent,#e8b84b)" : "#555", fontWeight: 600 }}>{r.ot > 0 ? `฿${Math.round(r.ot).toLocaleString()}` : "—"}</span>
                  </div>
                );
              })}
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700, borderTop: "1px solid var(--divider-color,#252830)", marginTop: 6, paddingTop: 6 }}>
                <span>Total OT</span><span style={{ color: "var(--accent,#e8b84b)" }}>฿{totalOt.toLocaleString()}</span>
              </div>
              <p style={{ fontSize: 10, color: "#555", margin: "8px 0 0" }}>Added as a single "Overtime" line item below. Fill call &amp; wrap times to update.</p>
            </div>
          );
        })()}

        {/* VAT Settings */}
        <div style={S.card}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <p style={{ ...S.sectionTitle, margin: 0 }}>VAT</p>
            <button onClick={() => setVatEnabled(v => !v)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 8, background: vatEnabled ? "rgba(232,184,75,0.06)" : "rgba(255,255,255,0.02)", border: `1px solid ${vatEnabled ? "rgba(232,184,75,0.25)" : "#252830"}`, cursor: "pointer", userSelect: "none" }}>
              <div style={{ width: 32, height: 18, borderRadius: 9, background: vatEnabled ? "var(--accent,#e8b84b)" : "#444", position: "relative", flexShrink: 0, transition: "background .2s" }}>
                <div style={{ position: "absolute", top: 2, left: vatEnabled ? 16 : 2, width: 14, height: 14, borderRadius: "50%", background: "#fff", transition: "left .2s", boxShadow: "0 1px 3px rgba(0,0,0,.3)" }} />
              </div>
              <span style={{ fontSize: 13, fontWeight: 600, color: vatEnabled ? "var(--accent,#e8b84b)" : "var(--text-muted,#666)" }}>7% VAT {vatEnabled ? "ON" : "OFF"}</span>
            </button>
          </div>
          {vatEnabled && (
            <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
              {[["exclusive", "Excl. (+ 7% on top)"], ["inclusive", "Incl. (7% baked in)"]].map(([k, lbl]) => (
                <button key={k} style={{ ...S.btn(vatType === k ? "primary" : "ghost"), flex: 1, fontSize: 12, padding: "7px 10px" }} onClick={() => setVatType(k)}>{lbl}</button>
              ))}
            </div>
          )}
        </div>

        {/* Line items */}
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <p style={{ ...S.sectionTitle, margin: 0 }}>Line Items</p>
            <button style={{ ...S.btn("ghost"), padding: "4px 10px", fontSize: 12 }} onClick={addItem}><Icon d={icons.plus} size={12} /> Add Item</button>
          </div>
          {isAdminCreator && invoicePresets.filter(ip => ip.description?.trim()).length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
              {invoicePresets.filter(ip => ip.description?.trim()).map(ip => (
                <button key={ip.id} style={{ ...S.btn("ghost"), padding: "4px 10px", fontSize: 12, border: "1px solid rgba(232,184,75,0.35)", color: "#e8b84b" }}
                  onClick={() => setItems(p => [...p, { id: "i" + Date.now(), description: ip.description, qty: 1, rate: ip.rate || "", vat: true }])}>
                  + {ip.description}{ip.rate ? ` ฿${Number(ip.rate).toLocaleString()}` : ""}
                </button>
              ))}
            </div>
          )}

          {/* Header */}
          <div style={{ display: "grid", gridTemplateColumns: vatEnabled ? "1fr 50px 70px 80px 32px 28px" : "1fr 50px 70px 80px 28px", gap: 6, marginBottom: 4 }}>
            {(vatEnabled ? ["Description", "Qty", "Rate (฿)", "Total", "", "VAT"] : ["Description", "Qty", "Rate (฿)", "Total", ""]).map((h, i) => (
              <div key={i} style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text-muted,#666)", textAlign: (vatEnabled ? i >= 3 : i >= 2) ? "center" : "left" }}>{h}</div>
            ))}
          </div>

          <div style={S.col}>
            {items.map(it => {
              const lineTotal = (parseFloat(it.qty) || 0) * (parseFloat((it.rate || "").toString().replace(/,/g, "")) || 0);
              const itemVat = it.vat !== false;
              return (
                <div key={it.id} style={{ display: "grid", gridTemplateColumns: vatEnabled ? "1fr 50px 70px 80px 32px 28px" : "1fr 50px 70px 80px 28px", gap: 6, alignItems: "center" }}>
                  <input style={{ ...S.input, fontSize: 12, padding: "7px 10px" }} value={it.description} onChange={e => updateItem(it.id, "description", e.target.value)} placeholder="Labor…" />
                  <input style={{ ...S.input, fontSize: 12, padding: "7px 6px", textAlign: "right" }} type="number" min="0" step="0.5" value={it.qty} onChange={e => updateItem(it.id, "qty", e.target.value)} />
                  <input style={{ ...S.input, fontSize: 12, padding: "7px 8px", textAlign: "right" }} type="number" min="0" value={it.rate} onChange={e => updateItem(it.id, "rate", e.target.value)} placeholder="0" />
                  <div style={{ fontSize: 13, fontWeight: 700, textAlign: "right", color: lineTotal > 0 ? "var(--accent,#e8b84b)" : "var(--text-muted,#666)" }}>
                    {lineTotal > 0 ? `฿${lineTotal.toLocaleString()}` : "—"}
                  </div>
                  <button style={{ ...S.btn("danger"), padding: "5px 6px", minWidth: 0 }} onClick={() => removeItem(it.id)}><Icon d={icons.x} size={12} /></button>
                  {vatEnabled && (
                    <button
                      onClick={() => updateItem(it.id, "vat", !itemVat)}
                      title={itemVat ? "VAT applied" : "No VAT"}
                      style={{ width: 26, height: 26, borderRadius: 5, border: `1px solid ${itemVat ? "rgba(232,184,75,0.35)" : "#333"}`, background: itemVat ? "rgba(232,184,75,0.12)" : "transparent", cursor: "pointer", fontSize: 9, fontWeight: 800, color: itemVat ? "var(--accent,#e8b84b)" : "#555", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {itemVat ? "VAT" : "—"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Total / VAT breakdown */}
        {(() => {
          const { subtotal: sub, vatAmount: vat, total: grand } = calcVatBreakdown({ items, vatEnabled, vatType });
          const fmt = n => Math.round(n).toLocaleString();
          const fmt2 = n => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          return (
            <div style={{ paddingTop: 12, borderTop: "1px solid var(--divider-color,#252830)" }}>
              {vatEnabled ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 12, color: "var(--text-muted,#666)" }}>{vatType === "inclusive" ? "Subtotal (excl. VAT)" : "Subtotal"}</span>
                    <span style={{ fontSize: 14, color: "var(--text,#e8e4dc)" }}>฿{fmt2(sub)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 12, color: "var(--text-muted,#666)" }}>VAT 7%{vatType === "inclusive" ? " (incl.)" : ""}</span>
                    <span style={{ fontSize: 14, color: "var(--text,#e8e4dc)" }}>฿{fmt2(vat)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--divider-color,#252830)", paddingTop: 8, marginTop: 2 }}>
                    <span style={{ fontSize: 13, color: "var(--text-muted,#666)", fontWeight: 600 }}>Total (incl. VAT)</span>
                    <span style={{ fontSize: 20, fontWeight: 800, color: "var(--accent,#e8b84b)" }}>฿{fmt(grand)}</span>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12 }}>
                  <span style={{ fontSize: 12, color: "var(--text-muted,#666)" }}>Total</span>
                  <span style={{ fontSize: 20, fontWeight: 800, color: "var(--accent,#e8b84b)" }}>฿{fmt(sub)}</span>
                </div>
              )}
            </div>
          );
        })()}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button style={S.btn("ghost")} onClick={onClose}>Cancel</button>
          <button style={S.btn("primary")} onClick={save}>Save Invoice</button>
        </div>
      </div>
    </Modal>
    {showCompanyPicker && (() => {
      const mergedCompanies = (() => {
        const map = new Map();
        (productionCompanies || []).forEach(c => {
          const n = c.name?.trim(); if (!n) return;
          map.set(n.toLowerCase(), { name: n, tag: null });
        });
        (jobs || []).forEach(j => {
          const n = j.production?.trim(); if (!n) return;
          const key = n.toLowerCase();
          if (!map.has(key)) map.set(key, { name: n, tag: "from booking" });
        });
        (adminRequests || []).filter(r => r.type === "production-house" && r.status === "approved").forEach(r => {
          const n = r.name?.trim(); if (!n) return;
          const key = n.toLowerCase();
          const tag = `${r.employeeName || "Teammate"} added`;
          if (!map.has(key)) map.set(key, { name: n, tag });
          else if (map.get(key).tag === "from booking") map.get(key).tag = tag;
        });
        return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, ["th", "en"], { sensitivity: "base" }));
      })();
      const q = companySearch.trim().toLowerCase();
      const filtered = mergedCompanies.filter(c => !q || c.name.toLowerCase().includes(q));
      const customEntry = companySearch.trim() && !mergedCompanies.some(c => c.name.toLowerCase() === companySearch.trim().toLowerCase());
      return (
        <Modal title="Production Company" onClose={() => setShowCompanyPicker(false)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            <div style={{ padding: "0 0 12px" }}>
              <input
                autoFocus
                style={{ ...S.input, width: "100%", boxSizing: "border-box" }}
                placeholder="Search or type custom name…"
                value={companySearch}
                onChange={e => setCompanySearch(e.target.value)}
              />
            </div>
            <div style={{ maxHeight: "55vh", overflowY: "auto", margin: "0 -20px" }}>
              {filtered.length === 0 && !customEntry && (
                <p style={{ color: "#555", fontSize: 13, textAlign: "center", padding: "20px 0" }}>No companies found.</p>
              )}
              {filtered.map(co => (
                <div
                  key={co.name}
                  onClick={() => { setProductionCompany(co.name); setShowCompanyPicker(false); }}
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 20px", borderBottom: "1px solid var(--divider-color,#1e2030)", cursor: "pointer", background: co.name === productionCompany ? "rgba(232,184,75,0.07)" : "transparent" }}
                >
                  <span style={{ fontSize: 14, color: "var(--text,#e8e4dc)", fontWeight: co.name === productionCompany ? 700 : 400 }}>{co.name}</span>
                  {co.tag && <span style={{ fontSize: 10, color: "#666", background: "#1a1e27", border: "1px solid #2a2e3a", borderRadius: 4, padding: "2px 6px", flexShrink: 0, marginLeft: 10 }}>{co.tag}</span>}
                </div>
              ))}
              {customEntry && (
                <div
                  onClick={() => { setProductionCompany(companySearch.trim()); setShowCompanyPicker(false); }}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 20px", borderBottom: "1px solid var(--divider-color,#1e2030)", cursor: "pointer" }}
                >
                  <Icon d={icons.plus} size={14} color="#e8b84b" />
                  <span style={{ fontSize: 14, color: "#e8b84b" }}>Use "{companySearch.trim()}"</span>
                </div>
              )}
            </div>
          </div>
        </Modal>
      );
    })()}
  </>
  );
}

// ─── PRODUCTION COMBOBOX ─────────────────────────────────────────────────────
function ProductionCombobox({ value, onChange, companies }) {
  const [query, setQuery] = useState(value || "");
  const [open, setOpen] = useState(false);

  useEffect(() => { setQuery(value || ""); }, [value]);

  const filtered = companies.filter(c =>
    !query.trim() || c.name.toLowerCase().includes(query.toLowerCase())
  );

  const select = (name) => { setQuery(name); onChange(name); setOpen(false); };

  return (
    <div style={{ position: "relative" }}>
      <input
        style={S.input}
        value={query}
        placeholder="e.g. One More Films"
        onChange={e => { setQuery(e.target.value); onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && filtered.length > 0 && (
        <div style={{ position: "absolute", top: "calc(100% + 3px)", left: 0, right: 0, zIndex: 300, background: "var(--surface,#1a1e27)", border: "var(--card-border,1px solid #252830)", borderRadius: "var(--btn-radius,7px)", boxShadow: "0 8px 24px rgba(0,0,0,0.4)", overflow: "hidden", maxHeight: 200, overflowY: "auto" }}>
          {filtered.map((co, i) => (
            <div
              key={co.id}
              onMouseDown={() => select(co.name)}
              style={{ padding: "10px 14px", cursor: "pointer", fontSize: 13, color: "var(--text,#e8e4dc)", borderBottom: i < filtered.length - 1 ? "1px solid var(--divider-color,#1e2030)" : "none", background: co.name === value ? "rgba(232,184,75,0.08)" : "transparent" }}
            >
              <div style={{ fontWeight: co.name === value ? 700 : 400 }}>{co.name}</div>
              {co.address && <div style={{ fontSize: 11, color: "var(--text-muted,#666)", marginTop: 2 }}>{co.address.split("\n")[0]}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── SHARED JOB FORM MODAL ────────────────────────────────────────────────────
function JobFormModal({ editTarget, jobs, setJobs, productionCompanies, employees, lineGroupId, lineNotifyMuted, onClose }) {
  const t = useT();
  const CONTACT_PLATFORMS = ["Line", "Facebook", "WhatsApp", "Instagram", "Phone"];
  const EMPTY = { name: "", production: "", dates: [], status: "Pencil", shootTime: "Day", location: "Local (Bangkok)", locationCity: "", contactPerson: "", contactPlatform: "Line" };
  const [form, setForm] = useState(editTarget ? { ...editTarget } : EMPTY);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const d = editTarget?.dates?.[0] ? new Date(editTarget.dates[0] + "T00:00:00") : new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  const toggleDate = (ds) => setForm(p => ({
    ...p, dates: p.dates.includes(ds) ? p.dates.filter(d => d !== ds) : [...p.dates, ds].sort()
  }));

  const saveJob = () => {
    if (!form.name.trim() || form.dates.length === 0) return;
    const isNew = !editTarget;
    const statusChanged = editTarget && editTarget.status !== form.status;
    if (editTarget) {
      setJobs(p => p.map(j => j.id === editTarget.id ? { ...j, ...form } : j));
    } else {
      setJobs(p => [...p, { ...form, id: "job" + Date.now(), assignedEquipment: [] }]);
    }
    {
      const emoji = form.status === "Confirmed" ? "✅" : form.status === "Cancelled" ? "❌" : "✏️";
      const action = isNew ? "New Job" : statusChanged ? `Status → ${form.status}` : "Updated";
      const groups = {};
      [...(form.dates || [])].sort().forEach(d => {
        const dt = new Date(d + "T00:00:00");
        const key = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}`;
        const label = dt.toLocaleString("en-GB", { month: "short" });
        if (!groups[key]) groups[key] = { label, days: [] };
        groups[key].days.push(dt.getDate());
      });
      const dateStr = Object.keys(groups).sort().map(k => `${groups[k].label} ${groups[k].days.join(",")}`).join(". ");
      const locationStr = form.location + (form.locationCity ? ` — ${form.locationCity}` : "");
      const msg = `${emoji} [${action}] ${form.name}\n🎬 ${form.production || "—"}\n📅 ${dateStr}\n📍 ${locationStr}\n🔗 https://pickshootreturn.pages.dev`;
      if (!lineNotifyMuted) {
        if (lineGroupId) {
          api.notify({ userIds: [lineGroupId], message: msg });
        } else {
          const lineIds = (employees || []).filter(e => e.lineUserId).map(e => e.lineUserId);
          if (lineIds.length > 0) api.notify({ userIds: lineIds, message: msg });
        }
      }
    }
    onClose();
  };

  const renderCalendar = () => {
    const { year, month } = calendarMonth;
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const monthName = new Date(year, month).toLocaleString("en-GB", { month: "long", year: "numeric" });
    const cells = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    const todayStr = today();
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <button style={{ ...S.btn("ghost"), padding: "5px 10px" }} onClick={() => setCalendarMonth(p => { const d = new Date(p.year, p.month - 1); return { year: d.getFullYear(), month: d.getMonth() }; })}>‹</button>
          <span style={{ flex: 1, textAlign: "center", fontWeight: 600, fontSize: 14 }}>{monthName}</span>
          <button style={{ ...S.btn("ghost"), padding: "5px 10px" }} onClick={() => setCalendarMonth(p => { const d = new Date(p.year, p.month + 1); return { year: d.getFullYear(), month: d.getMonth() }; })}>›</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
          {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map(d => <div key={d} style={{ textAlign: "center", fontSize: 10, color: "#666", fontWeight: 600, paddingBottom: 4 }}>{d}</div>)}
          {cells.map((d, i) => {
            if (!d) return <div key={"e" + i} />;
            const ds = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
            const selected = form.dates.includes(ds);
            const isToday = ds === todayStr;
            return (
              <div key={d} onClick={() => toggleDate(ds)} style={{ textAlign: "center", padding: "7px 0", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: selected ? 700 : 400, background: selected ? "#e8b84b" : isToday ? "rgba(232,184,75,0.1)" : "transparent", color: selected ? "#0f1117" : isToday ? "#e8b84b" : "#e8e4dc", border: isToday && !selected ? "1px solid rgba(232,184,75,0.3)" : "1px solid transparent" }}>
                {d}
              </div>
            );
          })}
        </div>
        {form.dates.length > 0 && (
          <p style={{ fontSize: 11, color: "#e8b84b", marginTop: 10 }}>{form.dates.length} date{form.dates.length > 1 ? "s" : ""} selected: {form.dates.map(formatDate).join(", ")}</p>
        )}
      </div>
    );
  };

  return (
    <Modal title={editTarget ? t("editJob") : t("newJob")} onClose={onClose} wide>
      <div style={S.col}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div style={{ gridColumn: "1/-1" }}><label style={S.label}>{t("jobNameField")}</label><input style={S.input} value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. TVC Toyota — Hero Film" /></div>
          <div style={{ gridColumn: "1/-1" }}>
            <label style={S.label}>{t("productionCoField")}</label>
            <ProductionCombobox value={form.production} onChange={v => setForm(p => ({ ...p, production: v }))} companies={productionCompanies} />
          </div>
          <div>
            <label style={S.label}>{t("jobStatusField")}</label>
            <select style={S.select} value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))}>
              {JOB_STATUSES.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label style={S.label}>{t("shootTimeField")}</label>
            <select style={S.select} value={form.shootTime} onChange={e => setForm(p => ({ ...p, shootTime: e.target.value }))}>
              {SHOOT_TIMES.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div style={{ gridColumn: "1/-1" }}>
            <label style={S.label}>{t("locationField")}</label>
            <select style={S.select} value={form.location} onChange={e => setForm(p => ({ ...p, location: e.target.value, locationCity: "" }))}>
              {LOCATIONS.map(l => <option key={l}>{l}</option>)}
            </select>
            {form.location !== "Local (Bangkok)" && (
              <input style={{ ...S.input, marginTop: 8 }} value={form.locationCity || ""} onChange={e => setForm(p => ({ ...p, locationCity: e.target.value }))} placeholder={form.location === "Overseas" ? "Country / City" : "Province / City"} />
            )}
          </div>
          <div>
            <label style={S.label}>{t("contactPersonField")}</label>
            <input style={S.input} value={form.contactPerson || ""} onChange={e => setForm(p => ({ ...p, contactPerson: e.target.value }))} placeholder="Name" />
          </div>
          <div>
            <label style={S.label}>{t("contactPlatformField")}</label>
            <select style={S.select} value={form.contactPlatform || "Line"} onChange={e => setForm(p => ({ ...p, contactPlatform: e.target.value }))}>
              {CONTACT_PLATFORMS.map(pl => <option key={pl}>{pl}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label style={S.label}>{t("datesField")}</label>
          {renderCalendar()}
          <button style={{ ...S.btn("ghost"), fontSize: 11, marginTop: 8 }} onClick={() => {
            const next = new Date(calendarMonth.year, calendarMonth.month + 1);
            setCalendarMonth({ year: next.getFullYear(), month: next.getMonth() });
          }}>{t("viewNextMonth")}</button>
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button style={S.btn("ghost")} onClick={onClose}>{t("cancel")}</button>
          <button style={S.btn("primary")} onClick={saveJob}>{t("saveJob")}</button>
        </div>
      </div>
    </Modal>
  );
}

function JobsPage({ jobs, setJobs, equipment, checkouts, productionCompanies, employees, lineGroupId, lineNotifyMuted, verificationConfig }) {
  const t = useT();
  const [modal, setModal] = useState(null);
  const [editTarget, setEditTarget] = useState(null);
  const [assignTarget, setAssignTarget] = useState(null);
  const [selectedJob, setSelectedJob] = useState(null);
  const [assignForm, setAssignForm] = useState({});
  const [assignCheckoutMode, setAssignCheckoutMode] = useState("span");
  // checkoutRoles: { barcode: "anyone"|[id,...], photo: "anyone"|[id,...] }
  const [assignRoles, setAssignRoles] = useState({ barcode: "anyone", photo: "anyone" });

  const openAdd = () => { setEditTarget(null); setModal("form"); };
  const openEdit = (job) => { setEditTarget(job); setModal("form"); };
  const del = (id) => { if (window.confirm(t("jobDeleteConfirm"))) setJobs(p => p.filter(j => j.id !== id)); };

  const openAssign = (job) => {
    const init = {};
    (job.assignedEquipment || []).forEach(ae => { init[ae.eqId] = ae.qty; });
    setAssignForm(init);
    setAssignTarget(job);
    setAssignCheckoutMode(job.checkoutMode || "span");
    setAssignRoles(job.checkoutRoles || { barcode: "anyone", photo: "anyone" });
    setModal("assign");
  };

  const saveAssign = () => {
    const assigned = Object.entries(assignForm).filter(([, qty]) => qty > 0).map(([eqId, qty]) => ({ eqId, qty: +qty }));
    setJobs(p => p.map(j => j.id === assignTarget.id ? { ...j, assignedEquipment: assigned, checkoutMode: assignCheckoutMode, checkoutRoles: assignRoles } : j));
    setModal(null);
  };

  const vMode = verificationConfig?.mode || "photo";
  // Helper to toggle a specific employee in a role slot
  const toggleRoleMember = (lane, empId) => {
    setAssignRoles(prev => {
      const cur = prev[lane];
      if (cur === "anyone") return { ...prev, [lane]: [empId] };
      const arr = Array.isArray(cur) ? cur : [];
      return { ...prev, [lane]: arr.includes(empId) ? arr.filter(id => id !== empId) : [...arr, empId] };
    });
  };

  const statusColor = { Pencil: "gray", Confirmed: "green", Cancelled: "red" };
  const locationColor = { "Local (Bangkok)": "blue", "Out of Town": "amber", "Overseas": "red" };

  const getCheckoutSummary = (job) => {
    const jobCheckouts = checkouts.filter(c => c.jobId === job.id);
    const outCount = (job.assignedEquipment || []).length;
    const picked = new Set(jobCheckouts.filter(c => c.type === "pick" || c.type === "checkout").map(c => c.eqId)).size;
    const returned = new Set(jobCheckouts.filter(c => c.type === "return").map(c => c.eqId)).size;
    return { outCount, picked, returned };
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
        <div>
          <h1 style={S.pageTitle}>{t("jobBookings")}</h1>
          <p style={S.pageSubtitle}>{jobs.filter(j => j.status === "Confirmed").length} {t("dashConfirmedLabel")} · {jobs.filter(j => j.status === "Pencil").length} {t("dashPencilLabel")}</p>
        </div>
        <button style={S.btn("primary")} onClick={openAdd}><Icon d={icons.plus} size={15} /> {t("jobNewJob")}</button>
      </div>

      {/* Job list */}
      <div style={S.col}>
        {jobs.length === 0 && <p style={{ color: "#666", fontSize: 13 }}>{t("jobNoJobs")}</p>}
        {jobs.sort((a, b) => (b.dates[0] || "") > (a.dates[0] || "") ? 1 : -1).map(job => {
          const { outCount, picked, returned } = getCheckoutSummary(job);
          const todayDates = job.dates.filter(d => d >= today());
          return (
            <div key={job.id} style={{ ...S.card, cursor: "pointer" }} onClick={() => setSelectedJob(selectedJob?.id === job.id ? null : job)}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                    <span style={S.badge(statusColor[job.status])}>{job.status}</span>
                    <span style={S.badge(locationColor[job.location] || "gray")}>{job.location}{job.locationCity ? ` · ${job.locationCity}` : ""}</span>
                    <span style={S.badge("gray")}>{job.shootTime}</span>
                    {job.checkoutMode === "daily" && <span style={S.badge("blue")}>{t("jobDailyReturn")}</span>}
                  </div>
                  <h3 style={{ margin: "0 0 2px", fontSize: 16, fontWeight: 700 }}>{job.name}</h3>
                  <p style={{ margin: 0, fontSize: 12, color: "#666" }}>{job.production}</p>
                  <p style={{ margin: "6px 0 0", fontSize: 12, color: "#8a8f9d" }}>
                    {job.dates.length} day{job.dates.length !== 1 ? "s" : ""} · {job.dates[0] ? formatDate(job.dates[0]) : "No date"}{job.dates.length > 1 ? ` → ${formatDate(job.dates[job.dates.length - 1])}` : ""}
                  </p>
                  {outCount > 0 && <p style={{ margin: "4px 0 0", fontSize: 11, color: "#60a5fa" }}>{outCount} assigned · {picked} picked · {returned} returned</p>}
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                  {job.status === "Confirmed" && <button style={{ ...S.btn("success"), padding: "6px 10px", fontSize: 12 }} onClick={() => openAssign(job)}><Icon d={icons.gear} size={13} /> {t("jobAssignGear")}</button>}
                  <button style={{ ...S.btn("ghost"), padding: "6px 8px" }} onClick={() => openEdit(job)}><Icon d={icons.edit} size={14} /></button>
                  <button style={{ ...S.btn("danger"), padding: "6px 8px" }} onClick={() => del(job.id)}><Icon d={icons.trash} size={14} /></button>
                </div>
              </div>

              {selectedJob?.id === job.id && (
                <div style={{ marginTop: 16 }}>
                  <div style={S.divider} />
                  <p style={S.sectionTitle}>{t("jobProductionDates")}</p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {job.dates.map(d => (
                      <span key={d} style={{ ...S.badge(d === today() ? "amber" : d < today() ? "gray" : "blue") }}>{formatDate(d)}{d === today() ? " ★ Today" : ""}</span>
                    ))}
                  </div>
                  {(job.assignedEquipment || []).length > 0 && (
                    <>
                      <div style={S.divider} />
                      <p style={S.sectionTitle}>{t("jobAssignedEq")}</p>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {job.assignedEquipment.map(ae => {
                          const eq = equipment.find(e => e.id === ae.eqId);
                          return eq ? <span key={ae.eqId} style={S.tag}>{eq.name} ×{ae.qty}</span> : null;
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Form Modal */}
      {modal === "form" && (
        <JobFormModal editTarget={editTarget} jobs={jobs} setJobs={setJobs} productionCompanies={productionCompanies} employees={employees} lineGroupId={lineGroupId} lineNotifyMuted={lineNotifyMuted} onClose={() => setModal(null)} />
      )}

      {/* Assign Equipment Modal — kanban style */}
      {modal === "assign" && assignTarget && (
        <Modal title={`${t("jobAssignGear")} — ${assignTarget.name}`} onClose={() => setModal(null)} wide>
          {/* Return mode selector */}
          <div style={{ marginBottom: 18 }}>
            <p style={{ ...S.label, marginBottom: 8 }}>{t("jobReturnMode")}</p>
            <div style={{ display: "flex", gap: 8 }}>
              {[
                { id: "span", label: t("jobSpanLabel"), desc: t("jobSpanDesc") },
                { id: "daily", label: t("jobDailyLabel"), desc: t("jobDailyDesc") },
              ].map(({ id, label, desc }) => (
                <div key={id}
                  onClick={() => setAssignCheckoutMode(id)}
                  style={{ flex: 1, padding: "10px 12px", borderRadius: 10, cursor: "pointer",
                    border: assignCheckoutMode === id ? "1.5px solid #e8b84b" : "1.5px solid #2e3340",
                    background: assignCheckoutMode === id ? "rgba(232,184,75,0.07)" : "#0f1117",
                    transition: "all 0.12s" }}>
                  <p style={{ margin: 0, fontWeight: 700, fontSize: 12, color: assignCheckoutMode === id ? "#e8b84b" : "#e8e4dc" }}>{label}</p>
                  <p style={{ margin: "3px 0 0", fontSize: 10, color: "#666", lineHeight: 1.4 }}>{desc}</p>
                </div>
              ))}
            </div>
          </div>
          <p style={{ fontSize: 12, color: "#8a8f9d", marginBottom: 16 }}>{t("jobTapAssign")}</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {equipment.map(eq => {
              const avList = calcAvailable(equipment, jobs.filter(j => j.id !== assignTarget.id), checkouts, assignTarget.dates[0] || today());
              const avForEq = avList.find(a => a.id === eq.id);
              const currentQty = +assignForm[eq.id] || 0;
              const maxAvail = avForEq?.available ?? 0;
              const isAssigned = currentQty > 0;
              const isMulti = eq.total > 1;

              return (
                <div key={eq.id}
                  onClick={() => {
                    if (!isAssigned && maxAvail === 0) return; // can't assign, none available
                    if (!isAssigned) setAssignForm(p => ({ ...p, [eq.id]: 1 }));
                    else setAssignForm(p => ({ ...p, [eq.id]: 0 }));
                  }}
                  style={{
                    display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 10,
                    border: isAssigned ? "1.5px solid #e8b84b" : maxAvail === 0 ? "1.5px solid #252830" : "1.5px solid #2e3340",
                    background: isAssigned ? "rgba(232,184,75,0.07)" : maxAvail === 0 ? "rgba(0,0,0,0.2)" : "#0f1117",
                    cursor: maxAvail === 0 && !isAssigned ? "not-allowed" : "pointer",
                    opacity: maxAvail === 0 && !isAssigned ? 0.45 : 1,
                    transition: "all 0.12s",
                  }}>

                  {/* Checkbox-style indicator */}
                  <div style={{ width: 22, height: 22, borderRadius: 6, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                    background: isAssigned ? "#e8b84b" : "#1a1e27", border: isAssigned ? "none" : "1.5px solid #3a4050" }}>
                    {isAssigned && <Icon d={icons.check} size={13} color="#0f1117" strokeW={3} />}
                  </div>

                  {/* Thumbnail */}
                  {eq.photo
                    ? <img src={eq.photo} alt="" style={{ width: 40, height: 36, objectFit: "cover", borderRadius: 6, flexShrink: 0 }} />
                    : <div style={{ width: 40, height: 36, borderRadius: 6, background: "#252830", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <Icon d={icons.camera} size={14} color="#444" />
                      </div>
                  }

                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontWeight: 600, fontSize: 13, color: isAssigned ? "#e8b84b" : "#e8e4dc", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{eq.name}</p>
                    <p style={{ margin: "2px 0 0", fontSize: 11, color: "#666" }}>
                      {eq.category}
                      {isMulti ? ` · ${maxAvail} of ${eq.total} free` : maxAvail === 0 ? ` · ${t("jobUnavailable")}` : ` · ${t("jobAvailable")}`}
                    </p>
                  </div>

                  {/* Qty stepper — only for multi-unit items when assigned */}
                  {isMulti && isAssigned && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}
                      onClick={e => e.stopPropagation()}>
                      <button
                        style={{ width: 28, height: 28, borderRadius: 6, border: "1px solid #3a4050", background: "#1a1e27", color: "#e8e4dc", fontSize: 16, lineHeight: 1, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                        onClick={() => setAssignForm(p => { const n = Math.max(1, (p[eq.id] || 1) - 1); return { ...p, [eq.id]: n }; })}>−</button>
                      <span style={{ minWidth: 20, textAlign: "center", fontWeight: 700, fontSize: 14, color: "#e8b84b" }}>{currentQty}</span>
                      <button
                        style={{ width: 28, height: 28, borderRadius: 6, border: "1px solid #3a4050", background: "#1a1e27", color: "#e8e4dc", fontSize: 16, lineHeight: 1, cursor: currentQty >= maxAvail ? "not-allowed" : "pointer", opacity: currentQty >= maxAvail ? 0.4 : 1, display: "flex", alignItems: "center", justifyContent: "center" }}
                        onClick={() => setAssignForm(p => ({ ...p, [eq.id]: Math.min(maxAvail, (p[eq.id] || 1) + 1) }))}>+</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Verification roles — only shown when mode is barcode or both */}
          {(vMode === "barcode" || vMode === "both") && (
            <div style={{ marginTop: 18, padding: "14px", background: "rgba(232,184,75,0.04)", border: "1px solid rgba(232,184,75,0.15)", borderRadius: 10 }}>
              <p style={{ ...S.label, marginBottom: 12 }}>{t("jobRoles")}</p>
              {[
                ...(vMode === "both" ? [{ lane: "barcode", label: t("jobRolesBarcode") }] : []),
                ...(vMode === "barcode" ? [{ lane: "barcode", label: t("jobRolesBarcode") }] : []),
                ...(vMode === "both" ? [{ lane: "photo", label: t("jobRolesPhoto") }] : []),
              ].filter((v, i, a) => a.findIndex(x => x.lane === v.lane) === i).map(({ lane, label }) => {
                const cur = assignRoles[lane];
                const isAnyone = cur === "anyone";
                return (
                  <div key={lane} style={{ marginBottom: 12 }}>
                    <p style={{ fontSize: 12, color: "#8a8f9d", marginBottom: 6 }}>{label}</p>
                    <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                      {[{ id: "anyone", label: t("jobRolesAnyone") }, { id: "fixed", label: t("jobRolesFixed") }].map(opt => (
                        <button key={opt.id}
                          onClick={() => setAssignRoles(prev => ({ ...prev, [lane]: opt.id === "anyone" ? "anyone" : [] }))}
                          style={{ ...S.btn((!isAnyone && opt.id === "fixed") || (isAnyone && opt.id === "anyone") ? "primary" : "ghost"), fontSize: 11, padding: "5px 12px" }}>
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    {!isAnyone && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {(employees || []).map(emp => {
                          const selected = Array.isArray(cur) && cur.includes(emp.id);
                          return (
                            <button key={emp.id} onClick={() => toggleRoleMember(lane, emp.id)}
                              style={{ fontSize: 11, padding: "5px 12px", borderRadius: 16, border: `1px solid ${selected ? "#e8b84b" : "#3a4050"}`, background: selected ? "rgba(232,184,75,0.15)" : "#0f1117", color: selected ? "#e8b84b" : "#8a8f9d", cursor: "pointer" }}>
                              {emp.name}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Summary */}
          {Object.values(assignForm).some(q => q > 0) && (
            <div style={{ marginTop: 14, padding: "10px 14px", background: "rgba(232,184,75,0.06)", border: "1px solid rgba(232,184,75,0.15)", borderRadius: 8 }}>
              <p style={{ margin: 0, fontSize: 11, color: "#e8b84b", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>{t("jobAssigned")}</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {Object.entries(assignForm).filter(([, q]) => q > 0).map(([eqId, qty]) => {
                  const eq = equipment.find(e => e.id === eqId);
                  return eq ? <span key={eqId} style={S.tag}>{eq.name}{eq.total > 1 ? ` ×${qty}` : ""}</span> : null;
                })}
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
            <button style={S.btn("ghost")} onClick={() => setModal(null)}>{t("cancel")}</button>
            <button style={S.btn("primary")} onClick={saveAssign}>{t("jobSaveAssign")}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── JOB DETAIL MODAL ────────────────────────────────────────────────────────
function JobDetailModal({ job, equipment, onClose }) {
  if (!job) return null;
  const statusColor = { Pencil: "gray", Confirmed: "green", Cancelled: "red" };
  return (
    <Modal title="Job Details" onClose={onClose}>
      <div style={S.col}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <span style={S.badge(statusColor[job.status] || "gray")}>{job.status}</span>
          <span style={S.badge("blue")}>{job.location}{job.locationCity ? ` · ${job.locationCity}` : ""}</span>
          <span style={S.badge("gray")}>{job.shootTime}</span>
        </div>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#e8e4dc" }}>{job.name}</h2>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "#8a8f9d" }}>{job.production}</p>
        </div>
        <div style={S.divider} />
        <div>
          <p style={S.label}>Shoot Dates</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {job.dates.map(d => (
              <span key={d} style={{ ...S.badge(d === today() ? "amber" : d < today() ? "gray" : "blue") }}>
                {formatDate(d)}{d === today() ? " ★" : ""}
              </span>
            ))}
          </div>
        </div>
        {(job.assignedEquipment || []).length > 0 && (
          <div>
            <p style={S.label}>Assigned Equipment</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {job.assignedEquipment.map(ae => {
                const eq = equipment.find(e => e.id === ae.eqId);
                if (!eq) return null;
                return (
                  <div key={ae.eqId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "#0f1117", borderRadius: 8 }}>
                    {eq.photo && <img src={eq.photo} alt="" style={{ width: 36, height: 32, objectFit: "cover", borderRadius: 5 }} />}
                    <div style={{ flex: 1 }}>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{eq.name}</p>
                      <p style={{ margin: 0, fontSize: 11, color: "#666" }}>{eq.category}{eq.total > 1 ? ` · ×${ae.qty}` : ""}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {(job.assignedEquipment || []).length === 0 && (
          <p style={{ fontSize: 12, color: "#555", fontStyle: "italic" }}>No equipment assigned yet.</p>
        )}
      </div>
    </Modal>
  );
}

// ─── DASHBOARD CALENDAR ───────────────────────────────────────────────────────
function DashboardCalendar({ jobs, equipment }) {
  const [calMonth, setCalMonth] = useState(() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() }; });
  const [detailJob, setDetailJob] = useState(null);

  const { year, month } = calMonth;
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthName = new Date(year, month).toLocaleString("en-GB", { month: "long", year: "numeric" });
  const todayStr = today();

  // Build date string for a given day number
  const ds = (d) => `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  // For each job, compute which days in this month it occupies
  // and classify consecutive runs as "spans" for rendering bars
  const STATUS_COLORS = {
    Confirmed: { bg: "rgba(52,211,153,0.18)", border: "#34d399", text: "#34d399" },
    Pencil:    { bg: "rgba(148,163,184,0.15)", border: "#94a3b8", text: "#94a3b8" },
    Cancelled: { bg: "rgba(239,68,68,0.12)", border: "#f87171", text: "#f87171" },
  };

  // For each cell row in the calendar grid, we need to know which job bars
  // are present. Strategy: assign each job a "lane" so bars don't overlap.
  // We work with a flat array of {jobId, day, isStart, isEnd, isContinued} entries.

  const daysInView = [];
  for (let d = 1; d <= daysInMonth; d++) daysInView.push(d);

  // Map: day -> list of jobs active that day
  const jobsOnDay = {};
  daysInView.forEach(d => { jobsOnDay[d] = []; });
  jobs.forEach(job => {
    job.dates.forEach(date => {
      const [y, m, dStr] = date.split("-").map(Number);
      if (y === year && m === month + 1) {
        jobsOnDay[dStr] = jobsOnDay[dStr] || [];
        jobsOnDay[dStr].push(job);
      }
    });
  });

  // Assign lanes per job for visual stacking (greedy)
  // For each job, find the days it spans in this month, assign the lowest free lane
  const jobLane = {};
  const laneOccupied = {}; // lane -> Set of days occupied
  const activeJobs = jobs.filter(j =>
    j.dates.some(date => { const [y,m] = date.split("-").map(Number); return y === year && m === month + 1; })
  );
  activeJobs.forEach(job => {
    const myDays = job.dates
      .filter(date => { const [y,m] = date.split("-").map(Number); return y === year && m === month + 1; })
      .map(date => parseInt(date.split("-")[2]));
    myDays.sort((a, b) => a - b);
    // Find a free lane
    let lane = 0;
    while (true) {
      if (!laneOccupied[lane]) laneOccupied[lane] = new Set();
      const conflict = myDays.some(d => laneOccupied[lane].has(d));
      if (!conflict) break;
      lane++;
    }
    jobLane[job.id] = lane;
    myDays.forEach(d => laneOccupied[lane].add(d));
  });

  const maxLane = Math.max(0, ...Object.values(jobLane));

  // Build calendar grid cells (7 cols)
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  // Pad to complete last row
  while (cells.length % 7 !== 0) cells.push(null);

  // For rendering bars: for each job, for each of its days, we know:
  // isStart = prev day not in job.dates, isEnd = next day not in job.dates
  const getJobDayInfo = (job, d) => {
    const dateStr = ds(d);
    if (!job.dates.includes(dateStr)) return null;
    const prevDs = ds(d - 1);
    const nextDs = ds(d + 1);
    const isStart = !job.dates.includes(prevDs);
    const isEnd = !job.dates.includes(nextDs);
    return { isStart, isEnd };
  };

  // The calendar is 7 columns. Each row of 7 days renders:
  // - day numbers row
  // - one bar row per lane (up to maxLane+1)
  const rows = [];
  for (let r = 0; r < cells.length / 7; r++) {
    rows.push(cells.slice(r * 7, r * 7 + 7));
  }

  const COL_W = `${100/7}%`;

  return (
    <div style={S.card}>
      {/* Month nav */}
      <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
        <button style={{ ...S.btn("ghost"), padding: "4px 10px", fontSize: 16 }}
          onClick={() => setCalMonth(p => { const d = new Date(p.year, p.month - 1); return { year: d.getFullYear(), month: d.getMonth() }; })}>‹</button>
        <span style={{ flex: 1, textAlign: "center", fontWeight: 700, fontSize: 14, color: "#e8e4dc" }}>{monthName}</span>
        <button style={{ ...S.btn("ghost"), padding: "4px 10px", fontSize: 16 }}
          onClick={() => setCalMonth(p => { const d = new Date(p.year, p.month + 1); return { year: d.getFullYear(), month: d.getMonth() }; })}>›</button>
      </div>

      {/* Day headers */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
        {["S","M","T","W","T","F","S"].map((d, i) => (
          <div key={i} style={{ textAlign: "center", fontSize: 10, fontWeight: 700, color: "#555", paddingBottom: 6 }}>{d}</div>
        ))}
      </div>

      {/* Rows */}
      {rows.map((rowCells, ri) => (
        <div key={ri}>
          {/* Day number row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
            {rowCells.map((d, ci) => {
              if (!d) return <div key={"e"+ci} style={{ height: 28 }} />;
              const dateStr = ds(d);
              const isToday = dateStr === todayStr;
              const hasJobs = (jobsOnDay[d] || []).length > 0;
              return (
                <div key={d} style={{ height: 28, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                    background: isToday ? "#e8b84b" : "transparent",
                    fontSize: 12, fontWeight: isToday ? 800 : hasJobs ? 600 : 400,
                    color: isToday ? "#0f1117" : hasJobs ? "#e8e4dc" : "#555",
                  }}>{d}</div>
                </div>
              );
            })}
          </div>

          {/* Bar rows — one per lane */}
          {Array.from({ length: maxLane + 1 }).map((_, lane) => {
            // Find jobs in this lane that have days in this row
            const laneJobs = activeJobs.filter(j => jobLane[j.id] === lane);
            const hasAnything = laneJobs.some(j => rowCells.some(d => d && getJobDayInfo(j, d)));
            if (!hasAnything) return null;

            return (
              <div key={lane} style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", marginBottom: 2, height: 20 }}>
                {rowCells.map((d, ci) => {
                  if (!d) return <div key={"e"+ci} />;
                  // Find a job in this lane active on this day
                  const job = laneJobs.find(j => getJobDayInfo(j, d));
                  if (!job) return <div key={d} />;
                  const info = getJobDayInfo(job, d);
                  const col = STATUS_COLORS[job.status] || STATUS_COLORS.Pencil;

                  // Check if next col (same row) also has this job, to determine right-side rounding
                  const nextD = rowCells[ci + 1];
                  const continuesRight = nextD && getJobDayInfo(job, nextD) && !info.isEnd;
                  const prevD = ci > 0 ? rowCells[ci - 1] : null;
                  const continuesLeft = prevD && getJobDayInfo(job, prevD) && !info.isStart;

                  const borderRadius = `${info.isStart ? 6 : 0}px ${info.isEnd || !continuesRight ? 6 : 0}px ${info.isEnd || !continuesRight ? 6 : 0}px ${info.isStart ? 6 : 0}px`;

                  return (
                    <div key={d}
                      onClick={() => setDetailJob(job)}
                      style={{
                        height: 18, background: col.bg, borderTop: `1.5px solid ${col.border}`, borderBottom: `1.5px solid ${col.border}`,
                        borderLeft: info.isStart ? `1.5px solid ${col.border}` : "none",
                        borderRight: info.isEnd || !continuesRight ? `1.5px solid ${col.border}` : "none",
                        borderRadius,
                        cursor: "pointer",
                        overflow: "hidden",
                        display: "flex", alignItems: "center",
                        paddingLeft: info.isStart ? 4 : 0,
                      }}>
                      {info.isStart && (
                        <span style={{ fontSize: 9, fontWeight: 700, color: col.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", lineHeight: 1 }}>
                          {job.name}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}

          {/* Spacer between calendar rows */}
          <div style={{ height: 4 }} />
        </div>
      ))}

      {/* Legend */}
      <div style={{ display: "flex", gap: 14, marginTop: 10, paddingTop: 10, borderTop: "1px solid #252830" }}>
        {Object.entries(STATUS_COLORS).map(([s, c]) => (
          <div key={s} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{ width: 18, height: 6, borderRadius: 3, background: c.bg, border: `1px solid ${c.border}` }} />
            <span style={{ fontSize: 10, color: "#666" }}>{s}</span>
          </div>
        ))}
      </div>

      {/* Job detail modal */}
      {detailJob && <JobDetailModal job={detailJob} equipment={equipment} onClose={() => setDetailJob(null)} />}
    </div>
  );
}

// ─── DASHBOARD PAGE ───────────────────────────────────────────────────────────
function DashboardPage({ jobs, setJobs, equipment, checkouts, setCheckouts, productionCompanies, employees, equipmentRequests, setEquipmentRequests, adminRequests, approveAdminRequest, rejectAdminRequest, pendingAdminCount, lineGroupId, lineNotifyMuted }) {
  const t = useT();
  const todayStr = today();
  const todayJobs = jobs.filter(j => j.dates.includes(todayStr));
  const confirmedJobs = jobs.filter(j => j.status === "Confirmed");
  const pencilJobs = jobs.filter(j => j.status === "Pencil");
  const avList = calcAvailable(equipment, jobs, checkouts, todayStr);
  const pendingRequests = (equipmentRequests || []).filter(r => r.status === "pending");

  // Gear that was picked up but never returned — grouped by job
  const stillOutItems = (() => {
    const results = [];
    jobs.forEach(job => {
      const jobCheckouts = checkouts.filter(c => c.jobId === job.id);
      const pickedIds = new Set(jobCheckouts.filter(c => c.type === "pick" || c.type === "checkout").map(c => c.eqId));
      const returnedIds = new Set(jobCheckouts.filter(c => c.type === "return").map(c => c.eqId));
      const outIds = [...pickedIds].filter(id => !returnedIds.has(id));
      const lastJobDate = job.dates.length ? job.dates[job.dates.length - 1] : null;
      const overdue = lastJobDate ? lastJobDate < todayStr : false;
      outIds.forEach(eqId => {
        const eq = equipment.find(e => e.id === eqId);
        const pickEvent = jobCheckouts.filter(c => (c.type === "pick" || c.type === "checkout") && c.eqId === eqId).sort((a, b) => b.ts - a.ts)[0];
        if (eq) results.push({ job, eq, pickedBy: pickEvent?.employeeName || "—", pickedAt: pickEvent?.ts || 0, overdue });
      });
    });
    return results.sort((a, b) => (b.overdue ? 1 : 0) - (a.overdue ? 1 : 0) || b.pickedAt - a.pickedAt);
  })();

  const [expandedStat, setExpandedStat] = useState(null);
  const [dashJobModal, setDashJobModal] = useState(null);
  const [dashReqModal, setDashReqModal] = useState(null);
  const [expandedActivityKeys, setExpandedActivityKeys] = useState(new Set());
  const [expandedApproval, setExpandedApproval] = useState(new Set());
  const [approvalFilter, setApprovalFilter] = useState("pending"); // pending | resolved | all
  const toggleApproval = (key) => setExpandedApproval(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const fmtReqTime = (x) => x ? new Date(x).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
  const activityGroups = (() => {
    const map = {};
    checkouts.forEach(c => {
      const key = c.jobId || (c.requestId ? `req_${c.requestId}` : `emp_${c.employeeId}_${c.jobName}`);
      if (!map[key]) map[key] = { key, label: c.jobName || "Unknown", items: [], empNames: new Set(), latestTs: 0 };
      map[key].items.push(c);
      if (c.employeeName) map[key].empNames.add(c.employeeName);
      if (c.ts > map[key].latestTs) map[key].latestTs = c.ts;
    });
    return Object.values(map).sort((a, b) => b.latestTs - a.latestTs).slice(0, 10);
  })();
  const toggleActivity = (key) => setExpandedActivityKeys(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const approveRequest = (req) => {
    setEquipmentRequests(p => p.map(r => r.id === req.id ? { ...r, status: "approved", resolvedAt: Date.now() } : r));
    const jobName = req.purpose === "work" ? (req.jobName || "Work") : "Personal / Practice";
    const items = req.items || [{ eqId: req.eqId, eqName: req.eqName, qty: req.qty }];
    const now = Date.now();
    setCheckouts(p => [...p, ...items.map((item, i) => ({ id: "co" + now + i, jobId: null, jobName, eqId: item.eqId, qty: item.qty, employeeId: req.employeeId, employeeName: req.employeeName, type: "pick", ts: now, photo: null, location: null, requestId: req.id }))]);
    setDashReqModal(null);
  };
  const denyRequest = (req) => {
    setEquipmentRequests(p => p.map(r => r.id === req.id ? { ...r, status: "denied", resolvedAt: Date.now() } : r));
    setDashReqModal(null);
  };

  const statusColor = { Confirmed: "green", Pencil: "gray", Cancelled: "red" };
  const locationColor = { "Local (Bangkok)": "blue", "Out of Town": "amber", "Overseas": "red" };

  const statSections = {
    today:     { jobs: todayJobs,     label: t("dashTodayJobsLabel"),    color: "#e8b84b", badge: "amber" },
    confirmed: { jobs: confirmedJobs, label: t("dashConfirmedLabel"),  color: "#34d399", badge: "green" },
    pencil:    { jobs: pencilJobs,    label: t("dashPencilLabel"),     color: "#94a3b8", badge: "gray"  },
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h1 style={{ ...S.pageTitle, marginBottom: 2 }}>{t("dashOverview")}</h1>
        <p style={{ ...S.pageSubtitle, marginBottom: 0 }}>{new Date().toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}</p>
      </div>

      {/* Stats row — 3 tappable cards */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
        {Object.entries(statSections).map(([key, s]) => {
          const isOpen = expandedStat === key;
          return (
            <div key={key}
              onClick={() => setExpandedStat(isOpen ? null : key)}
              style={{ ...S.card, textAlign: "center", padding: "14px 8px", cursor: "pointer",
                border: isOpen ? `1px solid ${s.color}` : "1px solid #252830",
                background: isOpen ? `${s.color}12` : "#1a1e27",
                transition: "all 0.15s" }}>
              <p style={{ margin: 0, fontSize: 28, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.jobs.length}</p>
              <p style={{ margin: "5px 0 0", fontSize: 9, color: isOpen ? s.color : "#666", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", lineHeight: 1.3 }}>{s.label}</p>
              <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke={isOpen ? s.color : "#444"} strokeWidth={2.5} strokeLinecap="round" style={{ marginTop: 6, transition: "transform 0.15s", transform: isOpen ? "rotate(180deg)" : "none" }}>
                <path d="M6 9l6 6 6-6" />
              </svg>
            </div>
          );
        })}
      </div>

      {/* Expanded job list under the stat cards */}
      {expandedStat && (() => {
        const s = statSections[expandedStat];
        return (
          <div style={{ ...S.card, padding: "14px 16px", marginTop: -6, borderTop: `2px solid ${s.color}`, borderRadius: "0 0 10px 10px" }}>
            <p style={{ ...S.sectionTitle, color: s.color, marginBottom: 12 }}>{s.label}</p>
            {s.jobs.length === 0 ? (
              <p style={{ fontSize: 13, color: "#555" }}>{t("dashNoJobsCategory")}</p>
            ) : s.jobs.map((j, i) => (
              <div key={j.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, paddingBottom: i < s.jobs.length - 1 ? 12 : 0, marginBottom: i < s.jobs.length - 1 ? 12 : 0, borderBottom: i < s.jobs.length - 1 ? "1px solid #252830" : "none" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 4 }}>
                    <span style={S.badge(statusColor[j.status] || "gray")}>{j.status}</span>
                    <span style={S.badge(locationColor[j.location] || "gray")}>{j.location}{j.locationCity ? ` · ${j.locationCity}` : ""}</span>
                  </div>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#e8e4dc", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{j.name}</p>
                  <p style={{ margin: "2px 0 0", fontSize: 11, color: "#666" }}>{j.production} · {j.shootTime}</p>
                  <p style={{ margin: "3px 0 0", fontSize: 11, color: "#8a8f9d" }}>
                    {j.dates.length} day{j.dates.length !== 1 ? "s" : ""}
                    {j.dates[0] ? ` · ${formatDate(j.dates[0])}${j.dates.length > 1 ? " →" : ""}` : ""}
                    {j.dates.length > 1 ? ` ${formatDate(j.dates[j.dates.length - 1])}` : ""}
                  </p>
                </div>
                <div style={{ display: "flex", gap: 5, flexShrink: 0, flexDirection: "column", alignItems: "flex-end" }}>
                  {(j.assignedEquipment || []).length > 0 && (
                    <span style={{ ...S.badge("blue") }}>{j.assignedEquipment.length} items</span>
                  )}
                  <button style={{ ...S.btn("ghost"), padding: "4px 8px", fontSize: 11 }} onClick={e => { e.stopPropagation(); setDashJobModal(j); }}>
                    <Icon d={icons.edit} size={12} /> {t("dashEdit")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Calendar */}
      <DashboardCalendar jobs={jobs} equipment={equipment} />

      {/* Equipment status — compact chips */}
      {(() => {
        const out = avList.filter(e => e.taken > 0);
        return (
          <div style={S.card}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: out.length ? 10 : 0, gap: 8 }}>
              <p style={{ ...S.sectionTitle, margin: 0 }}>{t("dashEqOutToday")}</p>
              <span style={{ fontSize: 11, color: "#8a8f9d", flexShrink: 0 }}>{out.length} of {equipment.length} out</span>
            </div>
            {out.length === 0
              ? <p style={{ color: "#34d399", fontSize: 13, margin: 0 }}>{t("dashAllAvail")}</p>
              : <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {out.map(eq => (
                    <span key={eq.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: 16, background: "#0f1117", border: `1px solid ${eq.available === 0 ? "rgba(248,113,113,0.45)" : "#2e3340"}`, fontSize: 12, maxWidth: "100%" }}>
                      <span style={{ fontWeight: 600, color: "#e8e4dc", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 150 }}>{eq.name}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: eq.available === 0 ? "#f87171" : "#e8b84b", flexShrink: 0 }}>{eq.taken}/{eq.total}</span>
                    </span>
                  ))}
                </div>}
          </div>
        );
      })()}

      {/* Still Out */}
      <div style={{ ...S.card, border: stillOutItems.some(i => i.overdue) ? "1px solid rgba(248,113,113,0.35)" : "1px solid #252830" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: stillOutItems.length ? 10 : 0 }}>
          <p style={{ ...S.sectionTitle, margin: 0 }}>{t("dashStillOut")}</p>
          {stillOutItems.length > 0 && (
            <span style={{ fontSize: 11, color: "#8a8f9d" }}>{stillOutItems.length} item{stillOutItems.length !== 1 ? "s" : ""}</span>
          )}
        </div>
        {stillOutItems.length === 0
          ? <p style={{ color: "#34d399", fontSize: 13, margin: 0 }}>{t("dashStillOutEmpty")}</p>
          : stillOutItems.map((item, idx, arr) => {
              const ago = (() => {
                const diffMs = Date.now() - item.pickedAt;
                const h = Math.floor(diffMs / 3600000);
                const d = Math.floor(diffMs / 86400000);
                return d > 0 ? `${d}d ago` : h > 0 ? `${h}h ago` : "just now";
              })();
              return (
                <div key={`${item.job.id}-${item.eq.id}`} style={{ display: "flex", alignItems: "center", gap: 10, paddingBottom: idx < arr.length - 1 ? 10 : 0, marginBottom: idx < arr.length - 1 ? 10 : 0, borderBottom: idx < arr.length - 1 ? "1px solid #252830" : "none" }}>
                  <span style={{ ...S.badge(item.overdue ? "red" : "amber"), flexShrink: 0 }}>{t(item.overdue ? "dashStillOutOverdue" : "dashStillOutActive")}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: "#e8e4dc", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.eq.name}</div>
                    <div style={{ fontSize: 11, color: "#8a8f9d", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.job.name} · {item.pickedBy}</div>
                  </div>
                  <span style={{ fontSize: 11, color: item.overdue ? "#f87171" : "#6b7280", flexShrink: 0 }}>{ago}</span>
                </div>
              );
            })
        }
      </div>

      {/* Recent activity */}
      <div style={S.card}>
        <p style={S.sectionTitle}>{t("dashRecentActivity")}</p>
        {activityGroups.length === 0 ? (
          <p style={{ color: "#666", fontSize: 13 }}>{t("dashNoActivity")}</p>
        ) : activityGroups.map((group, i, arr) => {
          const isExpanded = expandedActivityKeys.has(group.key);
          const sortedItems = [...group.items].sort((a, b) => b.ts - a.ts);
          const latestType = sortedItems[0]?.type;
          const isPick = latestType === "pick" || latestType === "checkout";
          const empNames = [...group.empNames].join(", ");
          return (
            <div key={group.key} style={{ paddingBottom: i < arr.length - 1 ? 10 : 0, marginBottom: i < arr.length - 1 ? 10 : 0, borderBottom: i < arr.length - 1 ? "1px solid #252830" : "none" }}>
              <div onClick={() => toggleActivity(group.key)} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                <span style={S.badge(isPick ? "amber" : "green")}>{isPick ? t("dashPicked") : t("dashReturned")}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{group.label}</p>
                  <p style={{ margin: "2px 0 0", fontSize: 11, color: "#666" }}>{empNames} · {formatDateTime(group.latestTs)}</p>
                </div>
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth={2} strokeLinecap="round" style={{ flexShrink: 0, transform: isExpanded ? "rotate(90deg)" : "none", transition: "transform .15s" }}><path d="M9 18l6-6-6-6" /></svg>
              </div>
              {isExpanded && (
                <div style={{ marginTop: 8, paddingLeft: 10, borderLeft: "2px solid #252830" }}>
                  {sortedItems.map((c, ci) => {
                    const eq = equipment.find(e => e.id === c.eqId);
                    const cIsPick = c.type === "pick" || c.type === "checkout";
                    return (
                      <div key={ci} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: ci < sortedItems.length - 1 ? "1px solid #1e2230" : "none" }}>
                        <span style={S.badge(cIsPick ? "amber" : "green")}>{cIsPick ? t("pickEvt") : t("returnEvt")}</span>
                        <div style={{ flex: 1 }}>
                          <p style={{ margin: 0, fontSize: 12, fontWeight: 600 }}>{eq?.name || "—"} ×{c.qty}</p>
                          <p style={{ margin: 0, fontSize: 10, color: "#666" }}>{c.employeeName} · {formatDateTime(c.ts)}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Floating + FAB */}
      <button
        onClick={() => setDashJobModal("new")}
        style={{
          position: "fixed", bottom: 78, right: 20, width: 52, height: 52,
          borderRadius: "50%", background: "var(--btn-primary-bg,#e8b84b)", color: "var(--btn-primary-color,#0f1117)",
          border: "none", fontSize: 28, fontWeight: 300, cursor: "pointer",
          boxShadow: "0 4px 16px rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 90,
        }}
        title="New Job"
      >+</button>

      {/* Gear Requests */}
      <div style={S.card}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <p style={{ ...S.sectionTitle, margin: 0 }}>
            {t("dashGearRequests")}
            {pendingRequests.length > 0 && <span style={{ ...S.badge("amber"), marginLeft: 8 }}>{pendingRequests.length} {t("dashPending")}</span>}
          </p>
        </div>
        {(equipmentRequests || []).length === 0 ? (
          <p style={{ fontSize: 13, color: "#555" }}>{t("dashNoRequests")}</p>
        ) : [...(equipmentRequests || [])].reverse().slice(0, 10).map((req, i, arr) => {
          const itemLabel = req.items
            ? req.items.map(it => { const e = equipment.find(x => x.id === it.eqId); return `${e?.name || it.eqName}${it.qty > 1 ? ` ×${it.qty}` : ""}`; }).join(", ")
            : `${equipment.find(e => e.id === req.eqId)?.name || req.eqName} ×${req.qty}`;
          const dateLabel = req.useDates?.length > 0 ? req.useDates.map(formatDate).join(", ") : req.useDate ? formatDate(req.useDate) : null;
          return (
            <div key={req.id}
              onClick={() => setDashReqModal(req)}
              style={{ display: "flex", alignItems: "flex-start", gap: 10, paddingBottom: i < arr.length - 1 ? 12 : 0, marginBottom: i < arr.length - 1 ? 12 : 0, borderBottom: i < arr.length - 1 ? "1px solid #252830" : "none", cursor: "pointer" }}>
              <span style={S.badge(req.status === "approved" ? "green" : req.status === "denied" ? "red" : "amber")}>{req.status}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#e8e4dc" }}>{req.employeeName}</p>
                <p style={{ margin: "2px 0 0", fontSize: 12, color: "#8a8f9d", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{itemLabel}</p>
                {dateLabel && <p style={{ margin: "2px 0 0", fontSize: 11, color: "#666" }}>{dateLabel}</p>}
              </div>
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#444" strokeWidth={2} strokeLinecap="round" style={{ flexShrink: 0, marginTop: 2 }}><path d="M9 18l6-6-6-6" /></svg>
            </div>
          );
        })}
      </div>

      {/* Request Detail Modal */}
      {dashReqModal && (() => {
        const req = dashReqModal;
        const items = req.items || [{ eqId: req.eqId, eqName: req.eqName, qty: req.qty }];
        const dateLabel = req.useDates?.length > 0 ? req.useDates.map(formatDate).join(", ") : req.useDate ? formatDate(req.useDate) : null;
        return (
          <Modal title={t("dashGearReqDetail")} onClose={() => setDashReqModal(null)}>
            <div style={S.col}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={S.badge(req.status === "approved" ? "green" : req.status === "denied" ? "red" : "amber")}>{req.status}</span>
                <span style={{ fontWeight: 700, fontSize: 15 }}>{req.employeeName}</span>
              </div>

              <div style={{ borderTop: "1px solid #252830", paddingTop: 12 }}>
                <p style={{ ...S.label, marginBottom: 8 }}>{t("dashRequestedItems")}</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {items.map((item, i) => {
                    const eq = equipment.find(e => e.id === item.eqId);
                    return (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "#0f1117", borderRadius: 8, border: "1px solid #252830" }}>
                        {eq?.photo
                          ? <img src={eq.photo} alt="" style={{ width: 36, height: 32, objectFit: "cover", borderRadius: 5, flexShrink: 0 }} />
                          : <div style={{ width: 36, height: 32, borderRadius: 5, background: "#252830", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon d={icons.camera} size={12} color="#444" /></div>
                        }
                        <div style={{ flex: 1 }}>
                          <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{eq?.name || item.eqName}</p>
                          {eq?.category && <p style={{ margin: 0, fontSize: 11, color: "#666" }}>{eq.category}</p>}
                        </div>
                        <span style={{ ...S.badge("blue"), flexShrink: 0 }}>×{item.qty}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {dateLabel && (
                <div>
                  <p style={S.label}>{req.useDates?.length > 1 ? t("dashDatesNeeded") : t("dashDateNeeded")}</p>
                  <p style={{ fontSize: 13, color: "#e8e4dc", margin: 0 }}>{dateLabel}</p>
                </div>
              )}

              <div>
                <p style={S.label}>{t("dashPurpose")}</p>
                <p style={{ fontSize: 13, color: "#e8e4dc", margin: 0 }}>
                  {req.purpose === "work" ? `${t("teamWork")} — ${req.jobName || ""}${req.productionName ? ` (${req.productionName})` : ""}` : t("purposePractice")}
                </p>
              </div>

              {req.reason && (
                <div>
                  <p style={S.label}>{t("dashReason")}</p>
                  <p style={{ fontSize: 13, color: "#8a8f9d", margin: 0 }}>{req.reason}</p>
                </div>
              )}

              <p style={{ fontSize: 11, color: "#444", margin: 0 }}>Requested {new Date(req.requestedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</p>

              {req.status === "pending" && (
                <div style={{ display: "flex", gap: 10, paddingTop: 4 }}>
                  <button style={{ ...S.btn("danger"), flex: 1 }} onClick={() => denyRequest(req)}>{t("dashDeny")}</button>
                  <button style={{ ...S.btn("success"), flex: 1 }} onClick={() => approveRequest(req)}>{t("dashApprove")}</button>
                </div>
              )}
              {req.status === "approved" && (() => {
                const reqCheckouts = checkouts.filter(c => c.requestId === req.id);
                if (reqCheckouts.length === 0) return null;
                const pickedIds = new Set(reqCheckouts.filter(c => c.type === "pick" || c.type === "checkout").map(c => c.eqId));
                const returnedIds = new Set(reqCheckouts.filter(c => c.type === "return").map(c => c.eqId));
                return (
                  <div style={{ borderTop: "1px solid #252830", paddingTop: 12 }}>
                    <p style={{ ...S.label, marginBottom: 8 }}>{t("dashCheckoutStatus")}</p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {items.map((item, i) => {
                        const eq = equipment.find(e => e.id === item.eqId);
                        const returned = returnedIds.has(item.eqId);
                        const picked = pickedIds.has(item.eqId);
                        return (
                          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", background: "#0f1117", borderRadius: 8, border: "1px solid #252830" }}>
                            <div style={{ flex: 1 }}>
                              <p style={{ margin: 0, fontSize: 12, fontWeight: 600 }}>{eq?.name || item.eqName} ×{item.qty}</p>
                            </div>
                            <span style={S.badge(returned ? "green" : picked ? "amber" : "gray")}>{returned ? "RETURNED" : picked ? "OUT" : "NOT YET"}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
              {req.status !== "pending" && (
                <button style={{ ...S.btn("ghost"), width: "100%" }} onClick={() => setDashReqModal(null)}>{t("dashClose")}</button>
              )}
            </div>
          </Modal>
        );
      })()}

      {/* Admin Approvals — dedicated, filterable history */}
      {(() => {
        const allReqs = adminRequests || [];
        const pendingCount = allReqs.filter(r => r.status === "pending").length;
        const isResolved = (r) => r.status === "approved" || r.status === "rejected";
        const filtered = allReqs.filter(r => approvalFilter === "all" ? true : approvalFilter === "pending" ? r.status === "pending" : isResolved(r));
        const typeLabel = { "production-house": t("dashTypeProductionHouse"), "equipment": t("dashTypeEquipment"), "member-register": t("dashTypeNewMember") };
        // Geo-return requests consolidate into one collapsible row per job; others stay individual.
        const geo = filtered.filter(r => r.type === "geo-return");
        const others = filtered.filter(r => r.type !== "geo-return");
        const geoGroups = {};
        geo.forEach(r => {
          const key = "geo_" + (r.jobId || r.jobName || r.id);
          if (!geoGroups[key]) geoGroups[key] = { key, jobName: r.jobName || "—", employeeName: r.employeeName, items: [], latest: 0 };
          geoGroups[key].items.push(r);
          const ts = new Date(r.submittedAt || 0).getTime();
          if (ts > geoGroups[key].latest) geoGroups[key].latest = ts;
        });
        const rows = [
          ...Object.values(geoGroups).map(g => ({ ...g, kind: "geo-group", sortTs: g.latest })),
          ...others.map(r => ({ kind: "single", req: r, sortTs: new Date(r.submittedAt || 0).getTime() })),
        ].sort((a, b) => b.sortTs - a.sortTs).slice(0, 50);
        const tabs = [{ k: "pending", l: t("dashPendingFilter") }, { k: "resolved", l: t("dashResolvedFilter") }, { k: "all", l: t("dashAllFilter") }];
        return (
          <div style={S.card}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
              <p style={{ ...S.sectionTitle, margin: 0 }}>
                {t("dashApprovals")}
                {pendingCount > 0 && <span style={{ ...S.badge("amber"), marginLeft: 8 }}>{pendingCount} {t("dashPending")}</span>}
              </p>
              <div style={{ display: "flex", gap: 4, background: "#0f1117", padding: 3, borderRadius: 8, border: "1px solid #252830" }}>
                {tabs.map(tb => (
                  <button key={tb.k} onClick={() => setApprovalFilter(tb.k)} style={{ padding: "5px 12px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 700, background: approvalFilter === tb.k ? "#e8b84b" : "transparent", color: approvalFilter === tb.k ? "#0f1117" : "#8a8f9d" }}>{tb.l}</button>
                ))}
              </div>
            </div>
            {rows.length === 0 && (
              <p style={{ fontSize: 13, color: "#666", margin: 0 }}>
                {approvalFilter === "pending" ? t("dashNoPending") : approvalFilter === "resolved" ? t("dashNoResolved") : t("dashNoAll")}
              </p>
            )}
            <div style={{ maxHeight: 520, overflowY: rows.length > 6 ? "auto" : "visible", margin: "0 -4px", padding: "0 4px" }}>
            {rows.map((row, i, arr) => {
              const divider = { paddingBottom: i < arr.length - 1 ? 12 : 0, marginBottom: i < arr.length - 1 ? 12 : 0, borderBottom: i < arr.length - 1 ? "1px solid #252830" : "none" };
              if (row.kind === "geo-group") {
                const g = row;
                const open = expandedApproval.has(g.key);
                const pend = g.items.filter(r => r.status === "pending");
                return (
                  <div key={g.key} style={divider}>
                    <div onClick={() => toggleApproval(g.key)} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                      <span style={S.badge(pend.length ? "amber" : "green")}>{pend.length ? `${pend.length} ${t("dashPending")}` : t("dashResolved")}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>{g.jobName} <span style={{ color: "#8a8f9d", fontWeight: 500 }}>· Return</span></p>
                        <p style={{ margin: "2px 0 0", fontSize: 11, color: "#8a8f9d" }}>{g.items.length} {t("dashItems")}{g.employeeName ? ` · ${t("dashByLabel")} ${g.employeeName}` : ""}</p>
                      </div>
                      {pend.length > 0 && (
                        <button style={{ ...S.btn("success"), padding: "4px 10px", fontSize: 11, flexShrink: 0 }} onClick={(e) => { e.stopPropagation(); pend.forEach(r => approveAdminRequest(r)); }}>{t("dashApproveAll")}</button>
                      )}
                      <span style={{ color: "#666", fontSize: 14, flexShrink: 0, transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }}>›</span>
                    </div>
                    {open && (
                      <div style={{ marginTop: 10, paddingLeft: 10, borderLeft: "2px solid #252830", display: "flex", flexDirection: "column", gap: 12 }}>
                        {g.items.map(req => (
                          <div key={req.id} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                            <span style={S.badge(req.status === "approved" ? "green" : req.status === "rejected" ? "red" : "amber")}>{req.status}</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <p style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>{req.eqName || req.eqId}</p>
                              <p style={{ margin: "2px 0 0", fontSize: 11, color: req.distance !== null ? (req.distance > 50 ? "#f87171" : "#34d399") : "#888" }}>
                                {req.distance !== null ? `📍 ${req.distance}${t("dashGpsFrom")}` : `📍 ${t("dashGpsUnavail")}`}
                              </p>
                              <p style={{ margin: "3px 0 0", fontSize: 10, color: "#555" }}>Requested {fmtReqTime(req.submittedAt)}{req.resolvedAt ? ` · ${req.status} ${fmtReqTime(req.resolvedAt)}` : ""}</p>
                              {req.photo && <img src={req.photo} alt="preview" style={{ width: "100%", maxWidth: 260, height: "auto", borderRadius: 5, marginTop: 6, border: "1px solid #2e3340" }} />}
                              {req.status === "pending" && (
                                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                                  <button style={{ ...S.btn("danger"), padding: "5px 12px", fontSize: 12 }} onClick={() => rejectAdminRequest(req)}>{t("dashReject")}</button>
                                  <button style={{ ...S.btn("success"), padding: "5px 12px", fontSize: 12 }} onClick={() => approveAdminRequest(req)}>{t("dashApprove")}</button>
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              }
              const req = row.req;
              return (
                <div key={req.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, ...divider }}>
                  <span style={S.badge(req.status === "approved" ? "green" : req.status === "rejected" ? "red" : "amber")}>{req.status}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>{req.name}</p>
                    <p style={{ margin: "2px 0 0", fontSize: 11, color: "#8a8f9d" }}>
                      {typeLabel[req.type] || req.type}
                      {req.employeeName ? ` · ${t("dashByLabel")} ${req.employeeName}` : ` · ${t("dashGuest")}`}
                      {req.address ? ` · ${req.address}` : ""}
                      {req.category ? ` · ${req.category}` : ""}
                      {req.total && req.type === "equipment" ? ` · ×${req.total}` : ""}
                      {req.requestedPin && req.type === "member-register" ? ` · PIN: ${req.requestedPin}` : ""}
                    </p>
                    <p style={{ margin: "3px 0 0", fontSize: 10, color: "#555" }}>Requested {fmtReqTime(req.submittedAt)}{req.resolvedAt ? ` · ${req.status} ${fmtReqTime(req.resolvedAt)}` : ""}</p>
                    {req.photo && <img src={req.photo} alt="preview" style={{ width: 60, maxWidth: 60, height: 60, objectFit: "cover", borderRadius: 5, marginTop: 6, border: "1px solid #2e3340" }} />}
                    {req.status === "pending" && (
                      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                        <button style={{ ...S.btn("danger"), padding: "5px 12px", fontSize: 12 }} onClick={() => rejectAdminRequest(req)}>{t("dashReject")}</button>
                        <button style={{ ...S.btn("success"), padding: "5px 12px", fontSize: 12 }} onClick={() => approveAdminRequest(req)}>{t("dashApprove")}</button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            </div>
          </div>
        );
      })()}

      {dashJobModal && (
        <JobFormModal
          editTarget={dashJobModal === "new" ? null : dashJobModal}
          jobs={jobs}
          setJobs={setJobs}
          productionCompanies={productionCompanies}
          employees={employees}
          lineGroupId={lineGroupId}
          lineNotifyMuted={lineNotifyMuted}
          onClose={() => setDashJobModal(null)}
        />
      )}
    </div>
  );
}

// ─── STEP BAR (Pick → Shoot → Return) ────────────────────────────────────────
function StepBar({ currentStep }) {
  const steps = ["Pick Up", "Shoot", "Return"];
  return (
    <div style={{ display: "flex", alignItems: "center", background: "#161920", borderRadius: 10, padding: "12px 16px", marginBottom: 20 }}>
      {steps.map((label, i) => {
        const done = i < currentStep;
        const active = i === currentStep;
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", flex: 1 }}>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
              <div style={{ width: 26, height: 26, borderRadius: "50%", background: done ? "#34d399" : active ? "#e8b84b" : "#252830", display: "flex", alignItems: "center", justifyContent: "center", border: `2px solid ${done ? "#34d399" : active ? "#e8b84b" : "#3a4050"}` }}>
                {done
                  ? <Icon d={icons.check} size={12} color="#0f1117" strokeW={3} />
                  : <span style={{ fontSize: 10, fontWeight: 800, color: active ? "#0f1117" : "#555" }}>{i + 1}</span>}
              </div>
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: done ? "#34d399" : active ? "#e8b84b" : "#444" }}>{label}</span>
            </div>
            {i < 2 && <div style={{ flex: 0, width: 20, height: 2, background: done ? "#34d399" : "#252830", marginBottom: 18, flexShrink: 0 }} />}
          </div>
        );
      })}
    </div>
  );
}

// ─── EMPLOYEE VIEW ────────────────────────────────────────────────────────────
function EmployeeView({ employee, jobs, equipment, checkouts, setCheckouts, reports, setReports, invoices, setInvoices, productionCompanies, companyName, setLang, onLogout, setEmployees, equipmentRequests, setEquipmentRequests, adminRequests, setAdminRequests, lineGroupId, lineNotifyMuted, kpiConfig, kpiEvents, punishments, verificationConfig, saveNow, offlineMode, invoicePresets }) {
  const t = useT();
  const lang = useContext(LangCtx);
  const [tab, setTab] = useState("today"); // today | calendar | profile | gear | invoice
  const [showReportModal, setShowReportModal] = useState(false);
  const [showGearRequest, setShowGearRequest] = useState(false);
  const [gearReqForm, setGearReqForm] = useState({ useDates: [], purpose: "practice", productionName: "", jobName: "", reason: "", selectedGear: {} });
  const [gearReqCalMonth, setGearReqCalMonth] = useState(() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() }; });
  const [pinChangeForm, setPinChangeForm] = useState({ newPin: "", confirmPin: "" });
  const [pinChangeMsg, setPinChangeMsg] = useState(null);
  const [selectedJob, setSelectedJob] = useState(null);
  const [checkedItems, setCheckedItems] = useState({});
  const [phase, setPhase] = useState("select");
  const [photoMode, setPhotoMode] = useState("pick"); // "pick" | "return"
  const [photoItems, setPhotoItems] = useState([]); // ae list for current photo session
  const [currentItemIdx, setCurrentItemIdx] = useState(0);
  const [itemPhotos, setItemPhotos] = useState({}); // { [eqId]: { dataUrl, location } }
  const [geoFailItems, setGeoFailItems] = useState([]); // items sent to admin for geo mismatch
  const [captureAe, setCaptureAe] = useState(null); // item currently being photographed (per-item flow)
  const [itemResults, setItemResults] = useState({}); // { [eqId]: "ok" | "pending" } this session
  const [expandedActivity, setExpandedActivity] = useState({}); // recent-activity group expand state
  const [coSaveState, setCoSaveState] = useState(null); // checkout/return save: null | "saving" | "saved" | { error }
  const [profilePhoto, setProfilePhoto] = useState(null);
  const [profileInfo, setProfileInfo] = useState({ firstName: "", lastName: "", nickname: "", phone: "", email: "", lineId: "", legalAddress: "", bankName: "", bankAccount: "", accountName: "", invoicePrefix: "" });
  const [idCard, setIdCard] = useState(null);
  const [promptPayQR, setPromptPayQR] = useState(null);
  const [signature, setSignature] = useState(null);
  const [positions, setPositions] = useState([]); // [{ id, name, dayRate, hoursPerDay, variableOT, otMultiplier, otTiers }]
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [invoiceModal, setInvoiceModal] = useState(null); // null | { job, existing }
  const [expandedInv, setExpandedInv] = useState(null);
  const [expandedStat, setExpandedStat] = useState(null); // null | "today" | "confirmed" | "pencil"
  const [empDetailJob, setEmpDetailJob] = useState(null);
  const [invFilter, setInvFilter] = useState("all"); // all | Pending | Paid
  const [invSort, setInvSort] = useState("date"); // date | amount
  const [invDocType, setInvDocType] = useState("all"); // all | invoice | quotation | receipt
  const [invSending, setInvSending] = useState(null); // invoice id currently being sent
  const [revPeriod, setRevPeriod] = useState("all"); // all | year | custom
  const [revYear, setRevYear] = useState(new Date().getFullYear().toString());
  const [showAdminReqModal, setShowAdminReqModal] = useState(null); // null | "production-house" | "equipment"
  const [adminReqForm, setAdminReqForm] = useState({});
  const [adminReqMsg, setAdminReqMsg] = useState(null);
  const adminReqPhotoRef = useRef(null);
  const [eqSortBy, setEqSortBy] = useState("name_az");
  const [eqFilterCat, setEqFilterCat] = useState(null);
  const [eqReqCollapsed, setEqReqCollapsed] = useState(true);
  const [revFrom, setRevFrom] = useState("");
  const [revTo, setRevTo] = useState("");
  const profileFileRef = useRef(null);
  const idCardRef = useRef(null);
  const promptPayRef = useRef(null);
  const signatureRef = useRef(null);
  const [profileSaveStatus, setProfileSaveStatus] = useState(null); // null | "saving" | "saved" | "error"
  // scanAe: item currently being QR-scanned (barcode lane)
  const [scanAe, setScanAe] = useState(null);
  // barcodeResults: { [eqId]: "ok" } — barcode lane completions this session (for "both" mode)
  const [barcodeResults, setBarcodeResults] = useState({});

  const todayStr = today();
  const availableJobs = jobs.filter(j => j.status === "Confirmed" && j.dates.includes(todayStr) && (j.assignedEquipment || []).length > 0);
  const myReports = [...(reports || [])].sort((a, b) => b.ts - a.ts);

  // ── Verification mode helpers ────────────────────────────────────────────────
  const vMode = verificationConfig?.mode || "photo";
  const isAdmin = employee.id === "admin";

  // Which lanes this employee can perform for a given job.
  // Admin always gets both. "anyone" means any crew member can do that lane.
  const getMyLanes = (job) => {
    if (isAdmin) return { barcode: true, photo: true };
    const roles = job?.checkoutRoles || { barcode: "anyone", photo: "anyone" };
    const canBarcode = roles.barcode === "anyone" || (Array.isArray(roles.barcode) && roles.barcode.includes(employee.id));
    const canPhoto = roles.photo === "anyone" || (Array.isArray(roles.photo) && roles.photo.includes(employee.id));
    if (vMode === "both") return { barcode: canBarcode, photo: canPhoto };
    if (vMode === "barcode") return { barcode: canBarcode, photo: false };
    if (vMode === "photo") return { barcode: false, photo: canPhoto };
    return { barcode: false, photo: false }; // "none"
  };

  // For "both" mode: check if an item has a barcode_pick/barcode_return event in persisted checkouts
  const hasBarcodeEvent = (job, eqId, isReturn) => {
    if (vMode !== "both") return false;
    const evType = isReturn ? "barcode_return" : "barcode_pick";
    return checkouts.some(c => c.jobId === job?.id && c.eqId === eqId && c.type === evType);
  };
  const hasPhotoEvent = (job, eqId, isReturn) => {
    const evType = isReturn ? "return" : "pick";
    const altType = "checkout";
    return checkouts.some(c => c.jobId === job?.id && c.eqId === eqId && (c.type === evType || c.type === altType));
  };

  // Load full profile from cloud
  useEffect(() => {
    api.getProfile(employee.id).then(d => {
      if (!d) return;
      if (d.photo) setProfilePhoto(d.photo);
      setProfileInfo({ firstName: d.firstName || "", lastName: d.lastName || "", nickname: d.nickname || "", phone: d.phone || "", email: d.email || "", lineId: d.lineId || "", legalAddress: d.legalAddress || "", bankName: d.bankName || "", bankAccount: d.bankAccount || "", accountName: d.accountName || "", invoicePrefix: d.invoicePrefix || "" });
      if (d.idCard) setIdCard(d.idCard);
      if (d.promptPayQR) setPromptPayQR(d.promptPayQR);
      if (d.signature) setSignature(d.signature);
      if (Array.isArray(d.positions)) setPositions(d.positions);
    }).catch(() => {}).finally(() => setProfileLoaded(true));
  }, [employee.id]);

  // ── Profile positions / day rates ──
  const addPosition = () => setPositions(p => p.length >= 5 ? p : [...p, { id: "pos" + Date.now(), name: "", dayRate: "", hoursPerDay: "12", variableOT: false, otMultiplier: "1.5", otTiers: DEFAULT_OT_TIERS.map(t => ({ ...t })) }]);
  const updatePosition = (id, patch) => setPositions(p => p.map(x => x.id === id ? { ...x, ...patch } : x));
  const removePosition = (id) => setPositions(p => p.filter(x => x.id !== id));
  const updateTier = (posId, idx, patch) => setPositions(p => p.map(x => x.id === posId ? { ...x, otTiers: (x.otTiers || []).map((tr, i) => i === idx ? { ...tr, ...patch } : tr) } : x));
  const addTier = (posId) => setPositions(p => p.map(x => x.id === posId ? { ...x, otTiers: [...(x.otTiers || []), { untilHour: "", mult: "" }] } : x));
  const removeTier = (posId, idx) => setPositions(p => p.map(x => x.id === posId ? { ...x, otTiers: (x.otTiers || []).filter((_, i) => i !== idx) } : x));

  const saveProfile = async () => {
    if (!profileLoaded) return;
    setProfileSaveStatus("saving");
    try {
      const cleanPositions = positions
        .filter(p => (p.name || "").trim())
        .map(p => ({ id: p.id, name: p.name.trim(), dayRate: parseFloat(p.dayRate) || 0, hoursPerDay: parseFloat(p.hoursPerDay) || 12, variableOT: !!p.variableOT, otMultiplier: parseFloat(p.otMultiplier) || 1.5, otTiers: (p.otTiers || []).map(tr => ({ untilHour: parseFloat(tr.untilHour) || 0, mult: parseFloat(tr.mult) || 0 })).filter(tr => tr.untilHour > 0 && tr.mult > 0) }));
      const res = await api.putProfile(employee.id, { photo: profilePhoto, ...profileInfo, idCard, promptPayQR, signature, positions: cleanPositions });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      setProfileSaveStatus("saved");
      setTimeout(() => setProfileSaveStatus(null), 3000);
    } catch {
      setProfileSaveStatus("error");
      setTimeout(() => setProfileSaveStatus(null), 3500);
    }
  };

  const handleProfileUpload = (e) => {
    const f = e.target.files[0]; if (!f) return;
    compressImage(f, { maxDim: 800, quality: 0.75 }).then(d => d && setProfilePhoto(d));
  };

  const handleDocUpload = (setter, opts) => (e) => {
    const f = e.target.files[0]; if (!f) return;
    compressImage(f, opts).then(d => d && setter(d));
  };

  const getJobCheckoutState = (job) => {
    const mode = job.checkoutMode || "span";
    const jobCheckouts = checkouts.filter(c => c.jobId === job.id);
    const relevant = mode === "daily"
      ? jobCheckouts.filter(c => new Intl.DateTimeFormat("en-CA", { timeZone: APP_TZ }).format(new Date(c.ts)) === todayStr)
      : jobCheckouts;
    const assignedIds = (job.assignedEquipment || []).map(ae => ae.eqId);
    const pickedIds = new Set(relevant.filter(c => c.type === "pick" || c.type === "checkout").map(c => c.eqId));
    const returnedIds = new Set(relevant.filter(c => c.type === "return").map(c => c.eqId));
    const allPicked = assignedIds.every(id => pickedIds.has(id));
    const allReturned = assignedIds.every(id => returnedIds.has(id));
    return { allPicked, allReturned, pickedIds, returnedIds };
  };

  const selectJob = (job, forceReturn) => {
    setSelectedJob(job);
    const { allPicked } = getJobCheckoutState(job);
    setPhase(forceReturn ? "return" : (allPicked ? "return" : "pick"));
    setItemResults({});
    setBarcodeResults({});
    setCaptureAe(null);
    setScanAe(null);
  };

  // Commit ONE item's photo/none lane. dataUrl & loc null when vMode is "none".
  const commitItem = (ae, dataUrl, loc) => {
    const now = Date.now();
    const eq = equipment.find(e => e.id === ae.eqId);
    if (phase === "pick") {
      setCheckouts(p => [...p, { id: "co" + now + ae.eqId, jobId: selectedJob.id, jobName: selectedJob.name, eqId: ae.eqId, qty: ae.qty, employeeId: employee.id, employeeName: employee.name, type: "pick", ts: now, photo: dataUrl || null, location: loc || null }]);
      setItemResults(r => ({ ...r, [ae.eqId]: "ok" }));
      return;
    }
    // return — geo-validate against the pickup location (only when GPS is present)
    const isDailyMode = (selectedJob.checkoutMode || "span") === "daily";
    const pickupCo = [...checkouts].reverse().find(c => {
      if (c.jobId !== selectedJob.id || c.eqId !== ae.eqId) return false;
      if (c.type !== "pick" && c.type !== "checkout") return false;
      if (isDailyMode && new Intl.DateTimeFormat("en-CA", { timeZone: APP_TZ }).format(new Date(c.ts)) !== todayStr) return false;
      return true;
    });
    let distance = null;
    if (loc && pickupCo?.location) distance = haversineMeters(+pickupCo.location.lat, +pickupCo.location.lng, +loc.lat, +loc.lng);
    const geoOk = pickupCo?.location && loc && distance !== null && distance <= 50;
    // Require geo check only when photo or barcode mode (both have GPS); "none" mode skips it
    const needsApproval = (vMode !== "none") && !geoOk;
    if (!needsApproval) {
      setCheckouts(p => [...p, { id: "co" + now + ae.eqId, jobId: selectedJob.id, jobName: selectedJob.name, eqId: ae.eqId, qty: ae.qty, employeeId: employee.id, employeeName: employee.name, type: "return", ts: now, photo: dataUrl || null, location: loc || null }]);
      setItemResults(r => ({ ...r, [ae.eqId]: "ok" }));
    } else {
      setAdminRequests(p => [...(p || []), { id: "ar" + now + ae.eqId, type: "geo-return", status: "pending", submittedAt: new Date().toISOString(), employeeId: employee.id, employeeName: employee.name, jobId: selectedJob.id, jobName: selectedJob.name, eqId: ae.eqId, eqName: eq?.name || ae.eqId, qty: ae.qty, photo: dataUrl || null, returnLocation: loc || null, pickupLocation: pickupCo?.location || null, distance: distance !== null ? Math.round(distance) : null }]);
      setItemResults(r => ({ ...r, [ae.eqId]: "pending" }));
    }
  };

  // Commit ONE item's barcode lane (barcode_pick or barcode_return event).
  const commitBarcode = (ae, loc) => {
    const now = Date.now();
    const evType = phase === "pick" ? "barcode_pick" : "barcode_return";
    setCheckouts(p => [...p, { id: "bc" + now + ae.eqId, jobId: selectedJob.id, jobName: selectedJob.name, eqId: ae.eqId, qty: ae.qty, employeeId: employee.id, employeeName: employee.name, type: evType, ts: now, location: loc || null }]);
    setBarcodeResults(r => ({ ...r, [ae.eqId]: "ok" }));
  };

  // What happens when an item row is tapped: depends on mode + role
  const onTapItem = (ae, lane) => {
    if (lane === "barcode") { setScanAe(ae); return; }
    // photo or none lane
    if (vMode === "none") { commitItem(ae, null, null); return; }
    setCaptureAe(ae);
  };

  // Force an immediate save of everything and report success/failure. Returns true on success.
  const doSaveCheckout = async () => {
    if (!saveNow) { setCoSaveState({ error: "Save is unavailable on this screen." }); return false; }
    setCoSaveState("saving");
    const res = await saveNow();
    if (res && res.ok) { setCoSaveState("saved"); setTimeout(() => setCoSaveState(s => s === "saved" ? null : s), 3000); return true; }
    setCoSaveState({ error: (res && res.error) || "Save failed — check your connection and tap Save again." });
    return false;
  };

  // ── Checkout / return flow (per-item, barcode-style) ───────────────────────
  if (phase !== "select" && selectedJob) {
    const isReturn = phase === "return";
    const { pickedIds, returnedIds } = getJobCheckoutState(selectedJob);
    // Pick: all assigned items that still exist. Return: only items currently OUT (picked, not returned).
    const items = (selectedJob.assignedEquipment || []).filter(ae =>
      equipment.some(e => e.id === ae.eqId) && (isReturn ? pickedIds.has(ae.eqId) : true)
    );
    const pendingReturn = (ae) => (adminRequests || []).some(r => r.type === "geo-return" && r.status === "pending" && r.jobId === selectedJob.id && r.eqId === ae.eqId);
    const itemDone = (ae) => {
      const baseKVDone = (isReturn ? returnedIds.has(ae.eqId) : pickedIds.has(ae.eqId));
      const sessionDone = itemResults[ae.eqId] === "ok";
      const pending = isReturn && pendingReturn(ae);
      if (vMode === "both") {
        const myLanes = getMyLanes(selectedJob);
        // Item is "done for me" if all my assigned lanes are complete
        const barcDone = !myLanes.barcode || hasBarcodeEvent(selectedJob, ae.eqId, isReturn) || !!barcodeResults[ae.eqId];
        const phtDone = !myLanes.photo || baseKVDone || sessionDone || pending;
        return barcDone && phtDone;
      }
      return baseKVDone || sessionDone || pending;
    };
    const allDone = items.length > 0 && items.every(itemDone);

    // Per-item photo capture screen
    if (captureAe) {
      const eq = equipment.find(e => e.id === captureAe.eqId);
      return (
        <div style={{ ...S.main, maxWidth: 500 }}>
          <button style={{ ...S.btn("ghost"), marginBottom: 16 }} onClick={() => setCaptureAe(null)}><Icon d={icons.arrow_left} size={15} /> {t("back")}</button>
          <div style={{ ...S.card, marginBottom: 16, display: "flex", alignItems: "center", gap: 14 }}>
            {eq?.photo && <img src={eq.photo} alt="" style={{ width: 56, height: 48, objectFit: "cover", borderRadius: 6 }} />}
            <div>
              <p style={{ margin: 0, fontWeight: 700, fontSize: 15 }}>{eq?.name}</p>
              <p style={{ margin: "2px 0 0", fontSize: 12, color: "#666" }}>{isReturn ? "Return" : "Pick-up"} photo</p>
            </div>
          </div>
          <GeoPhoto key={captureAe.eqId} label={`${isReturn ? "Return" : "Pick-up"} photo — ${eq?.name || ""}`} onCapture={(dataUrl, loc) => { commitItem(captureAe, dataUrl, loc); setCaptureAe(null); }} />
        </div>
      );
    }

    // Per-item QR scan screen
    if (scanAe) {
      const eq = equipment.find(e => e.id === scanAe.eqId);
      return (
        <div style={{ ...S.main, maxWidth: 500 }}>
          <button style={{ ...S.btn("ghost"), marginBottom: 16 }} onClick={() => setScanAe(null)}><Icon d={icons.arrow_left} size={15} /> {t("back")}</button>
          <div style={{ ...S.card, marginBottom: 16, display: "flex", alignItems: "center", gap: 14 }}>
            {eq?.photo && <img src={eq.photo} alt="" style={{ width: 56, height: 48, objectFit: "cover", borderRadius: 6 }} />}
            <div>
              <p style={{ margin: 0, fontWeight: 700, fontSize: 15 }}>{eq?.name}</p>
              <p style={{ margin: "2px 0 0", fontSize: 12, color: "#666" }}>{isReturn ? "Return" : "Pick-up"} scan · {eq?.category}</p>
            </div>
          </div>
          <QRScanner
            key={scanAe.eqId}
            label={`Scan QR label on: ${eq?.name || ""}`}
            onScan={(scannedId, loc) => {
              if (scannedId === scanAe.eqId) {
                commitBarcode(scanAe, loc);
                setScanAe(null);
              }
              // If wrong item scanned, scanner stays open (user can try again)
            }}
            onClose={() => setScanAe(null)}
          />
        </div>
      );
    }

    return (
      <div style={{ ...S.main, maxWidth: 600 }}>
        <button style={{ ...S.btn("ghost"), marginBottom: 16 }} onClick={() => { setSelectedJob(null); setPhase("select"); setItemResults({}); }}><Icon d={icons.arrow_left} size={15} /> {t("back")}</button>
        <StepBar currentStep={isReturn ? 2 : 0} />
        <div style={{ ...S.card, marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{selectedJob.name}</h2>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "#666" }}>{selectedJob.production} · {selectedJob.location}{selectedJob.locationCity ? ` · ${selectedJob.locationCity}` : ""} · {selectedJob.shootTime}</p>
          {(() => {
            const dates = selectedJob.dates || [];
            const td = today();
            const multi = dates.length > 1;
            return (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "#e8b84b", background: "rgba(232,184,75,0.1)", border: "1px solid rgba(232,184,75,0.25)", borderRadius: 8, padding: "4px 10px" }}>
                  <Icon d={icons.calendar} size={13} /> Today · {formatDate(td)}
                </span>
                {dates.length > 0 && (
                  <span style={{ fontSize: 11, color: "#8a8f9d" }}>
                    {multi ? `${dates.length}-day shoot: ` : "Shoot date: "}{dates.map(d => formatDate(d)).join(" · ")}
                  </span>
                )}
                <span style={{ display: "inline-flex", alignItems: "center", fontSize: 10, fontWeight: 700, color: (selectedJob.checkoutMode || "span") === "daily" ? "#60a5fa" : "#8a8f9d", background: (selectedJob.checkoutMode || "span") === "daily" ? "rgba(96,165,250,0.1)" : "rgba(255,255,255,0.04)", border: `1px solid ${(selectedJob.checkoutMode || "span") === "daily" ? "rgba(96,165,250,0.3)" : "#2e3340"}`, borderRadius: 6, padding: "3px 8px", letterSpacing: "0.04em" }}>
                  {(selectedJob.checkoutMode || "span") === "daily" ? "Daily return" : "Return last day"}
                </span>
              </div>
            );
          })()}
        </div>
        {(isReturn && (selectedJob.dates || []).length > 1 && (selectedJob.checkoutMode || "span") === "span") && (
          <div style={{ ...S.card, background: "rgba(232,184,75,0.05)", border: "1px solid rgba(232,184,75,0.18)", marginBottom: 16 }}>
            <p style={{ margin: 0, fontSize: 12, color: "#e8b84b", display: "flex", gap: 8, alignItems: "center" }}>
              <Icon d={icons.calendar} size={14} /> Multi-day shoot — gear stays checked out across all days. Only return it when you're done with the whole job.
            </p>
          </div>
        )}
        {(() => {
          const myLanes = getMyLanes(selectedJob);
          const modeLabel = vMode === "both" ? " · photo & scan required" : vMode === "photo" ? " · photo required" : vMode === "barcode" ? " · QR scan required" : "";
          return <p style={S.sectionTitle}>{isReturn ? "Tap each item to return" : "Tap each item to check out"}{modeLabel}</p>;
        })()}
        {items.length === 0 ? (
          <p style={{ fontSize: 13, color: "#666" }}>{isReturn ? "No gear out to return for this job." : "Nothing to check out."}</p>
        ) : (
          <div style={S.col}>
            {items.map(ae => {
              const eq = equipment.find(e => e.id === ae.eqId);
              const done = itemDone(ae);
              const pend = isReturn && (itemResults[ae.eqId] === "pending" || pendingReturn(ae)) && !returnedIds.has(ae.eqId);
              const myLanes = getMyLanes(selectedJob);

              // Per-lane done state
              const barcodeDoneKV = hasBarcodeEvent(selectedJob, ae.eqId, isReturn);
              const barcodeDoneSession = !!barcodeResults[ae.eqId];
              const barcodeDone = barcodeDoneKV || barcodeDoneSession;
              const photoDoneKV = hasPhotoEvent(selectedJob, ae.eqId, isReturn) || (isReturn && (returnedIds.has(ae.eqId)));
              const photoDoneSession = itemResults[ae.eqId] === "ok";
              const photoDone = photoDoneKV || photoDoneSession;

              return (
                <div key={ae.eqId} style={{ ...S.card, background: "#0f1117", display: "flex", alignItems: "center", gap: 14, opacity: done && !pend ? 0.65 : 1 }}>
                  {eq.photo && <img src={eq.photo} alt="" style={{ width: 48, height: 40, objectFit: "cover", borderRadius: 6, flexShrink: 0 }} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>{eq.name}</p>
                    <p style={{ margin: "2px 0 0", fontSize: 12, color: "#666" }}>{eq.category} · {t("qty")}: {ae.qty}</p>
                    {pend && <p style={{ margin: "3px 0 0", fontSize: 11, color: "#f87171", fontWeight: 600 }}>⚠ Sent for admin approval</p>}
                    {/* "Both" mode: show mini status for each lane */}
                    {vMode === "both" && (
                      <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                        <span style={{ fontSize: 10, color: barcodeDone ? "#34d399" : "#555" }}>{barcodeDone ? "✓ Scanned" : "○ Scan"}</span>
                        <span style={{ fontSize: 10, color: "#333" }}>·</span>
                        <span style={{ fontSize: 10, color: photoDone ? "#34d399" : "#555" }}>{photoDone ? "✓ Photo" : "○ Photo"}</span>
                      </div>
                    )}
                  </div>
                  {done ? (
                    <span style={{ ...S.badge(pend ? "amber" : "green"), flexShrink: 0 }}>{pend ? "Pending" : (isReturn ? "✓ Returned" : "✓ Out")}</span>
                  ) : (
                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      {myLanes.barcode && !barcodeDone && (
                        <button style={{ ...S.btn("ghost"), padding: "6px 10px", justifyContent: "center", border: "1px solid rgba(232,184,75,0.4)" }} onClick={() => onTapItem(ae, "barcode")}>
                          <Icon d={icons.qr} size={15} />
                        </button>
                      )}
                      {myLanes.photo && !photoDone && (
                        <button style={{ ...S.btn("primary"), padding: "6px 10px", justifyContent: "center" }} onClick={() => onTapItem(ae, "photo")}>
                          <Icon d={vMode === "none" ? icons.check : icons.camera} size={15} />
                          {vMode === "none" ? (isReturn ? " Return" : " Out") : " Photo"}
                        </button>
                      )}
                      {myLanes.barcode && barcodeDone && !myLanes.photo && (
                        <span style={{ ...S.badge("green"), flexShrink: 0 }}>✓ Scanned</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {allDone && (
          <div style={{ ...S.card, background: "rgba(52,211,153,0.07)", border: "1px solid rgba(52,211,153,0.25)", marginTop: 16, textAlign: "center" }}>
            <div style={{ fontSize: 38, marginBottom: 6 }}>{isReturn ? "🏁" : "✅"}</div>
            <p style={{ margin: "0 0 12px", fontWeight: 700, color: "#34d399" }}>{isReturn ? "All gear returned!" : "All gear checked out!"}</p>
            <button style={{ ...S.btn("primary"), width: "100%", justifyContent: "center", opacity: coSaveState === "saving" ? 0.7 : 1 }} disabled={coSaveState === "saving"} onClick={async () => { const ok = await doSaveCheckout(); if (ok) { setSelectedJob(null); setPhase("select"); setItemResults({}); } }}>{coSaveState === "saving" ? "Saving…" : `${t("backToJobs")}`}</button>
          </div>
        )}
        {/* Explicit save — make sure everything reached the cloud */}
        {items.length > 0 && (
          <div style={{ position: "sticky", bottom: 12, zIndex: 5, marginTop: 16 }}>
            <button
              style={{ ...S.btn(coSaveState === "saved" ? "success" : (coSaveState && coSaveState.error) ? "danger" : "primary"), width: "100%", justifyContent: "center", padding: "14px", fontSize: 15, fontWeight: 700, boxShadow: "0 4px 24px rgba(0,0,0,0.5)", opacity: coSaveState === "saving" ? 0.75 : 1 }}
              disabled={coSaveState === "saving"}
              onClick={doSaveCheckout}
            >
              {coSaveState === "saving" ? "Saving…"
                : coSaveState === "saved" ? "✓ All saved to cloud"
                : (coSaveState && coSaveState.error) ? "Save Failed — tap to retry"
                : "💾 Save"}
            </button>
            {coSaveState && coSaveState.error && (
              <p style={{ fontSize: 12, color: "#f87171", textAlign: "center", margin: "8px 0 0", lineHeight: 1.5 }}>⚠ {coSaveState.error}</p>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── Main employee portal (tabs) ─────────────────────────────────────────────
  return (
    <div style={S.app}>
      {/* Top bar */}
      <header style={S.topbar}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {profilePhoto
            ? <img src={profilePhoto} alt="avatar" style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover", border: "2px solid #e8b84b" }} />
            : <div style={{ width: 32, height: 32, borderRadius: "50%", background: "rgba(232,184,75,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Icon d={icons.user} size={16} color="#e8b84b" />
              </div>
          }
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#e8e4dc", lineHeight: 1.2 }}>{employee.name}</div>
            <div style={{ fontSize: 10, color: "#666", textTransform: "uppercase", letterSpacing: "0.06em" }}>{t("crew")}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <LangPill setLang={setLang} />
          <button style={{ ...S.btn("ghost"), padding: "6px 10px", fontSize: 12 }} onClick={onLogout}>
            <Icon d={icons.logout} size={13} /> {t("logout")}
          </button>
        </div>
      </header>

      {offlineMode && (
        <div style={{ background: "rgba(232,184,75,0.12)", borderBottom: "1px solid rgba(232,184,75,0.25)", padding: "8px 16px", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13 }}>⚠️</span>
          <p style={{ margin: 0, fontSize: 12, color: "#e8b84b", lineHeight: 1.4 }}>
            <strong>Offline</strong> — cached data only. Checkouts will not save until connection returns.
          </p>
        </div>
      )}

      {showReportModal && (
        <ReportModal employee={employee} equipment={equipment} onSubmit={(report) => {
          setReports(p => [...p, report]);
          if (lineGroupId && !lineNotifyMuted) {
            const msg = `🚨 [Damage Report] ${employee.name}\n📷 ${report.eqName || "—"}\n📝 ${report.description}\n🔗 https://pickshootreturn.pages.dev`;
            api.notify({ userIds: [lineGroupId], message: msg });
          }
          setShowReportModal(false);
        }} onClose={() => setShowReportModal(false)} />
      )}

      <div style={{ ...S.main, paddingBottom: 80 }}>
        {/* TODAY TAB */}
        {tab === "today" && (() => {
          const confirmedJobs = jobs.filter(j => j.status === "Confirmed");
          const pencilJobs = jobs.filter(j => j.status === "Pencil");
          const myRequests = (equipmentRequests || []).filter(r => r.employeeId === employee.id);
          const pendingRequests = myRequests.filter(r => r.status === "pending");
          const statJobMap = { today: availableJobs, confirmed: confirmedJobs, pencil: pencilJobs };
          return (
          <div style={S.col}>
            <div>
              <h1 style={{ ...S.pageTitle, fontSize: 18, marginBottom: 2 }}>{t("todaysJobs")}</h1>
              <p style={{ ...S.pageSubtitle, marginBottom: 0, fontSize: 12 }}>{new Date().toLocaleDateString(lang === "th" ? "th-TH" : "en-GB", { weekday: "long", day: "2-digit", month: "long" })}</p>
            </div>

            {/* Gear currently out — return any day (not just the shoot date) */}
            {(() => {
              const outJobs = jobs.filter(j => {
                const { pickedIds, returnedIds } = getJobCheckoutState(j);
                return (j.assignedEquipment || []).some(ae => pickedIds.has(ae.eqId) && !returnedIds.has(ae.eqId));
              });
              if (outJobs.length === 0) return null;
              return (
                <div style={{ ...S.card, background: "rgba(232,184,75,0.06)", border: "1px solid rgba(232,184,75,0.2)" }}>
                  <p style={{ ...S.sectionTitle, marginBottom: 10 }}>🎬 {t("gearOutTitle")}</p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {outJobs.map(job => {
                      const { pickedIds, returnedIds } = getJobCheckoutState(job);
                      const outCount = (job.assignedEquipment || []).filter(ae => pickedIds.has(ae.eqId) && !returnedIds.has(ae.eqId)).length;
                      return (
                        <div key={job.id} style={{ ...S.card, background: "#0f1117", cursor: "pointer", display: "flex", alignItems: "center", gap: 12 }} onClick={() => selectJob(job, true)}>
                          <span style={{ ...S.badge("amber"), flexShrink: 0 }}>{outCount} {t("outBadge")}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>{job.name}</p>
                            <p style={{ margin: "2px 0 0", fontSize: 11, color: "#8a8f9d" }}>{job.dates?.map(d => formatDate(d)).join(", ")}</p>
                          </div>
                          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#e8b84b" strokeWidth={2} strokeLinecap="round"><path d="M9 18l6-6-6-6" /></svg>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* Stats — clickable, expand one at a time */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              {[
                { key: "today", label: t("tabToday"), value: availableJobs.length, color: "#e8b84b" },
                { key: "confirmed", label: t("statusConfirmed"), value: confirmedJobs.length, color: "#34d399" },
                { key: "pencil", label: t("statusPencil"), value: pencilJobs.length, color: "#94a3b8" },
              ].map(stat => (
                <div key={stat.key} onClick={() => setExpandedStat(expandedStat === stat.key ? null : stat.key)} style={{ ...S.card, textAlign: "center", padding: "12px 6px", cursor: "pointer", border: expandedStat === stat.key ? `1px solid ${stat.color}40` : undefined, transition: "border-color .15s" }}>
                  <p style={{ margin: 0, fontSize: 24, fontWeight: 800, color: stat.color, lineHeight: 1 }}>{stat.value}</p>
                  <p style={{ margin: "4px 0 0", fontSize: 9, color: "#666", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>{stat.label}</p>
                  <p style={{ margin: "3px 0 0", fontSize: 9, color: expandedStat === stat.key ? stat.color : "#444" }}>{expandedStat === stat.key ? "▲" : "▼"}</p>
                </div>
              ))}
            </div>

            {/* Expanded stat job list */}
            {expandedStat && (() => {
              const statJobs = statJobMap[expandedStat] || [];
              if (statJobs.length === 0) return <p style={{ fontSize: 13, color: "#555", textAlign: "center" }}>No jobs.</p>;
              return statJobs.map(job => {
                const { allPicked, allReturned } = getJobCheckoutState(job);
                const isToday = expandedStat === "today";
                return (
                  <div key={job.id} style={{ ...S.card, cursor: "pointer" }} onClick={() => isToday ? selectJob(job) : setEmpDetailJob(job)}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, justifyContent: "space-between" }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
                          {isToday ? (allReturned ? <span style={S.badge("green")}>{t("allReturned")}</span> : allPicked ? <span style={S.badge("amber")}>{t("onShoot")}</span> : <span style={S.badge("blue")}>{t("readyPick")}</span>) : <span style={S.badge(expandedStat === "confirmed" ? "green" : "gray")}>{job.status}</span>}
                          <span style={S.badge("gray")}>{job.shootTime}</span>
                        </div>
                        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{job.name}</h3>
                        <p style={{ margin: "4px 0 0", fontSize: 12, color: "#666" }}>{job.production} · {job.location}{job.locationCity ? ` · ${job.locationCity}` : ""}</p>
                        <p style={{ margin: "4px 0 0", fontSize: 12, color: "#8a8f9d" }}>{job.dates?.map(d => formatDate(d)).join(", ")}</p>
                      </div>
                      <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth={2} strokeLinecap="round"><path d="M9 18l6-6-6-6" /></svg>
                    </div>
                  </div>
                );
              });
            })()}

            {/* Job detail modal for Confirmed/Pencil jobs */}
            {empDetailJob && <JobDetailModal job={empDetailJob} equipment={equipment} onClose={() => setEmpDetailJob(null)} />}

            {/* Gear Checkout Requests */}
            <div style={S.card}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <p style={{ ...S.sectionTitle, margin: 0 }}>{t("gearRequests")} {pendingRequests.length > 0 && <span style={{ ...S.badge("amber"), marginLeft: 6 }}>{pendingRequests.length} {t("dashPending")}</span>}</p>
                <button style={{ ...S.btn("primary"), padding: "6px 12px", fontSize: 12 }} onClick={() => setShowGearRequest(true)}>
                  <Icon d={icons.plus} size={13} /> {t("requestBtn")}
                </button>
              </div>
              {myRequests.length === 0 ? (
                <p style={{ fontSize: 13, color: "#555" }}>{t("noGearRequests")}</p>
              ) : myRequests.slice().reverse().map((req, i) => {
                const itemLabel = req.items
                  ? req.items.map(it => { const e = equipment.find(x => x.id === it.eqId); return `${e?.name || it.eqName}${it.qty > 1 ? ` ×${it.qty}` : ""}`; }).join(", ")
                  : `${equipment.find(e => e.id === req.eqId)?.name || req.eqName} ×${req.qty}`;
                return (
                  <div key={req.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, paddingBottom: i < myRequests.length - 1 ? 10 : 0, marginBottom: i < myRequests.length - 1 ? 10 : 0, borderBottom: i < myRequests.length - 1 ? "1px solid #252830" : "none" }}>
                    <span style={S.badge(req.status === "approved" ? "green" : req.status === "denied" ? "red" : "amber")}>{req.status}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{itemLabel}</p>
                      <p style={{ margin: "2px 0 0", fontSize: 11, color: "#666" }}>
                        {req.purpose === "work" ? `${t("reqWork")}${req.jobName}` : t("reqPractice")}
                        {(req.useDates?.length > 0) ? ` · ${req.useDates.map(formatDate).join(", ")}` : req.useDate ? ` · For: ${formatDate(req.useDate)}` : ""}
                        {" · "}{new Date(req.requestedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                      </p>
                      {req.reason && <p style={{ margin: "2px 0 0", fontSize: 11, color: "#8a8f9d" }}>{req.reason}</p>}
                    </div>
                  </div>
                );
              })}
            </div>


            {/* Gear Request Modal */}
            {showGearRequest && (
              <Modal title={t("reqGearModalTitle")} onClose={() => { setShowGearRequest(false); setGearReqForm({ useDates: [], purpose: "practice", productionName: "", jobName: "", reason: "", selectedGear: {} }); }} wide>
                <div style={S.col}>
                  <div>
                    <label style={S.label}>{t("datesNeeded")}</label>
                    {(() => {
                      const { year, month } = gearReqCalMonth;
                      const firstDay = new Date(year, month, 1).getDay();
                      const daysInMonth = new Date(year, month + 1, 0).getDate();
                      const monthName = new Date(year, month).toLocaleString("en-GB", { month: "long", year: "numeric" });
                      const todayStr = today();
                      const cells = [];
                      for (let i = 0; i < firstDay; i++) cells.push(null);
                      for (let d = 1; d <= daysInMonth; d++) cells.push(d);
                      return (
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                            <button style={{ ...S.btn("ghost"), padding: "4px 9px" }} onClick={() => setGearReqCalMonth(p => { const d = new Date(p.year, p.month - 1); return { year: d.getFullYear(), month: d.getMonth() }; })}>‹</button>
                            <span style={{ flex: 1, textAlign: "center", fontWeight: 600, fontSize: 13 }}>{monthName}</span>
                            <button style={{ ...S.btn("ghost"), padding: "4px 9px" }} onClick={() => setGearReqCalMonth(p => { const d = new Date(p.year, p.month + 1); return { year: d.getFullYear(), month: d.getMonth() }; })}>›</button>
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 }}>
                            {["Su","Mo","Tu","We","Th","Fr","Sa"].map(d => <div key={d} style={{ textAlign: "center", fontSize: 9, color: "#666", fontWeight: 600, paddingBottom: 3 }}>{d}</div>)}
                            {cells.map((d, i) => {
                              if (!d) return <div key={"e"+i} />;
                              const ds = `${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
                              const sel = gearReqForm.useDates.includes(ds);
                              const isToday = ds === todayStr;
                              return (
                                <div key={d} onClick={() => setGearReqForm(p => ({ ...p, useDates: p.useDates.includes(ds) ? p.useDates.filter(x => x !== ds) : [...p.useDates, ds].sort() }))}
                                  style={{ textAlign: "center", padding: "6px 0", borderRadius: 5, cursor: "pointer", fontSize: 12, fontWeight: sel ? 700 : 400,
                                    background: sel ? "#e8b84b" : isToday ? "rgba(232,184,75,0.1)" : "transparent",
                                    color: sel ? "#0f1117" : isToday ? "#e8b84b" : "#e8e4dc",
                                    border: isToday && !sel ? "1px solid rgba(232,184,75,0.3)" : "1px solid transparent" }}>
                                  {d}
                                </div>
                              );
                            })}
                          </div>
                          {gearReqForm.useDates.length > 0
                            ? <p style={{ fontSize: 11, color: "#e8b84b", marginTop: 8 }}>{gearReqForm.useDates.length} date{gearReqForm.useDates.length > 1 ? "s" : ""} selected: {gearReqForm.useDates.map(formatDate).join(", ")}</p>
                            : <p style={{ fontSize: 11, color: "#555", marginTop: 8 }}>{t("tapDatesHint")}</p>
                          }
                        </div>
                      );
                    })()}
                  </div>

                  <div>
                    <label style={S.label}>{t("selectEquipment")}</label>
                    {(() => {
                      const avList = (() => {
                        if (gearReqForm.useDates.length === 0) return equipment.map(eq => ({ ...eq, available: eq.total, taken: 0 }));
                        const perDate = gearReqForm.useDates.map(d => calcAvailable(equipment, jobs, checkouts, d));
                        return equipment.map(eq => {
                          const minAvail = Math.min(...perDate.map(av => av.find(a => a.id === eq.id)?.available ?? eq.total));
                          return { ...eq, available: minAvail };
                        });
                      })();
                      return (
                        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 300, overflowY: "auto", paddingRight: 4 }}>
                          {avList.map(eq => {
                            const currentQty = +gearReqForm.selectedGear[eq.id] || 0;
                            const isSelected = currentQty > 0;
                            const maxAvail = eq.available ?? eq.total;
                            const isMulti = eq.total > 1;
                            return (
                              <div key={eq.id}
                                onClick={() => {
                                  if (!isSelected && maxAvail === 0) return;
                                  if (!isSelected) setGearReqForm(p => ({ ...p, selectedGear: { ...p.selectedGear, [eq.id]: 1 } }));
                                  else setGearReqForm(p => { const g = { ...p.selectedGear }; delete g[eq.id]; return { ...p, selectedGear: g }; });
                                }}
                                style={{
                                  display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 10,
                                  border: isSelected ? "1.5px solid #e8b84b" : maxAvail === 0 ? "1.5px solid #252830" : "1.5px solid #2e3340",
                                  background: isSelected ? "rgba(232,184,75,0.07)" : maxAvail === 0 ? "rgba(0,0,0,0.2)" : "#0f1117",
                                  cursor: maxAvail === 0 && !isSelected ? "not-allowed" : "pointer",
                                  opacity: maxAvail === 0 && !isSelected ? 0.45 : 1,
                                  transition: "all 0.12s",
                                }}>
                                <div style={{ width: 22, height: 22, borderRadius: 6, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                                  background: isSelected ? "#e8b84b" : "#1a1e27", border: isSelected ? "none" : "1.5px solid #3a4050" }}>
                                  {isSelected && <Icon d={icons.check} size={13} color="#0f1117" strokeW={3} />}
                                </div>
                                {eq.photo
                                  ? <img src={eq.photo} alt="" style={{ width: 40, height: 36, objectFit: "cover", borderRadius: 6, flexShrink: 0 }} />
                                  : <div style={{ width: 40, height: 36, borderRadius: 6, background: "#252830", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                                      <Icon d={icons.camera} size={14} color="#444" />
                                    </div>
                                }
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <p style={{ margin: 0, fontWeight: 600, fontSize: 13, color: isSelected ? "#e8b84b" : "#e8e4dc", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{eq.name}</p>
                                  <p style={{ margin: "2px 0 0", fontSize: 11, color: "#666" }}>
                                    {eq.category}
                                    {isMulti ? ` · ${maxAvail} of ${eq.total} free` : maxAvail === 0 ? ` · ${t("jobUnavailable")}` : ` · ${t("jobAvailable")}`}
                                  </p>
                                </div>
                                {isMulti && isSelected && (
                                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                                    <button style={{ width: 28, height: 28, borderRadius: 6, border: "1px solid #3a4050", background: "#1a1e27", color: "#e8e4dc", fontSize: 16, lineHeight: 1, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                                      onClick={() => setGearReqForm(p => ({ ...p, selectedGear: { ...p.selectedGear, [eq.id]: Math.max(1, (p.selectedGear[eq.id] || 1) - 1) } }))}>−</button>
                                    <span style={{ minWidth: 20, textAlign: "center", fontWeight: 700, fontSize: 14, color: "#e8b84b" }}>{currentQty}</span>
                                    <button style={{ width: 28, height: 28, borderRadius: 6, border: "1px solid #3a4050", background: "#1a1e27", color: "#e8e4dc", fontSize: 16, lineHeight: 1, cursor: currentQty >= maxAvail ? "not-allowed" : "pointer", opacity: currentQty >= maxAvail ? 0.4 : 1, display: "flex", alignItems: "center", justifyContent: "center" }}
                                      onClick={() => setGearReqForm(p => ({ ...p, selectedGear: { ...p.selectedGear, [eq.id]: Math.min(maxAvail, (p.selectedGear[eq.id] || 1) + 1) } }))}>+</button>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>

                  <div>
                    <label style={S.label}>{t("purposeLabel")}</label>
                    <select style={S.select} value={gearReqForm.purpose} onChange={e => setGearReqForm(p => ({ ...p, purpose: e.target.value, productionName: "", jobName: "" }))}>
                      <option value="practice">{t("purposePractice")}</option>
                      <option value="work">{t("purposeWork")}</option>
                    </select>
                  </div>
                  {gearReqForm.purpose === "work" && (
                    <>
                      <div>
                        <label style={S.label}>{t("productionHouse")}</label>
                        <input style={S.input} value={gearReqForm.productionName} onChange={e => setGearReqForm(p => ({ ...p, productionName: e.target.value }))} placeholder="Production house" />
                      </div>
                      <div>
                        <label style={S.label}>{t("jobNameLabel")}</label>
                        <input style={S.input} value={gearReqForm.jobName} onChange={e => setGearReqForm(p => ({ ...p, jobName: e.target.value }))} placeholder="Job name" />
                      </div>
                    </>
                  )}
                  <div>
                    <label style={S.label}>{t("reasonLabel")}</label>
                    <textarea style={{ ...S.input, height: 70, resize: "vertical", lineHeight: 1.5 }} value={gearReqForm.reason} onChange={e => setGearReqForm(p => ({ ...p, reason: e.target.value }))} placeholder={t("reasonPlaceholder")} />
                  </div>

                  {Object.values(gearReqForm.selectedGear).some(q => q > 0) && (
                    <div style={{ padding: "10px 14px", background: "rgba(232,184,75,0.06)", border: "1px solid rgba(232,184,75,0.15)", borderRadius: 8 }}>
                      <p style={{ margin: 0, fontSize: 11, color: "#e8b84b", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>Selected</p>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {Object.entries(gearReqForm.selectedGear).filter(([, q]) => q > 0).map(([eqId, qty]) => {
                          const eq = equipment.find(e => e.id === eqId);
                          return eq ? <span key={eqId} style={S.tag}>{eq.name}{eq.total > 1 ? ` ×${qty}` : ""}</span> : null;
                        })}
                      </div>
                    </div>
                  )}

                  <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                    <button style={S.btn("ghost")} onClick={() => { setShowGearRequest(false); setGearReqForm({ useDates: [], purpose: "practice", productionName: "", jobName: "", reason: "", selectedGear: {} }); }}>{t("cancel")}</button>
                    <button style={S.btn("primary")} onClick={() => {
                      const selectedItems = Object.entries(gearReqForm.selectedGear).filter(([, q]) => q > 0);
                      if (selectedItems.length === 0) return;
                      const items = selectedItems.map(([eqId, qty]) => {
                        const eq = equipment.find(e => e.id === eqId);
                        return { eqId, eqName: eq?.name || "", qty };
                      });
                      const newReq = {
                        id: "req" + Date.now(),
                        employeeId: employee.id,
                        employeeName: employee.name,
                        items,
                        eqId: items[0].eqId,
                        eqName: items[0].eqName,
                        qty: items[0].qty,
                        useDates: gearReqForm.useDates,
                        purpose: gearReqForm.purpose,
                        productionName: gearReqForm.productionName,
                        jobName: gearReqForm.jobName,
                        reason: gearReqForm.reason,
                        status: "pending",
                        requestedAt: Date.now(),
                        resolvedAt: null,
                      };
                      setEquipmentRequests(p => [...p, newReq]);
                      if (lineGroupId && !lineNotifyMuted) {
                        const itemLabel = items.map(it => `${it.eqName}${it.qty > 1 ? ` ×${it.qty}` : ""}`).join(", ");
                        const groups = {};
                        [...(gearReqForm.useDates || [])].sort().forEach(d => {
                          const dt = new Date(d + "T00:00:00");
                          const key = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}`;
                          const label = dt.toLocaleString("en-GB", { month: "short" });
                          if (!groups[key]) groups[key] = { label, days: [] };
                          groups[key].days.push(dt.getDate());
                        });
                        const dateStr = Object.keys(groups).sort().map(k => `${groups[k].label} ${groups[k].days.join(",")}`).join(". ");
                        const purposeStr = gearReqForm.purpose === "work" ? `Job: ${gearReqForm.jobName}${gearReqForm.productionName ? ` — ${gearReqForm.productionName}` : ""}` : "Purpose: Practice";
                        const msg = `📦 [Gear Request] ${employee.name}\n🎥 ${itemLabel}${dateStr ? `\n📅 ${dateStr}` : ""}\n💼 ${purposeStr}\n🔗 https://pickshootreturn.pages.dev`;
                        api.notify({ userIds: [lineGroupId], message: msg });
                      }
                      setGearReqForm({ useDates: [], purpose: "practice", productionName: "", jobName: "", reason: "", selectedGear: {} });
                      setShowGearRequest(false);
                    }}>{t("submitRequest")}</button>
                  </div>
                </div>
              </Modal>
            )}

            {/* Production House Request Modal */}
            {showAdminReqModal === "production-house" && (
              <Modal title="Request New Production House" onClose={() => setShowAdminReqModal(null)}>
                <div style={S.col}>
                  <div>
                    <label style={S.label}>Production House Name</label>
                    <input style={S.input} value={adminReqForm.name || ""} onChange={e => setAdminReqForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Thai Film Co." autoFocus />
                  </div>
                  <div>
                    <label style={S.label}>Billing Address</label>
                    <textarea style={{ ...S.input, height: 80, resize: "vertical" }} value={adminReqForm.address || ""} onChange={e => setAdminReqForm(p => ({ ...p, address: e.target.value }))} placeholder="Full billing address…" />
                  </div>
                  {adminReqMsg && <p style={{ fontSize: 12, color: adminReqMsg.ok ? "#34d399" : "#f87171", margin: 0 }}>{adminReqMsg.text}</p>}
                  <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                    <button style={S.btn("ghost")} onClick={() => setShowAdminReqModal(null)}>Cancel</button>
                    <button style={S.btn("primary")} onClick={() => {
                      if (!adminReqForm.name?.trim()) { setAdminReqMsg({ ok: false, text: "Name is required." }); return; }
                      setAdminRequests(p => [...(p || []), { id: "ar" + Date.now(), type: "production-house", status: "pending", submittedAt: new Date().toISOString(), employeeId: employee.id, employeeName: employee.name, name: adminReqForm.name.trim(), address: adminReqForm.address || "" }]);
                      setShowAdminReqModal(null);
                    }}>Submit Request</button>
                  </div>
                </div>
              </Modal>
            )}

            {/* Equipment Add Request Modal */}
            {showAdminReqModal === "equipment" && (
              <Modal title="Request New Equipment" onClose={() => setShowAdminReqModal(null)}>
                <div style={S.col}>
                  <div>
                    <label style={S.label}>Item Name</label>
                    <input style={S.input} value={adminReqForm.name || ""} onChange={e => setAdminReqForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. DJI Ronin 4D" autoFocus />
                  </div>
                  <div>
                    <label style={S.label}>Category</label>
                    <input style={S.input} value={adminReqForm.category || ""} onChange={e => setAdminReqForm(p => ({ ...p, category: e.target.value }))} placeholder="e.g. Camera, Lens, Power…" />
                  </div>
                  <div>
                    <label style={S.label}>Total Units</label>
                    <input style={S.input} type="number" min={1} value={adminReqForm.total || "1"} onChange={e => setAdminReqForm(p => ({ ...p, total: e.target.value }))} />
                  </div>
                  <div>
                    <label style={S.label}>Notes</label>
                    <input style={S.input} value={adminReqForm.notes || ""} onChange={e => setAdminReqForm(p => ({ ...p, notes: e.target.value }))} placeholder="Optional notes" />
                  </div>
                  <div>
                    <label style={S.label}>Photo (optional)</label>
                    <input ref={adminReqPhotoRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      compressImage(file, { maxDim: 1200, quality: 0.72 }).then(d => d && setAdminReqForm(p => ({ ...p, photo: d })));
                    }} />
                    <button style={S.btn("ghost")} onClick={() => adminReqPhotoRef.current?.click()}><Icon d={icons.photo} size={14} /> {adminReqForm.photo ? "Change Photo" : "Upload Photo"}</button>
                    {adminReqForm.photo && <img src={adminReqForm.photo} alt="preview" style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 6, marginTop: 8 }} />}
                  </div>
                  {adminReqMsg && <p style={{ fontSize: 12, color: adminReqMsg.ok ? "#34d399" : "#f87171", margin: 0 }}>{adminReqMsg.text}</p>}
                  <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                    <button style={S.btn("ghost")} onClick={() => setShowAdminReqModal(null)}>Cancel</button>
                    <button style={S.btn("primary")} onClick={() => {
                      if (!adminReqForm.name?.trim()) { setAdminReqMsg({ ok: false, text: "Item name is required." }); return; }
                      setAdminRequests(p => [...(p || []), { id: "ar" + Date.now(), type: "equipment", status: "pending", submittedAt: new Date().toISOString(), employeeId: employee.id, employeeName: employee.name, name: adminReqForm.name.trim(), category: adminReqForm.category || "", total: +adminReqForm.total || 1, notes: adminReqForm.notes || "", photo: adminReqForm.photo || null }]);
                      setShowAdminReqModal(null);
                    }}>Submit Request</button>
                  </div>
                </div>
              </Modal>
            )}

            {/* Calendar */}
            <div>
              <p style={{ ...S.sectionTitle, marginBottom: 8 }}>{t("jobSchedule")}</p>
              <DashboardCalendar jobs={jobs} equipment={equipment} />
            </div>
          </div>
          );
        })()}

        {/* GEAR TAB */}
        {tab === "gear" && (() => {
          const myAdminReqs = (adminRequests || []).filter(r => r.employeeId === employee.id);
          const eqAvailList = calcAvailable(equipment || [], jobs || [], checkouts || [], today());
          const eqCategories = [...new Set((equipment || []).map(e => e.category).filter(Boolean))].sort();
          const eqFiltered = eqFilterCat ? eqAvailList.filter(e => e.category === eqFilterCat) : eqAvailList;
          const eqSorted = [...eqFiltered].sort((a, b) => {
            switch (eqSortBy) {
              case "name_az": return a.name.localeCompare(b.name);
              case "name_za": return b.name.localeCompare(a.name);
              case "cat":     return (a.category || "").localeCompare(b.category || "") || a.name.localeCompare(b.name);
              case "qty_lo":  return a.total - b.total || a.name.localeCompare(b.name);
              case "qty_hi":  return b.total - a.total || a.name.localeCompare(b.name);
              case "latest": {
                const aTs = Math.max(0, ...(checkouts||[]).filter(c => c.eqId === a.id).map(c => c.ts));
                const bTs = Math.max(0, ...(checkouts||[]).filter(c => c.eqId === b.id).map(c => c.ts));
                return bTs - aTs;
              }
              case "most": {
                const aC = (checkouts||[]).filter(c => c.eqId === a.id).length;
                const bC = (checkouts||[]).filter(c => c.eqId === b.id).length;
                return bC - aC || a.name.localeCompare(b.name);
              }
              default: return 0;
            }
          });
          const renderEqGrid = (items) => (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(145px, 1fr))", gap: 10 }}>
              {items.map(eq => (
                <div key={eq.id} style={{ ...S.card, padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                  <div style={{ position: "relative", width: "100%", aspectRatio: "1 / 1", overflow: "hidden", background: "#0f1117", flexShrink: 0 }}>
                    {eq.photo
                      ? <img src={eq.photo} alt={eq.name} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                      : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon d={icons.camera} size={32} color="#252830" /></div>
                    }
                    <div style={{ position: "absolute", top: 5, left: 5 }}>
                      {eq.available === 0
                        ? <span style={{ ...S.badge("red"), fontSize: 10 }}>Unavail.</span>
                        : eq.available < eq.total
                          ? <span style={{ ...S.badge("amber"), fontSize: 10 }}>{eq.available}/{eq.total}</span>
                          : <span style={{ ...S.badge("green"), fontSize: 10 }}>{eq.available}/{eq.total}</span>
                      }
                    </div>
                  </div>
                  <div style={{ padding: "8px 10px 8px", flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
                    {eq.category && <span style={S.tag}>{eq.category}</span>}
                    <p style={{ margin: 0, fontWeight: 700, fontSize: 12, lineHeight: 1.3, color: "#e8e4dc" }}>{eq.name}</p>
                    {eq.notes && <p style={{ margin: 0, fontSize: 10, color: "#555", lineHeight: 1.3 }}>{eq.notes}</p>}
                    <div style={{ marginTop: "auto", paddingTop: 6, display: "flex", justifyContent: "flex-end" }}>
                      <button style={{ ...S.btn("ghost"), padding: "3px 8px", fontSize: 11 }} title="View QR" onClick={() => printQRForItems([eq], false)}>
                        <Icon d={icons.qr || icons.camera} size={12} /> QR
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          );
          return (
            <div style={S.col}>
              <h1 style={{ ...S.pageTitle, fontSize: 18, marginBottom: 2 }}>Gear</h1>

              {/* Equipment Library */}
              <div>
                <p style={{ ...S.sectionTitle, marginBottom: 8 }}>Equipment Library · {eqAvailList.length} items</p>
                {/* Category filter */}
                {eqCategories.length > 0 && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                    <button onClick={() => setEqFilterCat(null)} style={{ ...S.badge(eqFilterCat === null ? "amber" : "gray"), cursor: "pointer", border: "none", padding: "4px 10px" }}>All</button>
                    {eqCategories.map(c => (
                      <button key={c} onClick={() => setEqFilterCat(eqFilterCat === c ? null : c)} style={{ ...S.badge(eqFilterCat === c ? "amber" : "gray"), cursor: "pointer", border: "none", padding: "4px 10px" }}>{c}</button>
                    ))}
                  </div>
                )}
                {/* Sort bar */}
                <div style={{ display: "flex", gap: 5, overflowX: "auto", marginBottom: 12, paddingBottom: 2 }}>
                  {EQ_SORT_OPTIONS.map(s => (
                    <button key={s.key} onClick={() => setEqSortBy(s.key)} style={{ ...S.btn(eqSortBy === s.key ? "primary" : "ghost"), padding: "5px 10px", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0 }}>{s.label}</button>
                  ))}
                </div>
                {/* Grid — grouped by category when cat sort */}
                {eqSortBy === "cat"
                  ? eqCategories.filter(cat => !eqFilterCat || cat === eqFilterCat).map(cat => {
                      const items = eqSorted.filter(e => e.category === cat);
                      if (!items.length) return null;
                      return (
                        <div key={cat} style={{ marginBottom: 16 }}>
                          <p style={{ ...S.sectionTitle, marginBottom: 8 }}>{cat}</p>
                          {renderEqGrid(items)}
                        </div>
                      );
                    })
                  : renderEqGrid(eqSorted)
                }
              </div>

              {/* Reports section */}
              <div style={{ ...S.card }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <p style={{ ...S.sectionTitle, margin: 0 }}>{t("reportTitle")}</p>
                  <button style={{ ...S.btn("primary"), padding: "6px 12px", fontSize: 12 }} onClick={() => setShowReportModal(true)}>
                    <Icon d={icons.alert} size={13} /> {t("reportNew")}
                  </button>
                </div>
                {myReports.length === 0 ? (
                  <p style={{ fontSize: 13, color: "#555" }}>{t("reportNone")}</p>
                ) : myReports.map(r => (
                  <div key={r.id} style={{ ...S.card, border: r.status === "open" ? "1px solid rgba(239,68,68,0.25)" : "1px solid #252830", marginBottom: 8 }}>
                    <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
                      {{ open: <span style={S.badge("red")}>{t("reportStatusOpen")}</span>, solved: <span style={S.badge("green")}>{t("reportStatusSolved")}</span>, discarded: <span style={S.badge("gray")}>{t("reportStatusDiscarded")}</span> }[r.status]}
                      {r.eqName && <span style={S.tag}>{r.eqName}</span>}
                      {r.reportedBy?.name && <span style={{ fontSize: 11, color: "#888" }}>by {r.reportedBy.name}</span>}
                    </div>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{r.description}</p>
                    <p style={{ margin: "4px 0 0", fontSize: 11, color: "#666" }}>{formatDateTime(r.ts)}</p>
                    {r.photos?.length > 0 && (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                        {r.photos.map((ph, i) => <img key={i} src={ph} alt="" style={{ width: 60, height: 60, objectFit: "cover", borderRadius: 6 }} />)}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Equipment Requests section — collapsed by default */}
              <div style={S.card}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }} onClick={() => setEqReqCollapsed(v => !v)}>
                  <p style={{ ...S.sectionTitle, margin: 0, cursor: "pointer" }}>
                    Equipment Requests {myAdminReqs.length > 0 && <span style={S.badge("amber")}>{myAdminReqs.length}</span>}
                  </p>
                  <span style={{ color: "#666", fontSize: 16, cursor: "pointer" }}>{eqReqCollapsed ? "▸" : "▾"}</span>
                </div>
                {!eqReqCollapsed && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ display: "flex", gap: 8, marginBottom: myAdminReqs.length > 0 ? 12 : 0 }}>
                      <button style={{ ...S.btn("ghost"), padding: "6px 10px", fontSize: 12 }} onClick={() => { setShowAdminReqModal("equipment"); setAdminReqForm({ name: "", category: "", total: "1", notes: "", photo: null }); setAdminReqMsg(null); }}>+ Equipment</button>
                    </div>
                    {myAdminReqs.length === 0 ? (
                      <p style={{ fontSize: 13, color: "#555" }}>No requests yet.</p>
                    ) : myAdminReqs.slice().reverse().map((req, i, arr) => (
                      <div key={req.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, paddingBottom: i < arr.length - 1 ? 10 : 0, marginBottom: i < arr.length - 1 ? 10 : 0, borderBottom: i < arr.length - 1 ? "1px solid #252830" : "none" }}>
                        <span style={S.badge(req.status === "approved" ? "green" : req.status === "rejected" ? "red" : "amber")}>{req.status}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{req.name}</p>
                          <p style={{ margin: "2px 0 0", fontSize: 11, color: "#666" }}>{req.type === "production-house" ? "Production House" : "Equipment"}{req.status === "approved" ? " — Added to system" : ""}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Add New Equipment — goes to admin approval */}
              <div style={S.card}>
                <p style={{ ...S.sectionTitle, margin: "0 0 8px" }}>Add New Equipment</p>
                <p style={{ fontSize: 11, color: "var(--text-muted,#666)", margin: "0 0 12px" }}>Submitted for admin approval before it appears in the library.</p>
                <button style={S.btn("primary")} onClick={() => { setShowAdminReqModal("equipment"); setAdminReqForm({ name: "", category: "", total: "1", notes: "", photo: null }); setAdminReqMsg(null); }}>
                  <Icon d={icons.plus} size={14} /> Submit Equipment
                </button>
              </div>
            </div>
          );
        })()}

        {/* PROFILE TAB */}
        {tab === "profile" && (
          <div style={S.col}>
            <div>
              <h1 style={{ ...S.pageTitle, fontSize: 18, marginBottom: 2 }}>{t("myProfile")}</h1>
              <p style={{ ...S.pageSubtitle, marginBottom: 0, fontSize: 12 }}>{t("crewCard")}</p>
            </div>

            {/* Profile photo */}
            <div style={{ ...S.card, display: "flex", flexDirection: "column", alignItems: "center", gap: 16, padding: 28 }}>
              <div style={{ position: "relative" }}>
                {profilePhoto
                  ? <img src={profilePhoto} alt="profile" style={{ width: 100, height: 100, borderRadius: "50%", objectFit: "cover", border: "3px solid #e8b84b" }} />
                  : <div style={{ width: 100, height: 100, borderRadius: "50%", background: "#252830", display: "flex", alignItems: "center", justifyContent: "center", border: "3px solid #2e3340" }}>
                      <Icon d={icons.user} size={40} color="#444" />
                    </div>
                }
              </div>
              <div style={{ textAlign: "center" }}>
                <p style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "#e8e4dc" }}>{profileInfo.nickname || employee.name}</p>
                {profileInfo.firstName && <p style={{ margin: "2px 0 0", fontSize: 12, color: "#8a8f9d" }}>{profileInfo.firstName} {profileInfo.lastName}</p>}
                <p style={{ margin: "4px 0 0", fontSize: 12, color: "#666" }}>{t("cameraCrew")}</p>
              </div>
              <input ref={profileFileRef} type="file" accept="image/*" capture="user" style={{ display: "none" }} onChange={handleProfileUpload} />
              <div style={{ display: "flex", gap: 10 }}>
                <button style={S.btn("primary")} onClick={() => { profileFileRef.current.removeAttribute("capture"); profileFileRef.current.click(); }}>
                  <Icon d={icons.photo} size={14} /> {t("uploadPhoto")}
                </button>
                <button style={S.btn("ghost")} onClick={() => { profileFileRef.current.setAttribute("capture", "user"); profileFileRef.current.click(); }}>
                  <Icon d={icons.camera} size={14} /> {t("takeSelfie")}
                </button>
              </div>
              {profilePhoto && (
                <button style={{ ...S.btn("danger"), fontSize: 12 }} onClick={() => setProfilePhoto(null)}>{t("removePhoto")}</button>
              )}
            </div>

            {/* My KPI Score */}
            {(() => {
              const max = kpiMax(kpiConfig);
              const score = kpiScore(employee.id, kpiEvents, kpiConfig);
              const stars = kpiStars(score, kpiConfig);
              const { start, end } = kpiPeriod(kpiConfig);
              const myEvents = (kpiEvents || []).filter(ev => ev.employeeId === employee.id && ev.ts >= start.getTime() && ev.ts < end.getTime()).sort((a, b) => b.ts - a.ts);
              return (
                <div style={S.card}>
                  <p style={S.sectionTitle}>{t("kpiMyScore")}</p>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
                    <StarRating value={stars} size={26} />
                    <span style={{ fontSize: 24, fontWeight: 800, color: "#e8b84b" }}>{stars.toFixed(1)}</span>
                    <span style={{ fontSize: 13, color: "#8a8f9d" }}>{score}/{max} {t("kpiPts")}</span>
                  </div>
                  <p style={{ fontSize: 11, color: "#666", margin: "0 0 4px" }}>
                    {t("teamKpiPeriodLabel")} {start.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} – {new Date(end.getTime() - 86400000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                  </p>
                  {myEvents.length === 0 ? (
                    <p style={{ fontSize: 13, color: "#34d399", margin: "8px 0 0" }}>{t("kpiFullScore")}</p>
                  ) : (
                    <div style={{ marginTop: 12, borderTop: "1px solid #252830", paddingTop: 10 }}>
                      <p style={{ ...S.sectionTitle, marginBottom: 8 }}>{t("kpiDeductions")}</p>
                      {myEvents.map(ev => (
                        <div key={ev.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
                          <span style={{ ...S.badge("red"), flexShrink: 0 }}>−{ev.points}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ margin: 0, fontSize: 13, color: "#e8e4dc" }}>{ev.reason}</p>
                            <p style={{ margin: "2px 0 0", fontSize: 10, color: "#555" }}>{new Date(ev.ts).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Personal Information */}
            <div style={S.card}>
              <p style={S.sectionTitle}>{t("personalInfo")}</p>
              <div style={S.col}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <label style={S.label}>{t("firstName")}</label>
                    <input style={S.input} placeholder={t("firstName")} value={profileInfo.firstName} onChange={e => setProfileInfo(p => ({ ...p, firstName: e.target.value }))} />
                  </div>
                  <div>
                    <label style={S.label}>{t("lastName")}</label>
                    <input style={S.input} placeholder={t("lastName")} value={profileInfo.lastName} onChange={e => setProfileInfo(p => ({ ...p, lastName: e.target.value }))} />
                  </div>
                </div>
                <div>
                  <label style={S.label}>{t("nickname")} <span style={{ color: "#666", fontWeight: 400 }}>{t("shownInPortal")}</span></label>
                  <input style={S.input} placeholder={t("nickname")} value={profileInfo.nickname} onChange={e => setProfileInfo(p => ({ ...p, nickname: e.target.value }))} />
                </div>
                {[
                  { key: "phone", label: t("phone"), type: "tel", placeholder: "Phone" },
                  { key: "email", label: t("email"), type: "email", placeholder: "Email" },
                  { key: "lineId", label: t("lineId"), type: "text", placeholder: "Line ID" },
                ].map(f => (
                  <div key={f.key}>
                    <label style={S.label}>{f.label}</label>
                    <input style={S.input} type={f.type} placeholder={f.placeholder} value={profileInfo[f.key]}
                      onChange={e => setProfileInfo(p => ({ ...p, [f.key]: e.target.value }))} />
                  </div>
                ))}
                <div>
                  <label style={S.label}>{t("legalAddress")}</label>
                  <textarea style={{ ...S.input, height: 80, resize: "vertical", lineHeight: 1.5 }}
                    placeholder={t("legalAddress")}
                    value={profileInfo.legalAddress}
                    onChange={e => setProfileInfo(p => ({ ...p, legalAddress: e.target.value }))} />
                </div>
              </div>
            </div>

            {/* Positions & Day Rates */}
            <div style={S.card}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <p style={{ ...S.sectionTitle, margin: 0 }}>{t("positionsTitle")}</p>
                {positions.length < 5 && (
                  <button style={{ ...S.btn("ghost"), padding: "5px 10px", fontSize: 12 }} onClick={addPosition}><Icon d={icons.plus} size={12} /> {t("addRoleBtn")}</button>
                )}
              </div>
              <p style={{ fontSize: 11, color: "var(--text-muted,#666)", margin: "0 0 14px", lineHeight: 1.6 }}>{t("positionsDesc")}</p>
              {positions.length === 0 && <p style={{ fontSize: 13, color: "#666", margin: 0 }}>{t("positionsEmpty")}</p>}
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {positions.map((pos, i) => {
                  const rph = (parseFloat(pos.dayRate) || 0) / (parseFloat(pos.hoursPerDay) || 12);
                  return (
                    <div key={pos.id} style={{ border: "1px solid #2e3340", borderRadius: 10, padding: 14, background: "rgba(255,255,255,0.02)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                        <span style={S.badge("amber")}>{t("roleLabel")} {i + 1}</span>
                        <div style={{ flex: 1 }} />
                        <button style={{ ...S.btn("danger"), padding: "5px 8px" }} onClick={() => removePosition(pos.id)}><Icon d={icons.trash} size={13} /></button>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        <div>
                          <label style={S.label}>{t("positionName")}</label>
                          <input style={S.input} value={pos.name} placeholder="e.g. 1st Steadicam Assistant" onChange={e => updatePosition(pos.id, { name: e.target.value })} />
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                          <div>
                            <label style={S.label}>{t("dayRateLabel")}</label>
                            <input style={S.input} type="number" min="0" inputMode="decimal" value={pos.dayRate} placeholder="4500" onChange={e => updatePosition(pos.id, { dayRate: e.target.value })} />
                          </div>
                          <div>
                            <label style={S.label}>{t("hoursPerDayLabel")}</label>
                            <input style={S.input} type="number" min="1" inputMode="decimal" value={pos.hoursPerDay} placeholder="12" onChange={e => updatePosition(pos.id, { hoursPerDay: e.target.value })} />
                          </div>
                        </div>
                        {parseFloat(pos.dayRate) > 0 && parseFloat(pos.hoursPerDay) > 0 && (
                          <p style={{ fontSize: 11, color: "var(--text-muted,#666)", margin: 0 }}>{t("hourlyRate")}: ฿{rph.toLocaleString(undefined, { maximumFractionDigits: 2 })}{t("perHr")}</p>
                        )}
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <label style={{ ...S.label, margin: 0 }}>{t("otLabel").replace("{h}", parseFloat(pos.hoursPerDay) || 12)}</label>
                          <div style={{ flex: 1 }} />
                          <button onClick={() => updatePosition(pos.id, { variableOT: !pos.variableOT })} style={{ ...S.btn(pos.variableOT ? "primary" : "ghost"), padding: "5px 10px", fontSize: 12 }}>
                            {pos.variableOT ? t("variableOT") : t("flatOT")}
                          </button>
                        </div>
                        {!pos.variableOT ? (
                          <div>
                            <label style={S.label}>{t("otMultiplierLabel")}</label>
                            <input style={{ ...S.input, maxWidth: 140 }} type="number" min="1" step="0.25" inputMode="decimal" value={pos.otMultiplier} placeholder="1.5" onChange={e => updatePosition(pos.id, { otMultiplier: e.target.value })} />
                          </div>
                        ) : (
                          <div>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                              <label style={{ ...S.label, margin: 0 }}>{t("otTiersLabel")}</label>
                              <button style={{ ...S.btn("ghost"), padding: "3px 8px", fontSize: 11 }} onClick={() => addTier(pos.id)}><Icon d={icons.plus} size={11} /> {t("addTierBtn")}</button>
                            </div>
                            {(pos.otTiers || []).map((tr, ti) => {
                              const from = ti === 0 ? (parseFloat(pos.hoursPerDay) || 12) : (parseFloat((pos.otTiers[ti - 1] || {}).untilHour) || 0);
                              return (
                                <div key={ti} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 32px", gap: 6, alignItems: "center", marginBottom: 6 }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                    <span style={{ fontSize: 11, color: "#666", whiteSpace: "nowrap" }}>{from}h–</span>
                                    <input style={{ ...S.input, padding: "7px 8px" }} type="number" min="0" inputMode="decimal" value={tr.untilHour} placeholder="14" onChange={e => updateTier(pos.id, ti, { untilHour: e.target.value })} />
                                    <span style={{ fontSize: 11, color: "#666" }}>h</span>
                                  </div>
                                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                    <input style={{ ...S.input, padding: "7px 8px" }} type="number" min="1" step="0.25" inputMode="decimal" value={tr.mult} placeholder="1.5" onChange={e => updateTier(pos.id, ti, { mult: e.target.value })} />
                                    <span style={{ fontSize: 11, color: "#666" }}>×</span>
                                  </div>
                                  <button style={{ ...S.btn("danger"), padding: "5px 6px", minWidth: 0 }} onClick={() => removeTier(pos.id, ti)}><Icon d={icons.x} size={12} /></button>
                                </div>
                              );
                            })}
                            <p style={{ fontSize: 10, color: "#555", margin: "2px 0 0" }}>{t("otTiersNote")}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Documents */}
            <div style={S.card}>
              <p style={S.sectionTitle}>{t("documents")}</p>
              <div style={S.col}>
                {/* ID Card */}
                <div>
                  <label style={S.label}>{t("idCard")}</label>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    {idCard && <img src={idCard} alt="ID" style={{ width: 100, height: 66, objectFit: "cover", borderRadius: 6, border: "1px solid #2e3340" }} />}
                    <input ref={idCardRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleDocUpload(setIdCard, { maxDim: 1400, quality: 0.72 })} />
                    <button style={S.btn("ghost")} onClick={() => idCardRef.current.click()}>
                      <Icon d={icons.photo} size={14} /> {idCard ? t("replacePhoto") : t("uploadPhoto")}
                    </button>
                    {idCard && <button style={{ ...S.btn("danger"), padding: "7px 10px" }} onClick={() => setIdCard(null)}><Icon d={icons.x} size={13} /></button>}
                  </div>
                </div>
                {/* PromptPay / Bank QR */}
                <div>
                  <label style={S.label}>{t("promptPayQR")}</label>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    {promptPayQR && <img src={promptPayQR} alt="QR" style={{ width: 80, height: 80, objectFit: "contain", borderRadius: 6, border: "1px solid #2e3340", background: "#fff" }} />}
                    <input ref={promptPayRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleDocUpload(setPromptPayQR, { maxDim: 1000, quality: 0.85 })} />
                    <button style={S.btn("ghost")} onClick={() => promptPayRef.current.click()}>
                      <Icon d={icons.photo} size={14} /> {promptPayQR ? t("replacePhoto") : t("uploadPhoto")}
                    </button>
                    {promptPayQR && <button style={{ ...S.btn("danger"), padding: "7px 10px" }} onClick={() => setPromptPayQR(null)}><Icon d={icons.x} size={13} /></button>}
                  </div>
                </div>
                {/* Bank Details */}
                <div>
                  <label style={S.label}>{t("bankDetails")}</label>
                  <div style={S.col}>
                    <input style={S.input} placeholder={t("bankNameLabel")} value={profileInfo.bankName} onChange={e => setProfileInfo(p => ({ ...p, bankName: e.target.value }))} />
                    <input style={S.input} placeholder={t("accountNameLabel")} value={profileInfo.accountName} onChange={e => setProfileInfo(p => ({ ...p, accountName: e.target.value }))} />
                    <input style={S.input} placeholder={t("accountNumberLabel")} value={profileInfo.bankAccount} onChange={e => setProfileInfo(p => ({ ...p, bankAccount: e.target.value }))} />
                  </div>
                </div>
                <div>
                  <label style={S.label}>Invoice Prefix</label>
                  <p style={{ fontSize: 11, color: "var(--text-muted,#666)", margin: "0 0 6px" }}>Used in invoice number: INV-<strong>XXXX</strong>-YY-####. Max 6 chars.</p>
                  <input style={{ ...S.input, textTransform: "uppercase" }} placeholder="e.g. KC" maxLength={6}
                    value={profileInfo.invoicePrefix}
                    onChange={e => setProfileInfo(p => ({ ...p, invoicePrefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") }))} />
                </div>
                {/* Signature */}
                <div>
                  <label style={S.label}>{t("signatureSection")}</label>
                  <p style={{ fontSize: 11, color: "var(--text-muted,#666)", margin: "0 0 8px" }}>{t("signatureHint")}</p>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    {signature && <img src={signature} alt="Signature" style={{ height: 50, maxWidth: 160, objectFit: "contain", borderRadius: 6, border: "1px solid #2e3340", background: "#fff", padding: 4 }} />}
                    <input ref={signatureRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => {
                      const f = e.target.files[0]; if (!f) return;
                      const r = new FileReader();
                      r.onload = (ev) => makeSignatureTransparent(ev.target.result).then(setSignature);
                      r.readAsDataURL(f);
                    }} />
                    <button style={S.btn("ghost")} onClick={() => signatureRef.current.click()}>
                      <Icon d={icons.photo} size={14} /> {signature ? t("replacePhoto") : t("uploadSignature")}
                    </button>
                    {signature && <button style={{ ...S.btn("danger"), padding: "7px 10px" }} onClick={() => setSignature(null)}><Icon d={icons.x} size={13} /></button>}
                  </div>
                </div>
              </div>
            </div>

            {/* PIN Change */}
            <div style={S.card}>
              <p style={S.sectionTitle}>{t("changePasscode")}</p>
              <div style={S.col}>
                <div>
                  <label style={S.label}>{t("newPinLabel")}</label>
                  <input style={S.input} type="password" inputMode="numeric" maxLength={6} value={pinChangeForm.newPin} onChange={e => setPinChangeForm(p => ({ ...p, newPin: e.target.value.replace(/\D/g, "") }))} placeholder="e.g. 5678" />
                </div>
                <div>
                  <label style={S.label}>{t("confirmPinLabel")}</label>
                  <input style={S.input} type="password" inputMode="numeric" maxLength={6} value={pinChangeForm.confirmPin} onChange={e => setPinChangeForm(p => ({ ...p, confirmPin: e.target.value.replace(/\D/g, "") }))} placeholder="Re-enter PIN" />
                </div>
                {pinChangeMsg && <p style={{ fontSize: 12, color: pinChangeMsg.ok ? "#34d399" : "#f87171", margin: 0 }}>{pinChangeMsg.text}</p>}
                <button style={{ ...S.btn("primary"), alignSelf: "flex-end" }} onClick={() => {
                  const { newPin, confirmPin } = pinChangeForm;
                  if (!/^\d{4,6}$/.test(newPin)) { setPinChangeMsg({ ok: false, text: "PIN must be 4–6 digits." }); return; }
                  if (newPin !== confirmPin) { setPinChangeMsg({ ok: false, text: "PINs do not match." }); return; }
                  setEmployees(p => p.map(e => e.id === employee.id ? { ...e, pin: newPin } : e));
                  setPinChangeForm({ newPin: "", confirmPin: "" });
                  setPinChangeMsg({ ok: true, text: "Passcode updated!" });
                  setTimeout(() => setPinChangeMsg(null), 3000);
                }}>{t("updatePasscode")}</button>
              </div>
            </div>

            {/* Calendar Sync */}
            <div style={S.card}>
              <p style={S.sectionTitle}>📅 {t("calendarSync")}</p>
              <div style={S.col}>
                <p style={{ fontSize: 13, color: "var(--text-muted,#666)", margin: 0, lineHeight: 1.7 }}>
                  Subscribe to the production schedule in your iPhone Calendar. Pencil jobs appear <strong style={{ color: "var(--text,#e8e4dc)" }}>tentative (striped)</strong>, Confirmed are <strong style={{ color: "#34d399" }}>solid</strong>. Updates hourly.
                </p>
                <div style={{ fontSize: 12, color: "var(--text-muted,#666)", lineHeight: 1.8 }}>
                  <strong style={{ color: "var(--text,#e8e4dc)", display: "block", marginBottom: 6 }}>iPhone setup:</strong>
                  1. <strong>Settings → Calendar → Accounts → Add Account → Other</strong><br />
                  2. Tap <strong>Add Subscribed Calendar</strong><br />
                  3. Paste the URL below → <strong>Next → Save</strong>
                </div>
                <code style={{ background: "rgba(232,184,75,0.1)", color: "var(--accent,#e8b84b)", padding: "6px 10px", borderRadius: 6, fontSize: 11, wordBreak: "break-all" }}>
                  https://pickshootreturn.pages.dev/api/calendar
                </code>
                <button style={{ ...S.btn("ghost"), alignSelf: "flex-start", fontSize: 12 }} onClick={() => navigator.clipboard?.writeText("https://pickshootreturn.pages.dev/api/calendar")}>
                  📋 Copy URL
                </button>
              </div>
            </div>

            {/* Save Profile */}
            <div style={{ position: "sticky", bottom: 16, zIndex: 10 }}>
              <button
                style={{ ...S.btn(profileSaveStatus === "saved" ? "success" : profileSaveStatus === "error" ? "danger" : "primary"), width: "100%", justifyContent: "center", padding: "15px", fontSize: 15, fontWeight: 700, opacity: profileSaveStatus === "saving" ? 0.75 : 1, boxShadow: "0 4px 24px rgba(0,0,0,0.5)" }}
                disabled={profileSaveStatus === "saving"}
                onClick={saveProfile}
              >
                {profileSaveStatus === "saving" ? t("profileSaving") : profileSaveStatus === "saved" ? t("profileSaved") : profileSaveStatus === "error" ? t("profileSaveFail") : t("profileSaveBtn")}
              </button>
            </div>

            {/* My recent activity — consolidated per job + pick/return */}
            <div style={S.card}>
              <p style={S.sectionTitle}>{t("recentActivity")}</p>
              {(() => {
                const mine = checkouts.filter(c => c.employeeId === employee.id);
                if (mine.length === 0) return <p style={{ fontSize: 13, color: "#666" }}>{t("noActivity")}</p>;
                const groups = {};
                mine.forEach(c => {
                  const kind = (c.type === "pick" || c.type === "checkout") ? "pick" : "return";
                  const key = `${c.jobId || c.jobName || "x"}|${kind}`;
                  if (!groups[key]) groups[key] = { key, jobName: c.jobName || "—", kind, items: [], latest: 0 };
                  groups[key].items.push(c);
                  if ((c.ts || 0) > groups[key].latest) groups[key].latest = c.ts || 0;
                });
                const list = Object.values(groups).sort((a, b) => b.latest - a.latest).slice(0, 10);
                return list.map((g, i, arr) => {
                  const open = !!expandedActivity[g.key];
                  return (
                    <div key={g.key} style={{ paddingBottom: i < arr.length - 1 ? 10 : 0, borderBottom: i < arr.length - 1 ? "1px solid #252830" : "none", marginBottom: i < arr.length - 1 ? 10 : 0 }}>
                      <div onClick={() => setExpandedActivity(p => ({ ...p, [g.key]: !p[g.key] }))} style={{ display: "flex", gap: 10, alignItems: "center", cursor: "pointer" }}>
                        <span style={{ ...S.badge(g.kind === "pick" ? "amber" : "green"), flexShrink: 0 }}>{g.kind === "pick" ? t("pickEvt") : t("returnEvt")}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>{g.jobName}</p>
                          <p style={{ margin: "2px 0 0", fontSize: 11, color: "#666" }}>{g.items.length} {g.items.length === 1 ? "item" : "items"} · {formatDateTime(g.latest)}</p>
                        </div>
                        <span style={{ color: "#666", fontSize: 14, flexShrink: 0, transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }}>›</span>
                      </div>
                      {open && (
                        <div style={{ marginTop: 8, paddingLeft: 10, borderLeft: "2px solid #252830", display: "flex", flexDirection: "column", gap: 6 }}>
                          {g.items.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0)).map((c, j) => {
                            const eq = equipment.find(e => e.id === c.eqId);
                            return (
                              <div key={j} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                {eq?.photo && <img src={eq.photo} alt="" style={{ width: 28, height: 24, objectFit: "cover", borderRadius: 4, flexShrink: 0 }} />}
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <p style={{ margin: 0, fontSize: 12, fontWeight: 600 }}>{eq?.name || c.eqName || "Unknown"}</p>
                                  <p style={{ margin: 0, fontSize: 10, color: "#555" }}>{formatDateTime(c.ts)}</p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        )}

        {/* INVOICE TAB */}
        {tab === "invoice" && (() => {
          const confirmedJobs = jobs.filter(j => j.status === "Confirmed").sort((a, b) => (b.dates[0] || "") > (a.dates[0] || "") ? 1 : -1);
          const allMyInvoices = invoices.filter(inv => inv.employeeId === employee.id);
          const filteredInvoices = allMyInvoices
            .filter(inv => (invFilter === "all" || (inv.status || "Pending") === invFilter) && (invDocType === "all" || (inv.docType || "invoice") === invDocType))
            .sort((a, b) => invSort === "amount" ? calcTotal(b) - calcTotal(a) : b.updatedAt - a.updatedAt);
          const myInvoices = filteredInvoices;

          const saveInvoice = (inv) => {
            setInvoices(p => {
              const idx = p.findIndex(i => i.id === inv.id);
              return idx >= 0 ? p.map(i => i.id === inv.id ? inv : i) : [...p, inv];
            });
            setInvoiceModal(null);
          };

          const delInvoice = (id) => {
            if (window.confirm("Delete this invoice?")) setInvoices(p => p.filter(i => i.id !== id));
          };

          return (
            <div style={S.col}>
              <div>
                <h1 style={{ ...S.pageTitle, fontSize: 18, marginBottom: 2 }}>{t("myInvoices")}</h1>
                <p style={{ ...S.pageSubtitle, marginBottom: 0, fontSize: 12 }}>{allMyInvoices.length} invoices · ฿{allMyInvoices.reduce((s, inv) => s + calcTotal(inv), 0).toLocaleString()} total</p>
              </div>

              {/* Revenue Summary */}
              {(() => {
                const allYears = [...new Set(allMyInvoices.map(inv => new Date(inv.createdAt || inv.updatedAt).getFullYear().toString()))].sort((a,b)=>b-a);
                const revInvs = allMyInvoices.filter(inv => {
                  const d = new Date(inv.createdAt || inv.updatedAt);
                  if (revPeriod === "year") return d.getFullYear().toString() === revYear;
                  if (revPeriod === "custom") {
                    const ds = d.toISOString().slice(0,10);
                    return (!revFrom || ds >= revFrom) && (!revTo || ds <= revTo);
                  }
                  return true;
                });
                const revTotal = revInvs.reduce((s, inv) => s + calcTotal(inv), 0);
                const revPaid = revInvs.filter(i => (i.status || "Pending") === "Paid").reduce((s, inv) => s + calcTotal(inv), 0);
                return (
                  <div style={S.card}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                      <p style={{ ...S.sectionTitle, margin: 0 }}>Revenue</p>
                      <div style={{ display: "flex", gap: 6 }}>
                        {[["all","All"],["year","By Year"],["custom","Custom"]].map(([k,lbl]) => (
                          <button key={k} style={{ ...S.btn(revPeriod===k?"primary":"ghost"), padding:"4px 9px", fontSize:10 }} onClick={() => setRevPeriod(k)}>{lbl}</button>
                        ))}
                      </div>
                    </div>
                    {revPeriod === "year" && (
                      <select style={{ ...S.select, marginBottom: 10 }} value={revYear} onChange={e => setRevYear(e.target.value)}>
                        {allYears.map(y => <option key={y} value={y}>{y}</option>)}
                      </select>
                    )}
                    {revPeriod === "custom" && (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
                        <div><label style={S.label}>From</label><input style={S.input} type="date" value={revFrom} onChange={e => setRevFrom(e.target.value)} /></div>
                        <div><label style={S.label}>To</label><input style={S.input} type="date" value={revTo} onChange={e => setRevTo(e.target.value)} /></div>
                      </div>
                    )}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      <div style={{ background: "rgba(232,184,75,0.06)", borderRadius: 8, padding: "10px 14px" }}>
                        <p style={{ margin: 0, fontSize: 9, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "#666" }}>Total Invoiced</p>
                        <p style={{ margin: "4px 0 0", fontSize: 20, fontWeight: 800, color: "var(--accent,#e8b84b)" }}>฿{revTotal.toLocaleString()}</p>
                        <p style={{ margin: "2px 0 0", fontSize: 10, color: "#666" }}>{revInvs.length} invoice{revInvs.length !== 1 ? "s" : ""}</p>
                      </div>
                      <div style={{ background: "rgba(52,211,153,0.06)", borderRadius: 8, padding: "10px 14px" }}>
                        <p style={{ margin: 0, fontSize: 9, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "#666" }}>Paid</p>
                        <p style={{ margin: "4px 0 0", fontSize: 20, fontWeight: 800, color: "#34d399" }}>฿{revPaid.toLocaleString()}</p>
                        <p style={{ margin: "2px 0 0", fontSize: 10, color: "#666" }}>฿{(revTotal - revPaid).toLocaleString()} pending</p>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Filter/Sort row */}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                {["all", "Pending", "Paid"].map(f => (
                  <button key={f} style={{ ...S.btn(invFilter === f ? "primary" : "ghost"), padding: "5px 12px", fontSize: 11 }} onClick={() => setInvFilter(f)}>
                    {f === "all" ? "All" : f}
                  </button>
                ))}
                <div style={{ flex: 1 }} />
                <button style={{ ...S.btn(invSort === "date" ? "primary" : "ghost"), padding: "5px 12px", fontSize: 11 }} onClick={() => setInvSort("date")}>Latest</button>
                <button style={{ ...S.btn(invSort === "amount" ? "primary" : "ghost"), padding: "5px 12px", fontSize: 11 }} onClick={() => setInvSort("amount")}>Amount ↓</button>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {[["all","All"],["invoice","INV"],["quotation","QUO"],["receipt","RTX"]].map(([k,lbl]) => (
                  <button key={k} style={{ ...S.btn(invDocType === k ? "primary" : "ghost"), padding: "4px 10px", fontSize: 11 }} onClick={() => setInvDocType(k)}>{lbl}</button>
                ))}
              </div>

              {/* Production House request */}
              <div style={S.card}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <p style={{ ...S.sectionTitle, margin: 0 }}>Production Houses</p>
                  <button style={{ ...S.btn("ghost"), padding: "5px 10px", fontSize: 12 }} onClick={() => { setShowAdminReqModal("production-house"); setAdminReqForm({ name: "", address: "" }); setAdminReqMsg(null); }}>+ Request</button>
                </div>
                {(() => {
                  const myProdReqs = (adminRequests || []).filter(r => r.employeeId === employee.id && r.type === "production-house").slice().reverse();
                  if (myProdReqs.length === 0) return <p style={{ fontSize: 12, color: "#555", marginTop: 8 }}>No requests yet. Add a production company to use in invoices.</p>;
                  return (
                    <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                      {myProdReqs.map(req => (
                        <div key={req.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={S.badge(req.status === "approved" ? "green" : req.status === "rejected" ? "red" : "amber")}>{req.status}</span>
                          <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{req.name}</p>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>

              {/* Confirmed jobs to invoice */}
              <div style={S.card}>
                <p style={S.sectionTitle}>{t("confirmJobs")}</p>
                {confirmedJobs.length === 0
                  ? <p style={{ fontSize: 13, color: "var(--text-muted,#666)" }}>No confirmed jobs.</p>
                  : confirmedJobs.map(job => {
                    const hasInvoice = myInvoices.some(inv => inv.jobId === job.id);
                    return (
                      <div key={job.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--divider-color,#1e2030)" }}>
                        <div style={{ flex: 1 }}>
                          <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{job.name}</p>
                          <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-muted,#666)" }}>{job.production} · {(job.dates || []).slice(0, 2).map(d => new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })).join(", ")}</p>
                        </div>
                        {hasInvoice
                          ? <span style={S.badge("green")}>✓ Invoiced</span>
                          : <button style={{ ...S.btn("primary"), padding: "5px 10px", fontSize: 11 }} onClick={() => setInvoiceModal({ job, existing: null })}>
                              <Icon d={icons.invoice} size={13} /> {t("createInvoice")}
                            </button>
                        }
                      </div>
                    );
                  })
                }
              </div>

              {/* My saved invoices */}
              {myInvoices.length === 0 ? (
                <div style={{ ...S.card, textAlign: "center", padding: 32 }}>
                  <p style={{ color: "var(--text-muted,#666)", fontSize: 13 }}>{invFilter === "all" ? "No invoices yet." : `No ${invFilter} invoices.`}</p>
                </div>
              ) : (
                <div style={S.col}>
                  {myInvoices.map(inv => {
                    const total = calcTotal(inv);
                    const isPaid = (inv.status || "Pending") === "Paid";
                    const isExpanded = expandedInv === inv.id;
                    const itemList = inv.items?.length ? inv.items : [
                      { description: "Labor Fee", qty: 1, rate: inv.laborFee },
                      { description: "Overtime", qty: 1, rate: inv.overtime },
                      { description: "Travel Fee", qty: 1, rate: inv.travelFee },
                      { description: "Per Diem", qty: 1, rate: inv.perDiem },
                    ].filter(it => parseFloat(it.rate) > 0);
                    return (
                      <div key={inv.id} style={{ ...S.card, border: isPaid ? "1px solid rgba(52,211,153,0.25)" : "var(--card-border,1px solid #252830)" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }} onClick={() => setExpandedInv(isExpanded ? null : inv.id)}>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 3 }}>
                              <span style={{ ...S.badge(isPaid ? "green" : "amber"), fontSize: 10 }}>{inv.status || "Pending"}</span>
                              <p style={{ margin: 0, fontSize: 11, color: "var(--text-muted,#666)", fontFamily: "monospace" }}>{fmtInvoiceNo(inv)}</p>
                            </div>
                            <p style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{inv.jobName}</p>
                            <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--text-muted,#666)" }}>{inv.position || "—"}</p>
                          </div>
                          <div style={{ textAlign: "right", flexShrink: 0 }}>
                            <p style={{ margin: 0, fontWeight: 800, fontSize: 16, color: "var(--accent,#e8b84b)" }}>฿{total.toLocaleString()}</p>
                            <p style={{ margin: "3px 0 0", fontSize: 10, color: "var(--text-muted,#666)" }}>{new Date(inv.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</p>
                          </div>
                          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" style={{ transform: isExpanded ? "rotate(90deg)" : "none", transition: "transform 0.2s", opacity: 0.4, marginLeft: 8 }}><path d="M9 18l6-6-6-6" /></svg>
                        </div>
                        {isExpanded && (
                          <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--divider-color,#252830)" }}>
                            {/* Line items */}
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 40px 80px 80px", gap: "4px 8px", marginBottom: 10 }}>
                              {["Description", "Qty", "Rate", "Total"].map((h, i) => (
                                <div key={h} style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text-muted,#666)", textAlign: i > 0 ? "right" : "left", paddingBottom: 4, borderBottom: "1px solid var(--divider-color,#252830)" }}>{h}</div>
                              ))}
                              {itemList.map((it, idx) => {
                                const qty = parseFloat(it.qty) || 0;
                                const rate = parseFloat((it.rate || "").toString().replace(/,/g, "")) || 0;
                                return [
                                  <div key={idx + "d"} style={{ fontSize: 12 }}>{it.description}</div>,
                                  <div key={idx + "q"} style={{ fontSize: 12, textAlign: "right" }}>{qty % 1 === 0 ? qty : qty.toFixed(2)}</div>,
                                  <div key={idx + "r"} style={{ fontSize: 12, textAlign: "right" }}>฿{rate.toLocaleString()}</div>,
                                  <div key={idx + "t"} style={{ fontSize: 12, fontWeight: 600, textAlign: "right" }}>฿{(qty * rate).toLocaleString()}</div>,
                                ];
                              })}
                            </div>
                            <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10, paddingTop: 8, borderTop: "1px solid var(--divider-color,#252830)", marginBottom: 14 }}>
                              <span style={{ fontSize: 12, color: "var(--text-muted,#666)" }}>Total</span>
                              <span style={{ fontSize: 18, fontWeight: 800, color: "var(--accent,#e8b84b)" }}>฿{total.toLocaleString()}</span>
                            </div>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              <button style={{ ...S.btn("ghost"), fontSize: 12, padding: "6px 10px" }} onClick={() => setInvoiceModal({ job: null, existing: inv })}>
                                <Icon d={icons.edit} size={13} /> Edit
                              </button>
                              <button style={{ ...S.btn("ghost"), fontSize: 12, padding: "6px 10px" }} onClick={() => printInvoice({ invoice: inv, employee, profileInfo, promptPayQR, idCard, signature, productionCompanies, companyName, print: false })}>
                                👁 View
                              </button>
                              <button style={{ ...S.btn("primary"), fontSize: 12, padding: "6px 10px" }} onClick={() => printInvoice({ invoice: inv, employee, profileInfo, promptPayQR, idCard, signature, productionCompanies, companyName })}>
                                🖨 Print
                              </button>
                              {lineGroupId && (
                                <button
                                  disabled={invSending === inv.id}
                                  style={{ ...S.btn("ghost"), fontSize: 12, padding: "6px 10px", opacity: invSending === inv.id ? 0.6 : 1 }}
                                  onClick={async () => {
                                    setInvSending(inv.id);
                                    try {
                                      const html = buildInvoiceHTML({ invoice: inv, employee, profileInfo, promptPayQR, idCard, signature, productionCompanies, companyName, autoPrint: false });
                                      const { key } = await api.shareInvoice(html);
                                      const shareUrl = `https://pickshootreturn.pages.dev/api/invoice-view/${key}`;
                                      const name = profileInfo.firstName ? `${profileInfo.firstName} ${profileInfo.lastName || ""}`.trim() : employee.name;
                                      const total = calcTotal(inv);
                                      const msg = `🧾 Invoice — ${name}\n📄 ${fmtInvoiceNo(inv)}\n🎬 ${inv.jobName || "—"}${inv.productionCompany ? ` · ${inv.productionCompany}` : ""}\n💰 ฿${total.toLocaleString()}\n📋 ${inv.status || "Pending"}\n🔗 ${shareUrl}`;
                                      await api.notify({ userIds: [lineGroupId], message: msg });
                                    } catch {}
                                    setInvSending(null);
                                  }}>
                                  {invSending === inv.id ? "Sending…" : "💬 Send to Group"}
                                </button>
                              )}
                              <button style={{ ...S.btn(isPaid ? "ghost" : "success"), fontSize: 12, padding: "6px 10px" }} onClick={() => setInvoices(p => p.map(i => i.id === inv.id ? { ...i, status: isPaid ? "Pending" : "Paid" } : i))}>
                                {isPaid ? "Mark Pending" : "Mark Paid"}
                              </button>
                              <button style={{ ...S.btn("danger"), fontSize: 12, padding: "6px 10px" }} onClick={() => delInvoice(inv.id)}>
                                <Icon d={icons.trash} size={13} />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {invoiceModal && (
                <InvoiceCreateModal
                  job={invoiceModal.job}
                  existingInvoice={invoiceModal.existing}
                  employee={{ ...employee, invoicePrefix: profileInfo.invoicePrefix }}
                  positions={positions}
                  onSave={saveInvoice}
                  onClose={() => setInvoiceModal(null)}
                  allInvoices={invoices}
                  companyName={companyName}
                  invoicePresets={invoicePresets}
                  productionCompanies={productionCompanies}
                  jobs={jobs}
                  adminRequests={adminRequests}
                />
              )}
            </div>
          );
        })()}
      </div>

      {/* Employee Bottom Nav */}
      <nav style={{
        position: "fixed", bottom: 0, left: 0, right: 0, height: 62,
        background: "#161920", borderTop: "1px solid #252830",
        display: "flex", alignItems: "stretch", zIndex: 100,
        padding: "0 4px", paddingBottom: "env(safe-area-inset-bottom,0px)",
      }}>
        {[
          { key: "today", label: t("tabToday"), icon: icons.calendar },
          { key: "profile", label: t("tabProfile"), icon: icons.user },
          { key: "gear", label: "Gear", icon: icons.camera },
          { key: "invoice", label: t("tabInvoice"), icon: icons.invoice },
        ].map(tItem => {
          const active = tab === tItem.key;
          return (
            <button key={tItem.key} onClick={() => setTab(tItem.key)} style={{
              flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              gap: 3, border: "none", cursor: "pointer", background: "transparent",
              color: active ? "#e8b84b" : "#666", position: "relative", padding: "8px 2px 6px",
            }}>
              {active && <div style={{ position: "absolute", top: 0, left: "25%", right: "25%", height: 2, background: "#e8b84b", borderRadius: "0 0 3px 3px" }} />}
              <Icon d={tItem.icon} size={20} color={active ? "#e8b84b" : "#666"} />
              <span style={{ fontSize: 9.5, fontWeight: active ? 700 : 500, letterSpacing: "0.02em" }}>{tItem.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

// ─── REPORT MODAL (employee submits a damage report) ─────────────────────────
function ReportModal({ employee, equipment, onSubmit, onClose }) {
  const t = useT();
  const [photos, setPhotos] = useState([]);
  const [description, setDescription] = useState("");
  const [incidentTs, setIncidentTs] = useState(() => {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  const [eqId, setEqId] = useState("");
  const [customEqName, setCustomEqName] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const camRef = useRef(null);
  const galRef = useRef(null);

  const addPhotos = (e) => {
    Array.from(e.target.files).forEach(f => {
      compressImage(f, { maxDim: 1200, quality: 0.72 }).then(d => d && setPhotos(p => [...p, d]));
    });
    e.target.value = "";
  };

  const submit = () => {
    if (!description.trim()) return;
    const eq = equipment.find(e => e.id === eqId);
    onSubmit({
      id: "rep" + Date.now(),
      eqId: eqId === "" || eqId === "other" ? null : eqId,
      eqName: eqId === "other" ? customEqName.trim() : (eq?.name || ""),
      description: description.trim(),
      photos,
      ts: new Date(incidentTs).getTime() || Date.now(),
      reportedBy: { id: employee.id, name: employee.name },
      status: "open",
      resolvedAt: null,
    });
    setSubmitted(true);
  };

  if (submitted) return (
    <Modal title={t("reportNew")} onClose={onClose}>
      <div style={{ textAlign: "center", padding: "24px 0" }}>
        <div style={{ fontSize: 52, marginBottom: 12 }}>✅</div>
        <p style={{ fontSize: 16, fontWeight: 700, color: "#34d399", marginBottom: 8 }}>{t("reportSubmitted")}</p>
        <button style={{ ...S.btn("primary"), marginTop: 16 }} onClick={onClose}>{t("back")}</button>
      </div>
    </Modal>
  );

  return (
    <Modal title={t("reportNew")} onClose={onClose}>
      <div style={S.col}>
        <div>
          <label style={S.label}>{t("reportDate")}</label>
          <input type="datetime-local" style={S.input} value={incidentTs} onChange={e => setIncidentTs(e.target.value)} />
        </div>

        <div>
          <label style={S.label}>{t("reportEquipment")}</label>
          <select style={S.select} value={eqId} onChange={e => setEqId(e.target.value)}>
            <option value="">{t("reportNoEquipment")}</option>
            {equipment.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            <option value="other">{t("reportOther")}</option>
          </select>
          {eqId === "other" && (
            <input style={{ ...S.input, marginTop: 8 }} value={customEqName} onChange={e => setCustomEqName(e.target.value)} placeholder={t("reportOtherName")} autoFocus />
          )}
        </div>

        <div>
          <label style={S.label}>{t("reportDescription")}</label>
          <textarea style={{ ...S.input, minHeight: 90, resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }} value={description} onChange={e => setDescription(e.target.value)} />
        </div>

        <div>
          <label style={S.label}>{t("reportPhotos")}</label>
          <input ref={camRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={addPhotos} />
          <input ref={galRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={addPhotos} />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
            {photos.map((p, i) => (
              <div key={i} style={{ position: "relative" }}>
                <img src={p} alt="" style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 8, display: "block", border: "2px solid #e8b84b" }} />
                <button onClick={() => setPhotos(ps => ps.filter((_, j) => j !== i))} style={{ position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: "50%", background: "#f87171", border: "2px solid #0f1117", color: "#fff", fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1, padding: 0 }}>×</button>
              </div>
            ))}
            <button style={{ ...S.btn("ghost"), flexDirection: "column", gap: 3, width: 72, height: 72, borderRadius: 8, border: "2px dashed #2e3340", fontSize: 10, fontWeight: 600 }} onClick={() => camRef.current.click()}>
              <Icon d={icons.camera} size={20} color="#555" />{t("reportCamera")}
            </button>
            <button style={{ ...S.btn("ghost"), flexDirection: "column", gap: 3, width: 72, height: 72, borderRadius: 8, border: "2px dashed #2e3340", fontSize: 10, fontWeight: 600 }} onClick={() => galRef.current.click()}>
              <Icon d={icons.photo} size={20} color="#555" />{t("reportGallery")}
            </button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button style={S.btn("ghost")} onClick={onClose}>{t("cancel")}</button>
          <button style={{ ...S.btn("primary"), opacity: description.trim() ? 1 : 0.4 }} onClick={submit} disabled={!description.trim()}>{t("reportSubmit")}</button>
        </div>
      </div>
    </Modal>
  );
}

// ─── ADMIN REPORTS PAGE ───────────────────────────────────────────────────────
function AdminReportsPage({ reports, setReports, equipment }) {
  const t = useT();
  const [filter, setFilter] = useState("open");
  const [expandedId, setExpandedId] = useState(null);

  const resolve = (id, status) =>
    setReports(p => p.map(r => r.id === id ? { ...r, status, resolvedAt: Date.now() } : r));

  const statusBadge = (status) =>
    ({ open: <span style={S.badge("red")}>{t("reportStatusOpen")}</span>, solved: <span style={S.badge("green")}>{t("reportStatusSolved")}</span>, discarded: <span style={S.badge("gray")}>{t("reportStatusDiscarded")}</span> }[status] || null);

  const filtered = (filter === "open" ? reports.filter(r => r.status === "open") : reports).sort((a, b) => b.ts - a.ts);
  const openCount = reports.filter(r => r.status === "open").length;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24, gap: 12 }}>
        <div>
          <h1 style={S.pageTitle}>{t("reportTitle")}</h1>
          <p style={{ ...S.pageSubtitle, color: openCount > 0 ? "#f87171" : "#666" }}>{openCount} {t("reportUnresolved")}</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <button style={{ ...S.btn(filter === "open" ? "primary" : "ghost"), padding: "7px 14px", fontSize: 12 }} onClick={() => setFilter("open")}>{t("reportStatusOpen")}</button>
          <button style={{ ...S.btn(filter === "all" ? "primary" : "ghost"), padding: "7px 14px", fontSize: 12 }} onClick={() => setFilter("all")}>{t("reportAll")}</button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div style={{ ...S.card, textAlign: "center", padding: 40 }}>
          <Icon d={icons.alert} size={40} color="#2e3340" />
          <p style={{ color: "#666", marginTop: 12 }}>{t("reportNone")}</p>
        </div>
      ) : (
        <div style={S.col}>
          {filtered.map(r => {
            const eq = r.eqId ? equipment.find(e => e.id === r.eqId) : null;
            const open = expandedId === r.id;
            return (
              <div key={r.id} style={{ ...S.card, border: r.status === "open" ? "1px solid rgba(239,68,68,0.35)" : "1px solid #252830" }}>
                <div style={{ display: "flex", gap: 12, alignItems: "flex-start", cursor: "pointer" }} onClick={() => setExpandedId(open ? null : r.id)}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap", alignItems: "center" }}>
                      {statusBadge(r.status)}
                      {(eq || r.eqName) && <span style={S.tag}>{eq?.name || r.eqName}</span>}
                    </div>
                    <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#e8e4dc", lineHeight: 1.4 }}>{r.description}</p>
                    <p style={{ margin: "5px 0 0", fontSize: 11, color: "#666" }}>{t("reportBy")} <strong style={{ color: "#8a8f9d" }}>{r.reportedBy?.name}</strong> · {formatDateTime(r.ts)}</p>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0, alignItems: "center" }}>
                    {r.photos?.length > 0 && <img src={r.photos[0]} alt="" style={{ width: 52, height: 52, objectFit: "cover", borderRadius: 8 }} />}
                    {r.photos?.length > 1 && <span style={S.badge("gray")}>+{r.photos.length - 1}</span>}
                    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth={2.5} strokeLinecap="round" style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </div>
                </div>

                {open && (
                  <div style={{ marginTop: 16 }}>
                    <div style={S.divider} />
                    {r.photos?.length > 0 && (
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
                        {r.photos.map((ph, i) => <img key={i} src={ph} alt="" style={{ width: 100, height: 100, objectFit: "cover", borderRadius: 8 }} />)}
                      </div>
                    )}
                    {r.status === "open" ? (
                      <div style={{ display: "flex", gap: 8 }}>
                        <button style={S.btn("success")} onClick={() => resolve(r.id, "solved")}>
                          <Icon d={icons.check} size={14} /> {t("reportSolve")}
                        </button>
                        <button style={S.btn("danger")} onClick={() => resolve(r.id, "discarded")}>
                          <Icon d={icons.x} size={14} /> {t("reportDiscard")}
                        </button>
                      </div>
                    ) : (
                      <p style={{ fontSize: 12, color: "#666" }}>{r.status === "solved" ? t("reportStatusSolved") : t("reportStatusDiscarded")} · {r.resolvedAt ? formatDateTime(r.resolvedAt) : ""}</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────
function Login({ onLogin, employees, companyName, adminPin, adminRequests, setAdminRequests }) {
  const t = useT();
  const [mode, setMode] = useState("choose"); // choose | admin | employee | register
  const [pin, setPin] = useState("");
  const [selectedEmp, setSelectedEmp] = useState(null);
  const [error, setError] = useState("");
  const [ddOpen, setDdOpen] = useState(false);
  const [regForm, setRegForm] = useState({ name: "", pin: "", confirm: "" });
  const [regMsg, setRegMsg] = useState(null);
  const failedAttempts = useRef([]); // timestamps of recent failures
  const [lockUntil, setLockUntil] = useState(0);
  const [lockSecsLeft, setLockSecsLeft] = useState(0);

  useEffect(() => {
    if (lockUntil <= Date.now()) return;
    setLockSecsLeft(Math.ceil((lockUntil - Date.now()) / 1000));
    const iv = setInterval(() => {
      const left = Math.ceil((lockUntil - Date.now()) / 1000);
      if (left <= 0) { setLockUntil(0); setLockSecsLeft(0); clearInterval(iv); }
      else setLockSecsLeft(left);
    }, 500);
    return () => clearInterval(iv);
  }, [lockUntil]);

  const isLocked = Date.now() < lockUntil;

  const recordFailure = () => {
    const now = Date.now();
    failedAttempts.current = [...failedAttempts.current, now].filter(t => now - t < 60000);
    if (failedAttempts.current.length >= 5) {
      const lockEnd = failedAttempts.current[0] + 60000;
      setLockUntil(lockEnd);
      failedAttempts.current = [];
    }
  };

  const tryLogin = () => {
    if (isLocked) return;
    if (mode === "admin") {
      if (pin === adminPin) { onLogin({ role: "admin" }); }
      else { recordFailure(); setError(t("loginIncorrectPin")); setPin(""); }
    } else if (mode === "employee" && selectedEmp) {
      const emp = employees.find(e => e.id === selectedEmp);
      if (pin === emp.pin) { onLogin({ role: "employee", ...emp }); }
      else { recordFailure(); setError(t("loginIncorrectPin")); setPin(""); }
    }
  };

  const addDigit = (d) => { if (!isLocked && pin.length < 6) setPin(p => p + d); setError(""); };
  const del = () => { if (!isLocked) setPin(p => p.slice(0, -1)); };

  if (mode === "choose") return (
    <div style={{ minHeight: "100vh", background: "#0f1117", display: "flex", alignItems: "center", justifyContent: "center", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, backgroundImage: "url(/logo.png)", backgroundRepeat: "no-repeat", backgroundPosition: "center", backgroundSize: "min(92vw, 620px)", opacity: 0.06, pointerEvents: "none" }} />
      <div style={{ textAlign: "center", maxWidth: 340 }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}><Icon d={icons.film} size={48} color="#e8b84b" /></div>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: "#e8e4dc", marginBottom: 4 }}>{companyName || "GEAR DESK"}</h1>
        <p style={{ color: "#666", marginBottom: 40, fontSize: 13, letterSpacing: "0.1em", textTransform: "uppercase" }}>{t("loginSystem")}</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <button style={{ ...S.btn("primary"), justifyContent: "center", padding: "14px 24px", fontSize: 15 }} onClick={() => setMode("admin")}><Icon d={icons.lock} size={16} /> {t("loginAdmin")}</button>
          <button style={{ ...S.btn("ghost"), justifyContent: "center", padding: "14px 24px", fontSize: 15 }} onClick={() => setMode("employee")}><Icon d={icons.user} size={16} /> {t("loginEmployee")}</button>
          <button style={{ background: "none", border: "none", color: "#555", fontSize: 12, cursor: "pointer", marginTop: 8, textDecoration: "underline" }} onClick={() => { setMode("register"); setRegForm({ name: "", pin: "", confirm: "" }); setRegMsg(null); }}>{t("loginRegisterLink")}</button>
        </div>
      </div>
    </div>
  );

  if (mode === "register") return (
    <div style={{ minHeight: "100vh", background: "#0f1117", display: "flex", alignItems: "center", justifyContent: "center", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, backgroundImage: "url(/logo.png)", backgroundRepeat: "no-repeat", backgroundPosition: "center", backgroundSize: "min(92vw, 620px)", opacity: 0.06, pointerEvents: "none" }} />
      <div style={{ width: 300 }}>
        <button style={{ ...S.btn("ghost"), marginBottom: 24, fontSize: 12 }} onClick={() => setMode("choose")}><Icon d={icons.arrow_left} size={14} /> {t("back")}</button>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{t("loginRegisterTitle")}</h2>
        <p style={{ fontSize: 12, color: "#555", marginBottom: 20 }}>{t("loginRegisterDesc")}</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={S.label}>{t("loginYourName")}</label>
            <input style={S.input} value={regForm.name} onChange={e => setRegForm(p => ({ ...p, name: e.target.value }))} placeholder={t("loginFullName")} />
          </div>
          <div>
            <label style={S.label}>{t("loginDesiredPin")}</label>
            <input style={S.input} type="password" inputMode="numeric" maxLength={6} value={regForm.pin} onChange={e => setRegForm(p => ({ ...p, pin: e.target.value.replace(/\D/g, "") }))} placeholder="e.g. 5678" />
          </div>
          <div>
            <label style={S.label}>{t("settingsConfirmPin")}</label>
            <input style={S.input} type="password" inputMode="numeric" maxLength={6} value={regForm.confirm} onChange={e => setRegForm(p => ({ ...p, confirm: e.target.value.replace(/\D/g, "") }))} placeholder={t("settingsPinReEnter")} />
          </div>
          {regMsg && <p style={{ fontSize: 12, color: regMsg.ok ? "#34d399" : "#f87171", margin: 0 }}>{regMsg.text}</p>}
          <button style={{ ...S.btn("primary"), justifyContent: "center", padding: "13px" }} onClick={() => {
            if (!regForm.name.trim()) { setRegMsg({ ok: false, text: t("loginEnterName") }); return; }
            if (!/^\d{4,6}$/.test(regForm.pin)) { setRegMsg({ ok: false, text: t("loginPinDigits") }); return; }
            if (regForm.pin !== regForm.confirm) { setRegMsg({ ok: false, text: t("loginPinMatch") }); return; }
            const already = (adminRequests || []).some(r => r.type === "member-register" && r.status === "pending" && r.name.toLowerCase() === regForm.name.trim().toLowerCase());
            if (already) { setRegMsg({ ok: false, text: t("loginPendingExists") }); return; }
            setAdminRequests(p => [...(p || []), { id: "ar" + Date.now(), type: "member-register", status: "pending", submittedAt: new Date().toISOString(), name: regForm.name.trim(), requestedPin: regForm.pin }]);
            setRegMsg({ ok: true, text: t("loginRequestSent") });
            setRegForm({ name: "", pin: "", confirm: "" });
          }}>{t("loginSendRequest")}</button>
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#0f1117", display: "flex", alignItems: "center", justifyContent: "center", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, backgroundImage: "url(/logo.png)", backgroundRepeat: "no-repeat", backgroundPosition: "center", backgroundSize: "min(92vw, 620px)", opacity: 0.06, pointerEvents: "none" }} />
      <div style={{ width: 300 }}>
        <button style={{ ...S.btn("ghost"), marginBottom: 24, fontSize: 12 }} onClick={() => { setMode("choose"); setPin(""); setError(""); setSelectedEmp(null); }}><Icon d={icons.arrow_left} size={14} /> {t("back")}</button>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{mode === "admin" ? t("loginAdmin") : t("loginEmployee")}</h2>
        {mode === "employee" && (() => {
          const selEmp = employees.find(e => e.id === selectedEmp);
          return (
            <div style={{ marginBottom: 20, position: "relative" }}>
              <label style={S.label}>{t("loginAccount")}</label>
              <button
                onClick={() => setDdOpen(o => !o)}
                style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 14px", background: "#1a1e27", border: `1px solid ${ddOpen ? "#e8b84b" : "#2e3340"}`, borderRadius: 10, color: selEmp ? "#e8e4dc" : "#555", fontSize: 14, fontWeight: selEmp ? 600 : 400, cursor: "pointer", transition: "border-color .15s" }}>
                <span>{selEmp ? selEmp.name : t("loginSelectAccount")}</span>
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" style={{ opacity: 0.5, transform: ddOpen ? "rotate(180deg)" : "none", transition: "transform .2s" }}><path d="M6 9l6 6 6-6" /></svg>
              </button>
              {ddOpen && (
                <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: "#1a1e27", border: "1px solid #2e3340", borderRadius: 10, overflow: "hidden", zIndex: 50, boxShadow: "0 8px 24px rgba(0,0,0,.5)" }}>
                  {employees.map((e, i) => (
                    <div key={e.id} onClick={() => { setSelectedEmp(e.id); setDdOpen(false); }}
                      style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", cursor: "pointer", background: selectedEmp === e.id ? "rgba(232,184,75,0.1)" : "transparent", borderTop: i > 0 ? "1px solid #252830" : "none" }}>
                      <div style={{ width: 28, height: 28, borderRadius: "50%", background: selectedEmp === e.id ? "rgba(232,184,75,0.15)" : "#252830", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: selectedEmp === e.id ? "#e8b84b" : "#666" }}>{e.name[0].toUpperCase()}</span>
                      </div>
                      <span style={{ fontWeight: 600, color: selectedEmp === e.id ? "#e8b84b" : "#e8e4dc", fontSize: 14 }}>{e.name}</span>
                      {selectedEmp === e.id && <svg style={{ marginLeft: "auto" }} width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#e8b84b" strokeWidth={3} strokeLinecap="round"><path d="M20 6L9 17l-5-5" /></svg>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}
        <div style={{ marginBottom: 16 }}>
          <label style={S.label}>PIN</label>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", alignItems: "center", height: 32, marginBottom: 16 }}>
            {pin.length === 0
              ? <span style={{ fontSize: 12, color: "#444", letterSpacing: "0.08em", textTransform: "uppercase" }}>{t("loginPinPrompt")}</span>
              : Array.from({ length: pin.length }).map((_, i) => (
                  <div key={i} style={{ width: 11, height: 11, borderRadius: "50%", background: "#e8b84b" }} />
                ))
            }
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
            {[1,2,3,4,5,6,7,8,9,"","0","⌫"].map((d, i) => (
              <button key={i} style={{ padding: "14px", borderRadius: 8, border: "1px solid #2e3340", background: d === "" ? "transparent" : "#1a1e27", color: "#e8e4dc", fontSize: 18, fontWeight: 600, cursor: d === "" ? "default" : "pointer" }}
                onClick={() => { if (d === "⌫") del(); else if (d !== "") addDigit(String(d)); }}>
                {d}
              </button>
            ))}
          </div>
        </div>
        {isLocked
          ? <p style={{ color: "#f87171", fontSize: 13, textAlign: "center", marginBottom: 12 }}>{t("loginTooManyAttempts")}{lockSecsLeft}{t("loginSeconds")}</p>
          : error && <p style={{ color: "#f87171", fontSize: 13, textAlign: "center", marginBottom: 12 }}>{error}</p>
        }
        <button style={{ ...S.btn("primary"), width: "100%", justifyContent: "center", padding: "12px", opacity: isLocked ? 0.5 : 1 }} onClick={tryLogin} disabled={isLocked || (mode === "employee" && !selectedEmp)}>
          {isLocked ? `${t("loginLocked")} (${lockSecsLeft}${t("loginSeconds")})` : t("loginUnlock")}
        </button>

      </div>
    </div>
  );
}

// ─── TEAM PAGE ────────────────────────────────────────────────────────────────
function TeamPage({ employees, setEmployees, equipmentRequests, setEquipmentRequests, checkouts, setCheckouts, equipment, kpiConfig, setKpiConfig, kpiEvents, setKpiEvents, punishments, setPunishments }) {
  const t = useT();
  const [modal, setModal] = useState(null);
  const [editTarget, setEditTarget] = useState(null);
  const [form, setForm] = useState({ name: "", pin: "" });
  const [formErr, setFormErr] = useState("");
  const [showPin, setShowPin] = useState({});
  const [profileTarget, setProfileTarget] = useState(null);
  const [profileData, setProfileData] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [kpiForm, setKpiForm] = useState({ punishmentId: "", points: "", reason: "" });
  const [kpiMsg, setKpiMsg] = useState(null);

  const openProfile = (emp) => {
    setProfileTarget(emp);
    setProfileData(null);
    setProfileLoading(true);
    setKpiForm({ punishmentId: "", points: "", reason: "" });
    setKpiMsg(null);
    setModal("profile");
    api.getProfile(emp.id).then(d => setProfileData(d)).catch(() => {}).finally(() => setProfileLoading(false));
  };

  const pendingRequests = (equipmentRequests || []).filter(r => r.status === "pending");

  const approveRequest = (req) => {
    setEquipmentRequests(p => p.map(r => r.id === req.id ? { ...r, status: "approved", resolvedAt: Date.now() } : r));
    const jobName = req.purpose === "work" ? (req.jobName || "Work") : "Personal / Practice";
    const items = req.items || [{ eqId: req.eqId, eqName: req.eqName, qty: req.qty }];
    const now = Date.now();
    const newCheckouts = items.map((item, i) => ({
      id: "co" + now + i, jobId: null, jobName, eqId: item.eqId, qty: item.qty,
      employeeId: req.employeeId, employeeName: req.employeeName, type: "pick",
      ts: now, photo: null, location: null, requestId: req.id,
    }));
    setCheckouts(p => [...p, ...newCheckouts]);
  };

  const denyRequest = (id) => setEquipmentRequests(p => p.map(r => r.id === id ? { ...r, status: "denied", resolvedAt: Date.now() } : r));
  const openAdd = () => { setForm({ name: "", pin: "" }); setEditTarget(null); setFormErr(""); setModal("add"); };
  const openEdit = (emp) => { setForm({ name: emp.name, pin: emp.pin }); setEditTarget(emp); setFormErr(""); setModal("edit"); };

  const validate = () => {
    if (!form.name.trim()) return t("teamNameRequired");
    if (!form.pin.trim()) return t("teamPinRequired");
    if (!/^\d{4,6}$/.test(form.pin)) return t("teamPinInvalid");
    return null;
  };

  const saveEmployee = () => {
    const err = validate();
    if (err) { setFormErr(err); return; }
    if (modal === "add") {
      setEmployees(p => [...p, { id: "e" + Date.now(), name: form.name.trim(), pin: form.pin }]);
    } else {
      setEmployees(p => p.map(e => e.id === editTarget.id ? { ...e, name: form.name.trim(), pin: form.pin } : e));
    }
    setModal(null);
  };

  const delEmployee = (id) => {
    if (window.confirm(t("teamRemoveConfirm"))) setEmployees(p => p.filter(e => e.id !== id));
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
        <div>
          <h1 style={S.pageTitle}>{t("teamTitle")}</h1>
          <p style={S.pageSubtitle}>{t("teamManageCrew")}</p>
        </div>
        <button style={S.btn("primary")} onClick={openAdd}><Icon d={icons.plus} size={15} /> {t("teamAddMember")}</button>
      </div>

      <div style={{ ...S.card, marginBottom: 20 }}>
        <p style={S.sectionTitle}>{t("teamMembers")} ({employees.length})</p>
        <div style={S.col}>
          {employees.length === 0 && <p style={{ fontSize: 13, color: "#666" }}>{t("teamNoMembers")}</p>}
          {employees.map((e, i) => (
            <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 12, paddingBottom: i < employees.length - 1 ? 14 : 0, marginBottom: i < employees.length - 1 ? 14 : 0, borderBottom: i < employees.length - 1 ? "1px solid #252830" : "none" }}>
              <div style={{ width: 38, height: 38, borderRadius: "50%", background: "rgba(232,184,75,0.1)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Icon d={icons.user} size={17} color="#e8b84b" />
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>{e.name}</p>
                {(() => { const st = kpiStars(kpiScore(e.id, kpiEvents, kpiConfig), kpiConfig); return (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, margin: "3px 0 0" }}>
                    <StarRating value={st} size={12} />
                    <span style={{ fontSize: 11, color: "#8a8f9d" }}>{st.toFixed(1)}</span>
                  </div>
                ); })()}
                <p style={{ margin: "2px 0 0", fontSize: 12, color: "#666", display: "flex", alignItems: "center", gap: 6 }}>
                  PIN:&nbsp;
                  <span style={{ fontFamily: "monospace", letterSpacing: 2 }}>{showPin[e.id] ? e.pin : "•".repeat(e.pin.length)}</span>
                  <button onClick={() => setShowPin(p => ({ ...p, [e.id]: !p[e.id] }))} style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 11, padding: 0 }}>
                    {showPin[e.id] ? t("teamPinHide") : t("teamPinShow")}
                  </button>
                </p>
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button style={{ ...S.btn("ghost"), padding: "5px 9px" }} onClick={() => openProfile(e)} title="View Profile"><Icon d={icons.user} size={13} /></button>
                <button style={{ ...S.btn("ghost"), padding: "5px 9px" }} onClick={() => openEdit(e)}><Icon d={icons.edit} size={13} /></button>
                <button style={{ ...S.btn("danger"), padding: "5px 9px" }} onClick={() => delEmployee(e.id)}><Icon d={icons.trash} size={13} /></button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ ...S.card, marginBottom: 20 }}>
        <p style={S.sectionTitle}>{t("teamEqRequests")} {pendingRequests.length > 0 && <span style={{ ...S.badge("amber"), marginLeft: 6 }}>{pendingRequests.length} {t("teamPendingReqs")}</span>}</p>
        {(equipmentRequests || []).length === 0 ? (
          <p style={{ fontSize: 13, color: "#666" }}>{t("teamNoEqRequests")}</p>
        ) : [...(equipmentRequests || [])].reverse().map((req, i, arr) => {
          const itemLabel = req.items
            ? req.items.map(it => { const e = (equipment || []).find(x => x.id === it.eqId); return `${e?.name || it.eqName}${it.qty > 1 ? ` ×${it.qty}` : ""}`; }).join(", ")
            : `${(equipment || []).find(e => e.id === req.eqId)?.name || req.eqName} ×${req.qty}`;
          return (
            <div key={req.id} style={{ paddingBottom: i < arr.length - 1 ? 14 : 0, marginBottom: i < arr.length - 1 ? 14 : 0, borderBottom: i < arr.length - 1 ? "1px solid #252830" : "none" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <span style={S.badge(req.status === "approved" ? "green" : req.status === "denied" ? "red" : "amber")}>{req.status}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>{req.employeeName}</p>
                  <p style={{ margin: "2px 0 0", fontSize: 12, color: "#8a8f9d" }}>
                    {itemLabel} · {req.purpose === "work" ? `Work: ${req.jobName}` : "Practice"}
                    {req.useDates?.length > 0 ? ` · ${req.useDates.map(formatDate).join(", ")}` : req.useDate ? ` · ${formatDate(req.useDate)}` : ""}
                  </p>
                  {req.reason && <p style={{ margin: "2px 0 0", fontSize: 11, color: "#666" }}>{req.reason}</p>}
                  <p style={{ margin: "2px 0 0", fontSize: 10, color: "#444" }}>{new Date(req.requestedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</p>
                </div>
                {req.status === "pending" && (
                  <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
                    <button style={{ ...S.btn("success"), padding: "5px 10px", fontSize: 12 }} onClick={() => approveRequest(req)}>{t("teamApprove")}</button>
                    <button style={{ ...S.btn("danger"), padding: "5px 10px", fontSize: 12 }} onClick={() => denyRequest(req.id)}>{t("teamDeny")}</button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {(modal === "add" || modal === "edit") && (
        <Modal title={modal === "add" ? t("teamAddTitle") : t("teamEditTitle")} onClose={() => setModal(null)}>
          <div style={S.col}>
            <div>
              <label style={S.label}>{t("teamNameLabel")}</label>
              <input style={S.input} value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Somchai" autoFocus />
            </div>
            <div>
              <label style={S.label}>{t("teamPinLabel")}</label>
              <input style={S.input} type="text" inputMode="numeric" maxLength={6} value={form.pin} onChange={e => setForm(p => ({ ...p, pin: e.target.value.replace(/\D/g, "") }))} placeholder="e.g. 1234" />
            </div>
            {formErr && <p style={{ fontSize: 12, color: "#f87171", margin: 0 }}>{formErr}</p>}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button style={S.btn("ghost")} onClick={() => setModal(null)}>{t("cancel")}</button>
              <button style={S.btn("primary")} onClick={saveEmployee}>{modal === "add" ? t("teamAddMemberBtn") : t("teamSaveChanges")}</button>
            </div>
          </div>
        </Modal>
      )}

      {modal === "profile" && profileTarget && (
        <Modal title={`${profileTarget.name}'s Profile`} onClose={() => setModal(null)}>
          <div style={S.col}>
          {(() => {
            const max = kpiMax(kpiConfig);
            const score = kpiScore(profileTarget.id, kpiEvents, kpiConfig);
            const stars = kpiStars(score, kpiConfig);
            const { start, end } = kpiPeriod(kpiConfig);
            const myEvents = (kpiEvents || []).filter(ev => ev.employeeId === profileTarget.id && ev.ts >= start.getTime() && ev.ts < end.getTime()).sort((a, b) => b.ts - a.ts);
            const submit = () => {
              const pts = parseFloat(kpiForm.points) || 0;
              if (pts <= 0) { setKpiMsg({ ok: false, text: t("teamKpiErrPoints") }); return; }
              if (!kpiForm.reason.trim()) { setKpiMsg({ ok: false, text: t("teamKpiErrReason") }); return; }
              setKpiEvents(p => [...(p || []), { id: "kpi" + Date.now(), employeeId: profileTarget.id, points: pts, reason: kpiForm.reason.trim(), punishmentId: kpiForm.punishmentId || null, ts: Date.now(), by: "admin" }]);
              setKpiForm({ punishmentId: "", points: "", reason: "" });
              setKpiMsg({ ok: true, text: t("teamKpiDeductedMsg").replace("{pts}", pts) });
              setTimeout(() => setKpiMsg(null), 3000);
            };
            return (
              <div style={{ ...S.card, background: "rgba(232,184,75,0.04)", border: "1px solid rgba(232,184,75,0.15)" }}>
                <p style={S.sectionTitle}>{t("teamKpiScore")}</p>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
                  <StarRating value={stars} size={22} />
                  <span style={{ fontSize: 20, fontWeight: 800, color: "var(--accent,#e8b84b)" }}>{stars.toFixed(1)}</span>
                  <span style={{ fontSize: 13, color: "#8a8f9d" }}>{score}/{max} {t("kpiPts")}</span>
                </div>
                <p style={{ fontSize: 11, color: "#666", margin: "0 0 12px" }}>{t("teamKpiPeriodLabel")} {start.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} – {new Date(end.getTime() - 86400000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {(punishments || []).length > 0 && (
                    <select style={S.select} value={kpiForm.punishmentId} onChange={e => { const pun = (punishments || []).find(x => x.id === e.target.value); setKpiForm(f => ({ punishmentId: e.target.value, points: pun ? String(pun.points) : f.points, reason: pun ? (pun.label + (pun.description ? ` — ${pun.description}` : "")) : f.reason })); }}>
                      <option value="">{t("teamKpiCustomDeduction")}</option>
                      {(punishments || []).map(pun => <option key={pun.id} value={pun.id}>{pun.label} (−{pun.points})</option>)}
                    </select>
                  )}
                  <div style={{ display: "grid", gridTemplateColumns: "90px 1fr", gap: 8 }}>
                    <input style={S.input} type="number" min="0" step="0.1" value={kpiForm.points} placeholder={t("teamKpiPoints")} onChange={e => setKpiForm(f => ({ ...f, points: e.target.value }))} />
                    <input style={S.input} value={kpiForm.reason} placeholder={t("teamKpiReason")} onChange={e => setKpiForm(f => ({ ...f, reason: e.target.value }))} />
                  </div>
                  {kpiMsg && <p style={{ fontSize: 12, color: kpiMsg.ok ? "#34d399" : "#f87171", margin: 0 }}>{kpiMsg.text}</p>}
                  <button style={{ ...S.btn("danger"), justifyContent: "center" }} onClick={submit}>{t("teamKpiDeduct")}</button>
                </div>
                {myEvents.length > 0 && (
                  <div style={{ marginTop: 12, borderTop: "1px solid var(--divider-color,#252830)", paddingTop: 10 }}>
                    <p style={{ ...S.sectionTitle, marginBottom: 8 }}>{t("teamKpiDeductionsThisPeriod")}</p>
                    {myEvents.map(ev => (
                      <div key={ev.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
                        <span style={{ ...S.badge("red"), flexShrink: 0 }}>−{ev.points}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ margin: 0, fontSize: 13 }}>{ev.reason}</p>
                          <p style={{ margin: "2px 0 0", fontSize: 10, color: "#555" }}>{new Date(ev.ts).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
                        </div>
                        <button style={{ ...S.btn("ghost"), padding: "3px 8px", fontSize: 11 }} onClick={() => setKpiEvents(p => p.filter(x => x.id !== ev.id))}>{t("teamKpiUndo")}</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
          {profileLoading ? (
            <p style={{ color: "#666", textAlign: "center", padding: 24 }}>{t("loading")}</p>
          ) : !profileData ? (
            <p style={{ color: "#666", textAlign: "center", padding: 12 }}>{t("teamNoProfileDocs")}</p>
          ) : (
            <div style={S.col}>
              {profileData.photo && (
                <div style={{ display: "flex", justifyContent: "center" }}>
                  <img src={profileData.photo} alt="profile" style={{ width: 90, height: 90, borderRadius: "50%", objectFit: "cover", border: "3px solid #e8b84b" }} />
                </div>
              )}
              {[[t("phone"), profileData.phone], [t("email"), profileData.email]].filter(([, v]) => v).map(([label, val]) => (
                <div key={label}>
                  <p style={{ ...S.sectionTitle, marginBottom: 3 }}>{label}</p>
                  <p style={{ margin: 0, fontSize: 14 }}>{val}</p>
                </div>
              ))}
              {profileData.legalAddress && (
                <div>
                  <p style={{ ...S.sectionTitle, marginBottom: 3 }}>{t("legalAddress")}</p>
                  <p style={{ margin: 0, fontSize: 13, whiteSpace: "pre-wrap", color: "#8a8f9d" }}>{profileData.legalAddress}</p>
                </div>
              )}
              {profileData.idCard && (
                <div>
                  <p style={{ ...S.sectionTitle, marginBottom: 6 }}>{t("idCard")}</p>
                  <img src={profileData.idCard} alt="ID" style={{ width: "100%", maxWidth: 280, borderRadius: 8, border: "1px solid #2e3340" }} />
                </div>
              )}
              {profileData.promptPayQR && (
                <div>
                  <p style={{ ...S.sectionTitle, marginBottom: 6 }}>{t("promptPayQR")}</p>
                  <img src={profileData.promptPayQR} alt="QR" style={{ width: 120, height: 120, objectFit: "contain", borderRadius: 8, border: "1px solid #2e3340", background: "#fff", padding: 4 }} />
                </div>
              )}
            </div>
          )}
          </div>
        </Modal>
      )}

      {/* KPI Config */}
      <div style={{ ...S.card, marginTop: 20 }}>
      <p style={S.sectionTitle}>{t("settingsKpiTitle")}</p>
      <div style={S.col}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          <div>
            <label style={S.label}>{t("settingsKpiPeriodStart")}</label>
            <input style={S.input} type="date" value={kpiConfig.startDate || ""} onChange={e => setKpiConfig(c => ({ ...c, startDate: e.target.value }))} />
          </div>
          <div>
            <label style={S.label}>{t("settingsKpiReset")}</label>
            <input style={S.input} type="number" min="1" value={kpiConfig.resetMonths} onChange={e => setKpiConfig(c => ({ ...c, resetMonths: e.target.value }))} placeholder="12" />
          </div>
          <div>
            <label style={S.label}>{t("settingsKpiMaxPoints")}</label>
            <input style={S.input} type="number" min="1" value={kpiConfig.maxPoints} onChange={e => setKpiConfig(c => ({ ...c, maxPoints: e.target.value }))} placeholder="100" />
          </div>
        </div>
        {(() => { const p = kpiPeriod(kpiConfig); const endLabel = new Date(p.end.getTime() - 86400000); return (
          <p style={{ fontSize: 11, color: "var(--text-muted,#666)", margin: 0 }}>
            {t("settingsKpiEveryoneStarts")} <strong style={{ color: "var(--accent,#e8b84b)" }}>{kpiMax(kpiConfig)} pts (★★★★★)</strong>. {t("settingsKpiCurrPeriod")}{" "}
            <strong style={{ color: "var(--text,#e8e4dc)" }}>{p.start.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} – {endLabel.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</strong>. {t("settingsKpiDefaultStart")}
          </p>
        ); })()}
        <div style={{ borderTop: "1px solid var(--divider-color,#252830)", paddingTop: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <p style={{ ...S.sectionTitle, margin: 0 }}>{t("settingsKpiPunishments")}</p>
            <button style={{ ...S.btn("ghost"), padding: "4px 10px", fontSize: 12 }} onClick={() => setPunishments(p => [...(p || []), { id: "pun" + Date.now(), label: "", points: "", description: "" }])}><Icon d={icons.plus} size={12} /> {t("settingsKpiAddPunishment")}</button>
          </div>
          <p style={{ fontSize: 11, color: "var(--text-muted,#666)", margin: "0 0 10px" }}>{t("settingsKpiPunDesc")}</p>
          {(punishments || []).length === 0 && <p style={{ fontSize: 12, color: "#666", margin: 0 }}>{t("settingsKpiNoPunishments")}</p>}
          <div style={S.col}>
            {(punishments || []).map(pun => (
              <div key={pun.id} style={{ display: "grid", gridTemplateColumns: "1fr 72px 32px", gap: 6, alignItems: "center" }}>
                <input style={{ ...S.input, padding: "7px 10px" }} value={pun.label} placeholder="e.g. Late arrival" onChange={e => setPunishments(p => p.map(x => x.id === pun.id ? { ...x, label: e.target.value } : x))} />
                <input style={{ ...S.input, padding: "7px 8px", textAlign: "right" }} type="number" min="0" step="0.1" value={pun.points} placeholder="pts" onChange={e => setPunishments(p => p.map(x => x.id === pun.id ? { ...x, points: e.target.value } : x))} />
                <button style={{ ...S.btn("danger"), padding: "5px 6px", minWidth: 0 }} onClick={() => setPunishments(p => p.filter(x => x.id !== pun.id))}><Icon d={icons.x} size={12} /></button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  </div>
  );
}

// ─── SETTINGS PANEL ───────────────────────────────────────────────────────────
function SettingsPage({ companyName, setCompanyName, adminPin, setAdminPin, lineGroupId, setLineGroupId, lineNotifyMuted, setLineNotifyMuted, createBackup, restoreBackup, timezone, setTimezone, timeFormat, setTimeFormat, saveSettingsNow, verificationConfig, setVerificationConfig, themeStyle, setThemeStyle, themePalette, setThemePalette, lang, setLang, navOrder, setNavOrder, checkoutsCount, setCheckouts, invoicePresets, setInvoicePresets, onClose }) {
  useEffect(() => { document.body.style.overflow = "hidden"; return () => { document.body.style.overflow = ""; }; }, []);
  const t = useT();
  const [apForm, setApForm] = useState({ newPin: "", confirmPin: "" });
  const [apMsg, setApMsg] = useState(null);
  const [backupStatus, setBackupStatus] = useState(null);
  const [lastBackupAt, setLastBackupAt] = useState(() => { try { return localStorage.getItem("psr_last_backup"); } catch { return null; } });
  const [saveState, setSaveState] = useState(null);

  const [confirmClear, setConfirmClear] = useState(false);
  const [clearDone, setClearDone] = useState(false);


  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "var(--bg,#0f1117)", display: "flex", flexDirection: "column", overflowY: "hidden" }}>
      {/* Panel header */}
      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 12, padding: "13px 16px", background: "var(--bg,#0f1117)", borderBottom: "1px solid var(--divider-color,#252830)" }}>
        <button onClick={onClose} style={{ display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", cursor: "pointer", padding: 6, borderRadius: 6 }}>
          <Icon d={icons.x} size={20} color="var(--text-muted,#8a8f9d)" />
        </button>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "var(--text,#e8e4dc)" }}>{t("settingsTitle")}</h1>
      </div>
      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 16px 120px", maxWidth: 600, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>

      {/* Language card */}
      <div style={{ ...S.card, marginBottom: 20 }}>
        <p style={S.sectionTitle}>{t("settingsLanguage")}</p>
        <div style={{ display: "flex", gap: 8 }}>
          {[{ id: "en", label: "🇬🇧 English" }, { id: "th", label: "🇹🇭 ภาษาไทย" }].map(l => (
            <button key={l.id} onClick={() => setLang(l.id)} style={{ flex: 1, padding: "10px 4px", borderRadius: 8, border: lang === l.id ? "2px solid var(--accent,#e8b84b)" : "1px solid var(--border-color,#2e3340)", background: lang === l.id ? "rgba(232,184,75,0.08)" : "transparent", color: lang === l.id ? "var(--accent,#e8b84b)" : "var(--text-muted,#666)", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{l.label}</button>
          ))}
        </div>
      </div>

      {/* Navigation Order card */}
      {(() => {
        const baseItems = [
          { key: "dashboard", label: t("navDashboard"), icon: icons.film },
          { key: "equipment", label: t("navEquipment"), icon: icons.camera },
          { key: "jobs", label: t("navJobs"), icon: icons.calendar },
          { key: "invoice", label: t("navInvoice"), icon: icons.invoice },
          { key: "team", label: t("navTeam"), icon: icons.user },
          { key: "checkout", label: t("navCheckout"), icon: icons.package },
        ];
        const currentOrder = navOrder ? navOrder.map(k => baseItems.find(i => i.key === k)).filter(Boolean) : baseItems;
        const move = (idx, dir) => {
          const arr = [...currentOrder];
          const swap = idx + dir;
          if (swap < 0 || swap >= arr.length) return;
          [arr[idx], arr[swap]] = [arr[swap], arr[idx]];
          setNavOrder(arr.map(i => i.key));
        };
        return (
          <div style={{ ...S.card, marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <p style={{ ...S.sectionTitle, margin: 0 }}>{t("settingsNavOrder")}</p>
              {navOrder && (
                <button onClick={() => setNavOrder(null)} style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 12, color: "var(--accent,#e8b84b)", fontWeight: 600, padding: "4px 0" }}>
                  {t("settingsNavOrderReset")}
                </button>
              )}
            </div>
            <p style={{ ...S.label, marginBottom: 12 }}>{t("settingsNavOrderDesc")}</p>
            {currentOrder.map((item, idx) => (
              <div key={item.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: idx < currentOrder.length - 1 ? "1px solid var(--border-color,#252830)" : "none" }}>
                <Icon d={item.icon} size={18} color="var(--text-muted,#8a8f9d)" />
                <span style={{ flex: 1, fontSize: 14, color: "var(--text,#e8e4dc)", fontWeight: 500 }}>{item.label}</span>
                <button
                  onClick={() => move(idx, -1)}
                  disabled={idx === 0}
                  style={{ background: "transparent", border: "1px solid var(--border-color,#2e3340)", borderRadius: 6, padding: "4px 10px", cursor: idx === 0 ? "default" : "pointer", color: idx === 0 ? "var(--text-muted,#444)" : "var(--text,#e8e4dc)", fontSize: 13, lineHeight: 1 }}
                >▲</button>
                <button
                  onClick={() => move(idx, 1)}
                  disabled={idx === currentOrder.length - 1}
                  style={{ background: "transparent", border: "1px solid var(--border-color,#2e3340)", borderRadius: 6, padding: "4px 10px", cursor: idx === currentOrder.length - 1 ? "default" : "pointer", color: idx === currentOrder.length - 1 ? "var(--text-muted,#444)" : "var(--text,#e8e4dc)", fontSize: 13, lineHeight: 1 }}
                >▼</button>
              </div>
            ))}
          </div>
        );
      })()}

      <div style={{ ...S.card, marginBottom: 20 }}>
        <p style={S.sectionTitle}>{t("settingsTheme")}</p>
        <div style={{ marginBottom: 14 }}>
          <p style={{ ...S.label, marginBottom: 8 }}>{t("settingsThemeStyle")}</p>
          <div style={{ display: "flex", gap: 6 }}>
            {[{ id: "neumorphism", label: "Neumorphism" }, { id: "glassmorphism", label: "Glassmorphism" }, { id: "skeuomorphism", label: "Skeuomorphism" }].map(s => (
              <button key={s.id} onClick={() => setThemeStyle(s.id)} style={{ flex: 1, padding: "8px 4px", borderRadius: 8, border: themeStyle === s.id ? "2px solid var(--accent,#e8b84b)" : "1px solid var(--border-color,#2e3340)", background: themeStyle === s.id ? "rgba(232,184,75,0.08)" : "transparent", color: themeStyle === s.id ? "var(--accent,#e8b84b)" : "var(--text-muted,#666)", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>{s.label}</button>
            ))}
          </div>
        </div>
        <div>
          <p style={{ ...S.label, marginBottom: 8 }}>{t("settingsThemeColor")}</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 6 }}>
            {[{ id: "black-white", dot: "#e0e0e0", label: "B&W" }, { id: "teal-orange", dot: "#ff6a2a", label: "Teal" }, { id: "black-red", dot: "#dd3333", label: "Red" }, { id: "white-blue", dot: "#1a60d0", label: "Blue" }, { id: "black-yellow", dot: "#e8b84b", label: "Amber" }, { id: "black-blue", dot: "#3a80e8", label: "Navy" }].map(pal => (
              <button key={pal.id} onClick={() => setThemePalette(pal.id)} style={{ padding: "8px 2px", borderRadius: 8, border: themePalette === pal.id ? `2px solid ${pal.dot}` : "1px solid var(--border-color,#2e3340)", background: "transparent", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <div style={{ width: 18, height: 18, borderRadius: "50%", background: pal.dot }} />
                <span style={{ fontSize: 9, color: "var(--text-muted,#666)", fontWeight: 600, textTransform: "uppercase" }}>{pal.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ ...S.card, marginBottom: 20 }}>
        <p style={S.sectionTitle}>{t("settingsCompany")}</p>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <input
            style={{ ...S.input, flex: 1 }}
            value={companyName}
            onChange={e => setCompanyName(e.target.value)}
            placeholder="e.g. GEAR DESK"
            maxLength={40}
          />
          {!companyName.trim() && (
            <span style={{ fontSize: 11, color: "var(--text-muted,#666)", flexShrink: 0 }}>{t("settingsUsesDefault")}</span>
          )}
        </div>
        <p style={{ fontSize: 11, color: "var(--text-muted,#666)", marginTop: 6 }}>{t("settingsCompanyHint")}</p>
      </div>

      <div style={{ ...S.card, marginBottom: 20 }}>
        <p style={S.sectionTitle}>{t("settingsDateTime")}</p>
        <div style={S.col}>
          <div>
            <label style={S.label}>{t("settingsTimezone")}</label>
            <select style={S.select} value={timezone} onChange={e => setTimezone(e.target.value)}>
              {TIMEZONES.some(tz => tz.id === timezone) ? null : <option value={timezone}>{timezone}</option>}
              {TIMEZONES.map(tz => <option key={tz.id} value={tz.id}>{tz.label}</option>)}
            </select>
            <p style={{ fontSize: 11, color: "var(--text-muted,#666)", marginTop: 6 }}>{t("settingsTimezoneHint")}</p>
          </div>
          <div>
            <label style={S.label}>{t("settingsTimeFormat")}</label>
            <div style={{ display: "flex", gap: 8 }}>
              {[{ v: "24", l: "24-hour (21:00)" }, { v: "12", l: "12-hour (9:00 PM)" }].map(o => (
                <button key={o.v} onClick={() => setTimeFormat(o.v)} style={{ ...S.btn(timeFormat === o.v ? "primary" : "ghost"), flex: 1, justifyContent: "center" }}>{o.l}</button>
              ))}
            </div>
            <p style={{ fontSize: 11, color: "var(--text-muted,#666)", marginTop: 6 }}>{t("settingsTimeFormatHint")}</p>
          </div>
        </div>
      </div>

      <div style={{ ...S.card, marginBottom: 20 }}>
        <p style={S.sectionTitle}>{t("settingsCheckout")}</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[
            { id: "none",    labelKey: "settingsVerifNone",    descKey: "settingsVerifNoneDesc" },
            { id: "photo",   labelKey: "settingsVerifPhoto",   descKey: "settingsVerifPhotoDesc" },
            { id: "barcode", labelKey: "settingsVerifBarcode", descKey: "settingsVerifBarcodeDesc" },
            { id: "both",    labelKey: "settingsVerifBoth",    descKey: "settingsVerifBothDesc" },
          ].map(({ id, labelKey, descKey }) => {
            const active = (verificationConfig?.mode || "photo") === id;
            return (
              <div key={id} onClick={() => setVerificationConfig({ mode: id })}
                style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "10px 14px", borderRadius: 8,
                  background: active ? "rgba(232,184,75,0.07)" : "rgba(255,255,255,0.02)",
                  border: `1px solid ${active ? "rgba(232,184,75,0.35)" : "#252830"}`,
                  cursor: "pointer", userSelect: "none" }}>
                <div style={{ width: 18, height: 18, borderRadius: "50%", flexShrink: 0, marginTop: 1,
                  background: active ? "#e8b84b" : "transparent",
                  border: `2px solid ${active ? "#e8b84b" : "#555"}`,
                  display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {active && <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#0f1117" }} />}
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: active ? "#e8b84b" : "var(--text,#e8e4dc)" }}>{t(labelKey)}</p>
                  <p style={{ margin: "3px 0 0", fontSize: 11, color: "var(--text-muted,#666)", lineHeight: 1.5 }}>{t(descKey)}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ ...S.card, marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <p style={{ ...S.sectionTitle, margin: 0 }}>Invoice Item Presets</p>
          <button style={{ ...S.btn("ghost"), padding: "4px 10px", fontSize: 12 }} onClick={() => setInvoicePresets(p => [...p, { id: "ip" + Date.now(), description: "", rate: "" }])}>
            <Icon d={icons.plus} size={12} /> Add
          </button>
        </div>
        <p style={{ fontSize: 11, color: "var(--text-muted,#666)", margin: "0 0 12px", lineHeight: 1.6 }}>Saved items appear as quick-add chips when creating an invoice.</p>
        {invoicePresets.length === 0 && (
          <p style={{ fontSize: 12, color: "var(--text-muted,#666)", textAlign: "center", padding: "12px 0" }}>No presets yet.</p>
        )}
        <div style={S.col}>
          {invoicePresets.map(ip => (
            <div key={ip.id} style={{ display: "grid", gridTemplateColumns: "1fr 100px 32px", gap: 8, alignItems: "center" }}>
              <input style={{ ...S.input, fontSize: 13 }} value={ip.description} placeholder="e.g. Equipment Rental" maxLength={50}
                onChange={e => setInvoicePresets(p => p.map(x => x.id === ip.id ? { ...x, description: e.target.value } : x))} />
              <input style={{ ...S.input, fontSize: 13, textAlign: "right" }} type="number" min="0" value={ip.rate} placeholder="฿ Rate"
                onChange={e => setInvoicePresets(p => p.map(x => x.id === ip.id ? { ...x, rate: e.target.value } : x))} />
              <button style={{ ...S.btn("danger"), padding: "6px 8px", minWidth: 0 }}
                onClick={() => setInvoicePresets(p => p.filter(x => x.id !== ip.id))}>
                <Icon d={icons.x} size={12} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div style={{ ...S.card, marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: 1 }}>
            <p style={{ ...S.sectionTitle, margin: 0 }}>{t("settingsClearHistory")}</p>
            <p style={{ fontSize: 11, color: "var(--text-muted,#666)", margin: "6px 0 0", lineHeight: 1.6 }}>{t("settingsClearHistoryDesc")}</p>
            {checkoutsCount > 0 && <p style={{ fontSize: 11, color: "var(--text-muted,#555)", margin: "4px 0 0" }}>{t("settingsClearHistoryCount").replace("{n}", checkoutsCount)}</p>}
          </div>
          <div style={{ flexShrink: 0 }}>
            {clearDone ? (
              <span style={{ fontSize: 13, color: "#34d399", fontWeight: 600 }}>{t("settingsClearHistoryDone")}</span>
            ) : confirmClear ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
                <p style={{ margin: 0, fontSize: 12, color: "#f87171", maxWidth: 240, textAlign: "right", lineHeight: 1.5 }}>{t("settingsClearHistoryConfirm")}</p>
                <div style={{ display: "flex", gap: 8 }}>
                  <button style={{ ...S.btn("ghost"), fontSize: 12, padding: "6px 12px" }} onClick={() => setConfirmClear(false)}>Cancel</button>
                  <button style={{ ...S.btn("danger"), fontSize: 12, padding: "6px 12px" }} onClick={() => { setCheckouts([]); setConfirmClear(false); setClearDone(true); setTimeout(() => setClearDone(false), 4000); }}>
                    {t("settingsClearHistoryYes")}
                  </button>
                </div>
              </div>
            ) : (
              <button style={{ ...S.btn("danger"), fontSize: 12, padding: "7px 14px" }} onClick={() => setConfirmClear(true)} disabled={checkoutsCount === 0}>
                {t("settingsClearHistory")}
              </button>
            )}
          </div>
        </div>
      </div>

      <div style={{ ...S.card, marginBottom: 20 }}>
        <p style={S.sectionTitle}>{t("settingsLineTitle")}</p>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, padding: "10px 14px", borderRadius: 8, background: lineGroupId ? "rgba(52,211,153,0.07)" : "rgba(255,255,255,0.03)", border: `1px solid ${lineGroupId ? "rgba(52,211,153,0.25)" : "#252830"}` }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: lineGroupId ? "#34d399" : "#444", flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: lineGroupId ? "#34d399" : "#666" }}>
              {lineGroupId ? t("settingsLineConnected") : t("settingsLineNotConnected")}
            </p>
            {lineGroupId && <p style={{ margin: "2px 0 0", fontSize: 10, color: "#555", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lineGroupId}</p>}
          </div>
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            {!lineGroupId && (
              <button style={{ ...S.btn("ghost"), padding: "5px 10px", fontSize: 11 }} onClick={() => api.getData().then(d => { if (d.lineGroupId) setLineGroupId(d.lineGroupId); })}>{t("settingsLineRefresh")}</button>
            )}
            {lineGroupId && (
              <button style={{ ...S.btn("danger"), padding: "5px 10px", fontSize: 11 }} onClick={async () => { const r = await api.putData({ lineGroupId: null }); if (r?.ok) setLineGroupId(null); }}>{t("settingsLineDisconnect")}</button>
            )}
          </div>
        </div>
        <div
          onClick={() => { const next = !lineNotifyMuted; setLineNotifyMuted(next); try { localStorage.setItem("psr_notify_muted", next ? "1" : "0"); } catch {} }}
          style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 8, background: lineNotifyMuted ? "rgba(239,68,68,0.07)" : "rgba(52,211,153,0.05)", border: `1px solid ${lineNotifyMuted ? "rgba(239,68,68,0.25)" : "rgba(52,211,153,0.15)"}`, cursor: "pointer", userSelect: "none" }}>
          <div style={{ width: 36, height: 20, borderRadius: 10, background: lineNotifyMuted ? "#ef4444" : "#34d399", position: "relative", flexShrink: 0, transition: "background .2s" }}>
            <div style={{ position: "absolute", top: 2, left: lineNotifyMuted ? 2 : 18, width: 16, height: 16, borderRadius: "50%", background: "#fff", transition: "left .2s", boxShadow: "0 1px 3px rgba(0,0,0,.3)" }} />
          </div>
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: lineNotifyMuted ? "#f87171" : "#34d399" }}>
              {lineNotifyMuted ? t("settingsLineMuted") : t("settingsLineActive")}
            </p>
            <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-muted,#555)" }}>
              {lineNotifyMuted ? t("settingsLineMutedDesc") : t("settingsLineActiveDesc")}
            </p>
          </div>
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted,#666)", lineHeight: 1.8, marginTop: 14 }}>
          <strong style={{ color: "var(--text,#e8e4dc)", display: "block", marginBottom: 6 }}>Connect a Group Chat (one-time):</strong>
          1. Add your LINE OA to the group chat<br />
          2. In <strong>LINE Developers Console</strong> → Messaging API → Webhook URL, set:<br />
          <code style={{ background: "rgba(232,184,75,0.1)", color: "var(--accent,#e8b84b)", padding: "2px 8px", borderRadius: 4, display: "inline-block", margin: "4px 0", fontSize: 11 }}>https://pickshootreturn.pages.dev/api/webhook</code><br />
          3. Enable <strong>Use webhook</strong> and click <strong>Verify</strong><br />
          4. The group ID is captured automatically when the OA joins or receives a message in the group
        </div>
        <p style={{ fontSize: 11, color: "var(--text-muted,#555)", marginTop: 10 }}>
          {lineGroupId ? t("settingsLineGroupConnected") : t("settingsLineGroupNotConnected")}
        </p>
      </div>

      <div style={{ ...S.card, marginBottom: 20 }}>
        <p style={S.sectionTitle}>{t("settingsCalSync")}</p>
        <div style={S.col}>
          <p style={{ fontSize: 13, color: "var(--text-muted,#666)", margin: 0, lineHeight: 1.7 }}>
            Subscribe to the job schedule in your iPhone Calendar. Pencil jobs appear as <strong style={{ color: "var(--text,#e8e4dc)" }}>tentative (striped)</strong>, Confirmed as <strong style={{ color: "#34d399" }}>solid</strong>. Auto-refreshes hourly.
          </p>
          <div style={{ fontSize: 12, color: "var(--text-muted,#666)", lineHeight: 1.8 }}>
            <strong style={{ color: "var(--text,#e8e4dc)", display: "block", marginBottom: 6 }}>{t("settingsCalDescTitle")}</strong>
            1. Open <strong>Settings → Calendar → Accounts → Add Account → Other</strong><br />
            2. Tap <strong>Add Subscribed Calendar</strong><br />
            3. Paste this URL:<br />
            <code style={{ background: "rgba(232,184,75,0.1)", color: "var(--accent,#e8b84b)", padding: "2px 8px", borderRadius: 4, display: "inline-block", margin: "4px 0", fontSize: 11 }}>https://pickshootreturn.pages.dev/api/calendar</code><br />
            4. Tap <strong>Next</strong> → <strong>Save</strong>
          </div>
          <button style={{ ...S.btn("ghost"), alignSelf: "flex-start", fontSize: 12 }} onClick={() => { navigator.clipboard?.writeText("https://pickshootreturn.pages.dev/api/calendar"); }}>
            {t("settingsCopyCalUrl")}
          </button>
        </div>
      </div>

      <div style={{ ...S.card, marginBottom: 20 }}>
        <p style={S.sectionTitle}>{t("settingsAdminPin")}</p>
        <div style={S.col}>
          <p style={{ fontSize: 13, color: "var(--text-muted,#666)", margin: 0 }}>{t("settingsCurrPin")}: <strong style={{ color: "var(--accent,#e8b84b)", fontFamily: "monospace" }}>{adminPin}</strong></p>
          <div style={S.row}>
            <div style={{ flex: 1 }}>
              <label style={S.label}>{t("settingsNewPin")}</label>
              <input style={S.input} type="password" inputMode="numeric" maxLength={6} value={apForm.newPin} onChange={e => setApForm(p => ({ ...p, newPin: e.target.value.replace(/\D/g, "") }))} placeholder="e.g. 9999" />
            </div>
            <div style={{ flex: 1 }}>
              <label style={S.label}>{t("settingsConfirmPin")}</label>
              <input style={S.input} type="password" inputMode="numeric" maxLength={6} value={apForm.confirmPin} onChange={e => setApForm(p => ({ ...p, confirmPin: e.target.value.replace(/\D/g, "") }))} placeholder={t("settingsPinReEnter")} />
            </div>
          </div>
          {apMsg && <p style={{ fontSize: 12, color: apMsg.ok ? "#34d399" : "#f87171", margin: 0 }}>{apMsg.text}</p>}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button style={S.btn("primary")} onClick={() => {
              const { newPin, confirmPin } = apForm;
              if (!/^\d{4,6}$/.test(newPin)) { setApMsg({ ok: false, text: t("settingsPinInvalid") }); return; }
              if (newPin !== confirmPin) { setApMsg({ ok: false, text: t("settingsPinMismatch") }); return; }
              setAdminPin(newPin);
              setApForm({ newPin: "", confirmPin: "" });
              setApMsg({ ok: true, text: t("settingsPinUpdated") });
              setTimeout(() => setApMsg(null), 3000);
            }}>{t("settingsChangePin")}</button>
          </div>
        </div>
      </div>

      <div style={S.card}>
        <p style={S.sectionTitle}>{t("settingsBackup")}</p>
        <div style={S.col}>
          <p style={{ fontSize: 13, color: "var(--text-muted,#666)", margin: 0, lineHeight: 1.6 }}>{t("settingsBackupDesc")}</p>
          {lastBackupAt && (
            <p style={{ fontSize: 12, color: "var(--text-muted,#666)", margin: 0 }}>
              {t("settingsLastBackup")}: <strong style={{ color: "var(--text,#e8e4dc)" }}>{new Date(lastBackupAt).toLocaleString()}</strong>
            </p>
          )}
          {backupStatus === "saved" && <p style={{ fontSize: 12, color: "#34d399", margin: 0 }}>{t("settingsBackupSaved")}</p>}
          {backupStatus === "error" && <p style={{ fontSize: 12, color: "#f87171", margin: 0 }}>{t("settingsBackupError")}</p>}
          {backupStatus === "restored" && <p style={{ fontSize: 12, color: "#34d399", margin: 0 }}>{t("settingsBackupRestored")}</p>}
          {backupStatus === "no-backup" && <p style={{ fontSize: 12, color: "#f87171", margin: 0 }}>{t("settingsBackupNoBackup")}</p>}
          <div style={S.row}>
            <button
              style={{ ...S.btn("primary"), flex: 1, justifyContent: "center", opacity: backupStatus === "saving" ? 0.7 : 1 }}
              disabled={backupStatus === "saving" || backupStatus === "restoring"}
              onClick={async () => {
                setBackupStatus("saving");
                try {
                  const res = await createBackup();
                  if (!res?.ok) throw new Error();
                  const ts = new Date().toISOString();
                  setLastBackupAt(ts);
                  setBackupStatus("saved");
                } catch { setBackupStatus("error"); }
                setTimeout(() => setBackupStatus(null), 4000);
              }}>
              {backupStatus === "saving" ? t("settingsSavingBackup") : t("settingsCreateBackup")}
            </button>
            <button
              style={{ ...S.btn("ghost"), flex: 1, justifyContent: "center" }}
              disabled={backupStatus === "saving" || backupStatus === "restoring"}
              onClick={async () => {
                const d = await api.getBackup();
                if (!d) return;
                const url = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: "application/json" }));
                const a = document.createElement("a");
                a.href = url; a.download = `psr_backup_${(d.savedAt || new Date().toISOString()).slice(0,10)}.json`;
                a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
              }}>
              {t("settingsDownloadJson")}
            </button>
          </div>
          {backupStatus === "confirm-restore" ? (
            <div style={{ background: "rgba(248,113,113,0.1)", border: "1px solid #f87171", borderRadius: 8, padding: "12px 14px" }}>
              <p style={{ fontSize: 13, color: "#f87171", margin: "0 0 10px 0", fontWeight: 600 }}>{t("settingsRestoreConfirmMsg")}</p>
              <div style={S.row}>
                <button style={{ ...S.btn("danger"), flex: 1, justifyContent: "center" }} onClick={async () => {
                  setBackupStatus("restoring");
                  try {
                    const savedAt = await restoreBackup();
                    if (!savedAt) { setBackupStatus("no-backup"); setTimeout(() => setBackupStatus(null), 4000); return; }
                    setBackupStatus("restored");
                  } catch { setBackupStatus("error"); }
                  setTimeout(() => setBackupStatus(null), 4000);
                }}>
                  {backupStatus === "restoring" ? t("settingsRestoring") : t("settingsYesRestore")}
                </button>
                <button style={{ ...S.btn("ghost"), flex: 1, justifyContent: "center" }} onClick={() => setBackupStatus(null)}>{t("cancel")}</button>
              </div>
            </div>
          ) : (
            <button
              style={{ ...S.btn("ghost"), justifyContent: "center", borderColor: "#f87171", color: "#f87171", opacity: backupStatus === "saving" || backupStatus === "restoring" ? 0.5 : 1 }}
              disabled={backupStatus === "saving" || backupStatus === "restoring"}
              onClick={() => setBackupStatus("confirm-restore")}>
              {t("settingsRestoreFromBackup")}
            </button>
          )}
        </div>
      </div>

      <div style={{ ...S.card, marginTop: 20 }}>
        <p style={S.sectionTitle}>{t("settingsSystemInfo")}</p>
        <p style={{ fontSize: 13, color: "#666" }}>{t("settingsSysDesc1")}</p>
        <p style={{ fontSize: 13, color: "#666", marginTop: 8 }}>{t("settingsSysDesc2")}</p>
      </div>

      {/* Save all settings */}
      <div style={{ position: "sticky", bottom: 16, zIndex: 20, marginTop: 20 }}>
        <button
          style={{ ...S.btn(saveState === "saved" ? "success" : saveState && saveState.error ? "danger" : "primary"), width: "100%", justifyContent: "center", padding: "15px", fontSize: 15, fontWeight: 700, boxShadow: "0 4px 24px rgba(0,0,0,0.5)", opacity: saveState === "saving" ? 0.75 : 1 }}
          disabled={saveState === "saving"}
          onClick={async () => {
            setSaveState("saving");
            const res = await saveSettingsNow();
            if (res.ok) { setSaveState("saved"); setTimeout(() => setSaveState(s => s === "saved" ? null : s), 3000); }
            else { setSaveState({ error: res.error }); }
          }}
        >
          {saveState === "saving" ? t("settingsSaving")
            : saveState === "saved" ? t("settingsSaved")
            : saveState && saveState.error ? t("settingsSaveFailed")
            : t("settingsSaveAll")}
        </button>
        {saveState && saveState.error && (
          <p style={{ fontSize: 12, color: "#f87171", textAlign: "center", margin: "8px 0 0", lineHeight: 1.5 }}>⚠ {saveState.error}</p>
        )}
        {saveState === "saved" && (
          <p style={{ fontSize: 11, color: "#34d399", textAlign: "center", margin: "8px 0 0" }}>{t("settingsSavedAt")} {new Date().toLocaleTimeString()}</p>
        )}
        <p style={{ fontSize: 11, color: "var(--text-muted,#666)", textAlign: "center", margin: "8px 0 0" }}>{t("settingsSaveHint")}</p>
      </div>

      </div>
    </div>
  );
}

// ─── INVOICE PAGE ─────────────────────────────────────────────────────────────
function InvoicePage({ productionCompanies, setProductionCompanies, invoices, setInvoices, employees, companyName, user, invoicePresets, jobs, adminRequests }) {
  const t = useT();
  const [activeTab, setActiveTab] = useState("companies");
  const [modal, setModal] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [form, setForm] = useState({ name: "", address: "" });
  const [previewing, setPreviewing] = useState(null);

  // ── Admin profile (for My Invoice tab) ──────────────────────────────────────
  const [adminProfileInfo, setAdminProfileInfo] = useState({ firstName: "", lastName: "", phone: "", email: "", legalAddress: "", bankName: "", bankAccount: "", accountName: "", invoicePrefix: "", showCompanyName: true });
  const [adminPositions, setAdminPositions] = useState([]);
  const [adminPromptPayQR, setAdminPromptPayQR] = useState(null);
  const [adminSignature, setAdminSignature] = useState(null);
  const [headerLogo, setHeaderLogo] = useState(null);
  const [headerLogoPos, setHeaderLogoPos] = useState({ x: 10, y: 10, opacity: 1, width: 40 });
  const [watermarkLogo, setWatermarkLogo] = useState(null);
  const [watermarkLogoPos, setWatermarkLogoPos] = useState({ x: 50, y: 120, opacity: 0.08, width: 120 });
  const [adminProfileLoaded, setAdminProfileLoaded] = useState(false);
  const headerLogoRef = useRef(null);
  const watermarkLogoRef = useRef(null);
  const [adminSaveStatus, setAdminSaveStatus] = useState(null);
  const [adminCreateModal, setAdminCreateModal] = useState(false);
  const [adminEditInvoice, setAdminEditInvoice] = useState(null);
  const [docTypeFilter, setDocTypeFilter] = useState("all");
  const adminPromptPayRef = useRef(null);
  const a4Ref = useRef(null);
  const dragging = useRef(null);
  const startLogoDrag = (e, setPos, currentPos) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = { setPos, startClientX: e.clientX, startClientY: e.clientY, startPosX: currentPos.x, startPosY: currentPos.y };
  };
  const moveLogoDrag = (e) => {
    if (!dragging.current) return;
    const rect = a4Ref.current?.getBoundingClientRect();
    if (!rect) return;
    const { setPos, startClientX, startClientY, startPosX, startPosY } = dragging.current;
    const dx = (e.clientX - startClientX) * (210 / rect.width);
    const dy = (e.clientY - startClientY) * (297 / rect.height);
    setPos(p => ({ ...p, x: Math.max(0, Math.round((startPosX + dx) * 10) / 10), y: Math.max(0, Math.round((startPosY + dy) * 10) / 10) }));
  };
  const endLogoDrag = () => { dragging.current = null; };
  const adminSigRef = useRef(null);

  useEffect(() => {
    api.getProfile("admin").then(d => {
      if (d) {
        setAdminProfileInfo({ firstName: d.firstName || "", lastName: d.lastName || "", phone: d.phone || "", email: d.email || "", legalAddress: d.legalAddress || "", bankName: d.bankName || "", bankAccount: d.bankAccount || "", accountName: d.accountName || "", invoicePrefix: d.invoicePrefix || "", showCompanyName: d.showCompanyName !== false });
        if (d.promptPayQR) setAdminPromptPayQR(d.promptPayQR);
        if (d.signature) setAdminSignature(d.signature);
        if (Array.isArray(d.positions)) setAdminPositions(d.positions);
        if (d.headerLogo) setHeaderLogo(d.headerLogo);
        if (d.headerLogoPos) setHeaderLogoPos(p => ({ ...p, ...d.headerLogoPos }));
        if (d.watermarkLogo) setWatermarkLogo(d.watermarkLogo);
        if (d.watermarkLogoPos) setWatermarkLogoPos(p => ({ ...p, ...d.watermarkLogoPos }));
      }
      setAdminProfileLoaded(true);
    }).catch(() => setAdminProfileLoaded(true));
  }, []);

  const addAdminPosition = () => setAdminPositions(p => p.length >= 5 ? p : [...p, { id: "pos" + Date.now(), name: "", dayRate: "", hoursPerDay: "12", variableOT: false, otMultiplier: "1.5", otTiers: DEFAULT_OT_TIERS.map(tr => ({ ...tr })) }]);
  const updateAdminPosition = (id, patch) => setAdminPositions(p => p.map(x => x.id === id ? { ...x, ...patch } : x));
  const removeAdminPosition = (id) => setAdminPositions(p => p.filter(x => x.id !== id));
  const updateAdminTier = (posId, idx, patch) => setAdminPositions(p => p.map(x => x.id === posId ? { ...x, otTiers: (x.otTiers || []).map((tr, i) => i === idx ? { ...tr, ...patch } : tr) } : x));
  const addAdminTier = (posId) => setAdminPositions(p => p.map(x => x.id === posId ? { ...x, otTiers: [...(x.otTiers || []), { untilHour: "", mult: "" }] } : x));
  const removeAdminTier = (posId, idx) => setAdminPositions(p => p.map(x => x.id === posId ? { ...x, otTiers: (x.otTiers || []).filter((_, i) => i !== idx) } : x));

  const saveAdminProfile = async () => {
    if (!adminProfileLoaded) return;
    setAdminSaveStatus("saving");
    try {
      const cleanPositions = adminPositions.filter(p => (p.name || "").trim()).map(p => ({ id: p.id, name: p.name.trim(), dayRate: parseFloat(p.dayRate) || 0, hoursPerDay: parseFloat(p.hoursPerDay) || 12, variableOT: !!p.variableOT, otMultiplier: parseFloat(p.otMultiplier) || 1.5, otTiers: (p.otTiers || []).map(tr => ({ untilHour: parseFloat(tr.untilHour) || 0, mult: parseFloat(tr.mult) || 0 })).filter(tr => tr.untilHour > 0 && tr.mult > 0) }));
      const res = await api.putProfile("admin", { ...adminProfileInfo, promptPayQR: adminPromptPayQR, signature: adminSignature, positions: cleanPositions, headerLogo, headerLogoPos, watermarkLogo, watermarkLogoPos });
      if (!res.ok) throw new Error();
      setAdminSaveStatus("saved");
      setTimeout(() => setAdminSaveStatus(null), 3000);
    } catch {
      setAdminSaveStatus("error");
      setTimeout(() => setAdminSaveStatus(null), 3500);
    }
  };

  const adminEmployee = { id: "admin", name: [adminProfileInfo.firstName, adminProfileInfo.lastName].filter(Boolean).join(" ").trim() || companyName || "Admin", role: "admin" };
  const myInvoices = invoices.filter(inv => inv.employeeId === "admin");

  const previewAdminInvoice = async (inv, doPrint = true) => {
    const win = window.open("", "_blank");
    if (win) win.document.write('<html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;color:#888;font-size:14px">Loading…</body></html>');
    const profileInfo = { phone: adminProfileInfo.phone, email: adminProfileInfo.email, legalAddress: adminProfileInfo.legalAddress, bankName: adminProfileInfo.bankName, bankAccount: adminProfileInfo.bankAccount, accountName: adminProfileInfo.accountName };
    const html = buildInvoiceHTML({ invoice: inv, employee: adminEmployee, profileInfo, promptPayQR: adminPromptPayQR, idCard: null, signature: adminSignature, productionCompanies, companyName, autoPrint: doPrint, headerLogo, headerLogoPos, watermarkLogo, watermarkLogoPos });
    if (win) { win.document.open(); win.document.write(html); win.document.close(); }
  };

  const previewInvoice = async (inv) => {
    if (previewing === inv.id) return;
    setPreviewing(inv.id);
    // Open window immediately while still in user-gesture context — popup blockers only allow
    // window.open() synchronously from a click handler, not after an await.
    const win = window.open("", "_blank");
    if (win) win.document.write('<html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;color:#888;font-size:14px">Loading invoice…</body></html>');
    try {
      const emp = employees.find(e => e.id === inv.employeeId) || { name: inv.employeeName, id: inv.employeeId };
      const profileData = await api.getProfile(inv.employeeId).catch(() => null);
      const profileInfo = profileData ? { phone: profileData.phone, email: profileData.email, lineId: profileData.lineId, legalAddress: profileData.legalAddress, bankName: profileData.bankName, bankAccount: profileData.bankAccount, accountName: profileData.accountName } : {};
      const html = buildInvoiceHTML({ invoice: inv, employee: emp, profileInfo, promptPayQR: profileData?.promptPayQR || null, idCard: profileData?.idCard || null, signature: profileData?.signature || null, productionCompanies, companyName, autoPrint: true });
      if (win) { win.document.open(); win.document.write(html); win.document.close(); }
    } catch { if (win) win.close(); }
    finally { setPreviewing(null); }
  };

  const open = (co = null) => {
    setEditTarget(co);
    setForm(co ? { name: co.name, address: co.address || "" } : { name: "", address: "" });
    setModal(true);
  };

  const save = () => {
    if (!form.name.trim()) return;
    if (editTarget) {
      setProductionCompanies(p => p.map(c => c.id === editTarget.id ? { ...c, ...form, name: form.name.trim() } : c));
    } else {
      setProductionCompanies(p => [...p, { id: "co" + Date.now(), name: form.name.trim(), address: form.address.trim() }]);
    }
    setModal(false);
  };

  const del = (id) => {
    if (window.confirm("Remove this production company?")) setProductionCompanies(p => p.filter(c => c.id !== id));
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 style={S.pageTitle}>Invoice</h1>
          <p style={S.pageSubtitle}>Production companies & team invoices</p>
        </div>
        {activeTab === "companies" && <button style={S.btn("primary")} onClick={() => open()}><Icon d={icons.plus} size={15} /> Add Company</button>}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 20 }}>
        {[["companies", "🏢 Companies"], ["invoices", `📄 All Invoices${invoices.length ? " (" + invoices.length + ")" : ""}`], ["myinvoice", `📋 My Invoice${myInvoices.length ? " (" + myInvoices.length + ")" : ""}`]].map(([key, lbl]) => (
          <button key={key} style={{ ...S.btn(activeTab === key ? "primary" : "ghost"), fontSize: 12, padding: "7px 14px" }} onClick={() => setActiveTab(key)}>{lbl}</button>
        ))}
      </div>

      {/* Companies tab */}
      {activeTab === "companies" && (
        <>
          {productionCompanies.length === 0 ? (
            <div style={{ ...S.card, textAlign: "center", padding: "40px 20px" }}>
              <Icon d={icons.building} size={36} color="var(--text-muted,#444)" />
              <p style={{ color: "var(--text-muted,#666)", fontSize: 13, marginTop: 12 }}>No production companies yet.</p>
              <p style={{ color: "var(--text-muted,#555)", fontSize: 12, marginTop: 4 }}>Add one — it will appear as a suggestion when creating jobs.</p>
            </div>
          ) : (
            <div style={S.col}>
              {productionCompanies.map(co => (
                <div key={co.id} style={{ ...S.card, display: "flex", alignItems: "flex-start", gap: 14 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: "rgba(232,184,75,0.1)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 2 }}>
                    <Icon d={icons.building} size={16} color="var(--accent,#e8b84b)" />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontWeight: 700, fontSize: 15, color: "var(--text,#e8e4dc)" }}>{co.name}</p>
                    {co.address ? <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-muted,#666)", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{co.address}</p>
                      : <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-muted,#444)", fontStyle: "italic" }}>No billing address</p>}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    <button style={{ ...S.btn("ghost"), padding: "5px 9px" }} onClick={() => open(co)}><Icon d={icons.edit} size={13} /></button>
                    <button style={{ ...S.btn("danger"), padding: "5px 9px" }} onClick={() => del(co.id)}><Icon d={icons.trash} size={13} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* All Invoices tab */}
      {activeTab === "invoices" && (
        <>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {[["all", "All"], ["invoice", "INV"], ["quotation", "QUO"], ["receipt", "RTX"]].map(([key, lbl]) => (
              <button key={key} onClick={() => setDocTypeFilter(key)}
                style={{ ...S.btn(docTypeFilter === key ? "primary" : "ghost"), padding: "5px 12px", fontSize: 12 }}>{lbl}</button>
            ))}
          </div>
          {invoices.filter(inv => docTypeFilter === "all" || (inv.docType || "invoice") === docTypeFilter).length === 0 ? (
            <div style={{ ...S.card, textAlign: "center", padding: "40px 20px" }}>
              <Icon d={icons.invoice} size={36} color="var(--text-muted,#444)" />
              <p style={{ color: "var(--text-muted,#666)", fontSize: 13, marginTop: 12 }}>No documents found.</p>
            </div>
          ) : (
            <div style={S.col}>
              {[...invoices].filter(inv => docTypeFilter === "all" || (inv.docType || "invoice") === docTypeFilter).sort((a, b) => b.updatedAt - a.updatedAt).map(inv => {
                const total = calcTotal(inv);
                const isPaid = (inv.status || "Pending") === "Paid";
                return (
                  <div key={inv.id} style={{ ...S.card, border: isPaid ? "1px solid rgba(52,211,153,0.25)" : "var(--card-border,1px solid #252830)" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 3 }}>
                          <span style={{ ...S.badge(isPaid ? "green" : "amber"), fontSize: 10 }}>{inv.status || "Pending"}</span>
                          <span style={{ ...S.badge("blue"), fontSize: 10 }}>{{ quotation: "QUO", receipt: "RTX" }[inv.docType] || "INV"}</span>
                          <p style={{ margin: 0, fontSize: 10, color: "var(--text-muted,#666)", fontFamily: "monospace" }}>{fmtInvoiceNo(inv)}</p>
                        </div>
                        <p style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>{inv.jobName}</p>
                        <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--text-muted,#666)" }}>{inv.employeeName} · {inv.position || "—"}</p>
                        <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--text-muted,#666)" }}>{inv.productionCompany}</p>
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <p style={{ margin: 0, fontWeight: 800, fontSize: 16, color: "var(--accent,#e8b84b)" }}>฿{total.toLocaleString()}</p>
                        <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--text-muted,#666)" }}>{new Date(inv.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</p>
                        <div style={{ display: "flex", gap: 6, marginTop: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                          <button style={{ ...S.btn("ghost"), fontSize: 11, padding: "4px 8px" }} onClick={() => previewInvoice(inv)} disabled={previewing === inv.id}>
                            {previewing === inv.id ? "…" : "Preview"}
                          </button>
                          <button style={{ ...S.btn(isPaid ? "ghost" : "success"), fontSize: 11, padding: "4px 8px" }} onClick={() => setInvoices(p => p.map(i => i.id === inv.id ? { ...i, status: isPaid ? "Pending" : "Paid" } : i))}>
                            {isPaid ? "Mark Pending" : "Mark Paid ✓"}
                          </button>
                          <button style={{ ...S.btn("danger"), fontSize: 11, padding: "4px 8px" }} onClick={() => { if (window.confirm("Delete this document?")) setInvoices(p => p.filter(i => i.id !== inv.id)); }}>
                            <Icon d={icons.trash} size={12} />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* My Invoice tab */}
      {activeTab === "myinvoice" && (
        <div style={S.col}>
          {/* Profile card */}
          <div style={S.card}>
            <p style={S.sectionTitle}>My Info</p>
            <div style={S.col}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div><label style={S.label}>First Name</label><input style={S.input} value={adminProfileInfo.firstName} onChange={e => setAdminProfileInfo(p => ({ ...p, firstName: e.target.value }))} /></div>
                <div><label style={S.label}>Last Name</label><input style={S.input} value={adminProfileInfo.lastName} onChange={e => setAdminProfileInfo(p => ({ ...p, lastName: e.target.value }))} /></div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div><label style={S.label}>Phone</label><input style={S.input} type="tel" value={adminProfileInfo.phone} onChange={e => setAdminProfileInfo(p => ({ ...p, phone: e.target.value }))} /></div>
                <div><label style={S.label}>Email</label><input style={S.input} type="email" value={adminProfileInfo.email} onChange={e => setAdminProfileInfo(p => ({ ...p, email: e.target.value }))} /></div>
              </div>
              <div><label style={S.label}>{t("legalAddress")}</label><textarea style={{ ...S.input, height: 72, resize: "vertical", lineHeight: 1.5 }} value={adminProfileInfo.legalAddress} onChange={e => setAdminProfileInfo(p => ({ ...p, legalAddress: e.target.value }))} /></div>
            </div>
          </div>

          {/* Positions card */}
          <div style={S.card}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <p style={{ ...S.sectionTitle, margin: 0 }}>{t("positionsTitle")}</p>
              {adminPositions.length < 5 && <button style={{ ...S.btn("ghost"), padding: "5px 10px", fontSize: 12 }} onClick={addAdminPosition}><Icon d={icons.plus} size={12} /> {t("addRoleBtn")}</button>}
            </div>
            <p style={{ fontSize: 11, color: "var(--text-muted,#666)", margin: "0 0 14px", lineHeight: 1.6 }}>{t("positionsDesc")}</p>
            {adminPositions.length === 0 && <p style={{ fontSize: 13, color: "#666", margin: 0 }}>{t("positionsEmpty")}</p>}
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {adminPositions.map((pos, i) => {
                const rph = (parseFloat(pos.dayRate) || 0) / (parseFloat(pos.hoursPerDay) || 12);
                return (
                  <div key={pos.id} style={{ border: "1px solid #2e3340", borderRadius: 10, padding: 14, background: "rgba(255,255,255,0.02)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                      <span style={S.badge("amber")}>{t("roleLabel")} {i + 1}</span>
                      <div style={{ flex: 1 }} />
                      <button style={{ ...S.btn("danger"), padding: "5px 8px" }} onClick={() => removeAdminPosition(pos.id)}><Icon d={icons.trash} size={13} /></button>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      <div><label style={S.label}>{t("positionName")}</label><input style={S.input} value={pos.name} placeholder="e.g. Camera Operator" onChange={e => updateAdminPosition(pos.id, { name: e.target.value })} /></div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                        <div><label style={S.label}>{t("dayRateLabel")}</label><input style={S.input} type="number" min="0" inputMode="decimal" value={pos.dayRate} placeholder="4500" onChange={e => updateAdminPosition(pos.id, { dayRate: e.target.value })} /></div>
                        <div><label style={S.label}>{t("hoursPerDayLabel")}</label><input style={S.input} type="number" min="1" inputMode="decimal" value={pos.hoursPerDay} placeholder="12" onChange={e => updateAdminPosition(pos.id, { hoursPerDay: e.target.value })} /></div>
                      </div>
                      {parseFloat(pos.dayRate) > 0 && parseFloat(pos.hoursPerDay) > 0 && <p style={{ fontSize: 11, color: "var(--text-muted,#666)", margin: 0 }}>{t("hourlyRate")}: ฿{rph.toLocaleString(undefined, { maximumFractionDigits: 2 })}{t("perHr")}</p>}
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <label style={{ ...S.label, margin: 0 }}>{t("otLabel").replace("{h}", parseFloat(pos.hoursPerDay) || 12)}</label>
                        <div style={{ flex: 1 }} />
                        <button onClick={() => updateAdminPosition(pos.id, { variableOT: !pos.variableOT })} style={{ ...S.btn(pos.variableOT ? "primary" : "ghost"), padding: "5px 10px", fontSize: 12 }}>{pos.variableOT ? t("variableOT") : t("flatOT")}</button>
                      </div>
                      {!pos.variableOT ? (
                        <div><label style={S.label}>{t("otMultiplierLabel")}</label><input style={{ ...S.input, maxWidth: 140 }} type="number" min="1" step="0.25" inputMode="decimal" value={pos.otMultiplier} placeholder="1.5" onChange={e => updateAdminPosition(pos.id, { otMultiplier: e.target.value })} /></div>
                      ) : (
                        <div>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                            <label style={{ ...S.label, margin: 0 }}>{t("otTiersLabel")}</label>
                            <button style={{ ...S.btn("ghost"), padding: "3px 8px", fontSize: 11 }} onClick={() => addAdminTier(pos.id)}><Icon d={icons.plus} size={11} /> {t("addTierBtn")}</button>
                          </div>
                          {(pos.otTiers || []).map((tr, ti) => {
                            const from = ti === 0 ? (parseFloat(pos.hoursPerDay) || 12) : (parseFloat((pos.otTiers[ti - 1] || {}).untilHour) || 0);
                            return (
                              <div key={ti} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 32px", gap: 6, alignItems: "center", marginBottom: 6 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                  <span style={{ fontSize: 11, color: "#666", whiteSpace: "nowrap" }}>{from}h–</span>
                                  <input style={{ ...S.input, padding: "7px 8px" }} type="number" min="0" inputMode="decimal" value={tr.untilHour} placeholder="14" onChange={e => updateAdminTier(pos.id, ti, { untilHour: e.target.value })} />
                                  <span style={{ fontSize: 11, color: "#666" }}>h</span>
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                  <input style={{ ...S.input, padding: "7px 8px" }} type="number" min="1" step="0.25" inputMode="decimal" value={tr.mult} placeholder="1.5" onChange={e => updateAdminTier(pos.id, ti, { mult: e.target.value })} />
                                  <span style={{ fontSize: 11, color: "#666" }}>×</span>
                                </div>
                                <button style={{ ...S.btn("danger"), padding: "5px 6px", minWidth: 0 }} onClick={() => removeAdminTier(pos.id, ti)}><Icon d={icons.x} size={12} /></button>
                              </div>
                            );
                          })}
                          <p style={{ fontSize: 10, color: "#555", margin: "2px 0 0" }}>{t("otTiersNote")}</p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Documents card */}
          <div style={S.card}>
            <p style={S.sectionTitle}>{t("documents")}</p>
            <div style={S.col}>
              <div>
                <label style={S.label}>{t("promptPayQR")}</label>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  {adminPromptPayQR && <img src={adminPromptPayQR} alt="QR" style={{ width: 80, height: 80, objectFit: "contain", borderRadius: 6, border: "1px solid #2e3340", background: "#fff" }} />}
                  <input ref={adminPromptPayRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => { const f = e.target.files[0]; if (!f) return; compressImage(f, { maxDim: 1000, quality: 0.85 }).then(d => d && setAdminPromptPayQR(d)); }} />
                  <button style={S.btn("ghost")} onClick={() => adminPromptPayRef.current.click()}><Icon d={icons.photo} size={14} /> {adminPromptPayQR ? t("replacePhoto") : t("uploadPhoto")}</button>
                  {adminPromptPayQR && <button style={{ ...S.btn("danger"), padding: "7px 10px" }} onClick={() => setAdminPromptPayQR(null)}><Icon d={icons.x} size={13} /></button>}
                </div>
              </div>
              <div>
                <label style={S.label}>{t("bankDetails")}</label>
                <div style={S.col}>
                  <input style={S.input} placeholder={t("bankNameLabel")} value={adminProfileInfo.bankName} onChange={e => setAdminProfileInfo(p => ({ ...p, bankName: e.target.value }))} />
                  <input style={S.input} placeholder={t("accountNameLabel")} value={adminProfileInfo.accountName} onChange={e => setAdminProfileInfo(p => ({ ...p, accountName: e.target.value }))} />
                  <input style={S.input} placeholder={t("accountNumberLabel")} value={adminProfileInfo.bankAccount} onChange={e => setAdminProfileInfo(p => ({ ...p, bankAccount: e.target.value }))} />
                </div>
              </div>
              <div>
                <label style={S.label}>Invoice Prefix</label>
                <p style={{ fontSize: 11, color: "var(--text-muted,#666)", margin: "0 0 6px" }}>Used in invoice number: INV-<strong>XXXX</strong>-YY-####. Max 6 chars.</p>
                <input style={{ ...S.input, textTransform: "uppercase" }} placeholder="e.g. ADM" maxLength={6}
                  value={adminProfileInfo.invoicePrefix}
                  onChange={e => setAdminProfileInfo(p => ({ ...p, invoicePrefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") }))} />
              </div>
              <button onClick={() => setAdminProfileInfo(p => ({ ...p, showCompanyName: !p.showCompanyName }))} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 8, background: adminProfileInfo.showCompanyName ? "rgba(232,184,75,0.05)" : "rgba(255,255,255,0.02)", border: `1px solid ${adminProfileInfo.showCompanyName ? "rgba(232,184,75,0.25)" : "#252830"}`, cursor: "pointer", userSelect: "none", textAlign: "left" }}>
                <div style={{ width: 36, height: 20, borderRadius: 10, background: adminProfileInfo.showCompanyName ? "var(--accent,#e8b84b)" : "#444", position: "relative", flexShrink: 0, transition: "background .2s" }}>
                  <div style={{ position: "absolute", top: 2, left: adminProfileInfo.showCompanyName ? 18 : 2, width: 16, height: 16, borderRadius: "50%", background: "#fff", transition: "left .2s", boxShadow: "0 1px 3px rgba(0,0,0,.3)" }} />
                </div>
                <div>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: adminProfileInfo.showCompanyName ? "var(--accent,#e8b84b)" : "var(--text,#e8e4dc)" }}>Company name on invoice {adminProfileInfo.showCompanyName ? "ON" : "OFF"}</p>
                  <p style={{ margin: 0, fontSize: 11, color: "var(--text-muted,#666)", marginTop: 2 }}>{adminProfileInfo.showCompanyName ? `"${companyName || "Pick Shoot Return"}" shown at top of document` : "Company name hidden from document header"}</p>
                </div>
              </button>
              <div>
                <label style={S.label}>{t("signatureSection")}</label>
                <p style={{ fontSize: 11, color: "var(--text-muted,#666)", margin: "0 0 8px" }}>{t("signatureHint")}</p>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  {adminSignature && <img src={adminSignature} alt="Signature" style={{ height: 50, maxWidth: 160, objectFit: "contain", borderRadius: 6, border: "1px solid #2e3340", background: "#fff", padding: 4 }} />}
                  <input ref={adminSigRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = (ev) => makeSignatureTransparent(ev.target.result).then(setAdminSignature); r.readAsDataURL(f); }} />
                  <button style={S.btn("ghost")} onClick={() => adminSigRef.current.click()}><Icon d={icons.photo} size={14} /> {adminSignature ? t("replacePhoto") : t("uploadSignature")}</button>
                  {adminSignature && <button style={{ ...S.btn("danger"), padding: "7px 10px" }} onClick={() => setAdminSignature(null)}><Icon d={icons.x} size={13} /></button>}
                </div>
              </div>
            </div>
          </div>

          {/* A4 Live Preview */}
          <div style={{ ...S.card, marginTop: 12 }}>
            <p style={{ ...S.sectionTitle, margin: "0 0 4px" }}>A4 Preview</p>
            <p style={{ fontSize: 11, color: "var(--text-muted,#666)", margin: "0 0 10px" }}>Drag logos directly on the page. <span style={{ color: "#e8b84b" }}>H</span> = Header · <span style={{ color: "#818cf8" }}>W</span> = Watermark</p>
            <div style={{ display: "flex", justifyContent: "center", background: "#0f1117", borderRadius: 6, padding: "14px 10px" }}>
              <div
                ref={a4Ref}
                style={{
                  position: "relative",
                  width: "100%",
                  maxWidth: 220,
                  aspectRatio: "210 / 297",
                  background: "#fff",
                  boxShadow: "0 4px 24px rgba(0,0,0,0.7)",
                  borderRadius: 2,
                  overflow: "hidden",
                  userSelect: "none",
                  flexShrink: 0,
                }}
              >
                {/* Simulated page chrome */}
                <div style={{ position: "absolute", top: "7%", left: "8%", right: "8%", height: 2, background: "#e0e0e0", borderRadius: 1 }} />
                {[17, 22, 27, 32, 37, 42, 47, 52, 57, 62, 67, 72].map(pct => (
                  <div key={pct} style={{ position: "absolute", top: `${pct}%`, left: "8%", right: pct % 10 === 7 ? "35%" : "8%", height: 2, background: "#f0f0f0", borderRadius: 1 }} />
                ))}
                <div style={{ position: "absolute", bottom: "6%", left: "8%", right: "8%", height: 1, background: "#e0e0e0" }} />

                {!headerLogo && !watermarkLogo && (
                  <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <p style={{ color: "#bbb", fontSize: 10, textAlign: "center", padding: "0 16px", lineHeight: 1.5 }}>Upload logos below<br />to preview here</p>
                  </div>
                )}

                {/* Watermark (z-index 1) */}
                {watermarkLogo && (
                  <>
                    <img
                      src={watermarkLogo}
                      draggable={false}
                      onPointerDown={e => startLogoDrag(e, setWatermarkLogoPos, watermarkLogoPos)}
                      onPointerMove={moveLogoDrag}
                      onPointerUp={endLogoDrag}
                      onPointerCancel={endLogoDrag}
                      style={{
                        position: "absolute",
                        left: `${(watermarkLogoPos.x / 210 * 100).toFixed(2)}%`,
                        top: `${(watermarkLogoPos.y / 297 * 100).toFixed(2)}%`,
                        width: `${(watermarkLogoPos.width / 210 * 100).toFixed(2)}%`,
                        opacity: watermarkLogoPos.opacity,
                        cursor: "move",
                        userSelect: "none",
                        touchAction: "none",
                        zIndex: 1,
                      }}
                    />
                    <div style={{ position: "absolute", left: `${(watermarkLogoPos.x / 210 * 100).toFixed(2)}%`, top: `${(watermarkLogoPos.y / 297 * 100).toFixed(2)}%`, background: "rgba(129,140,248,0.9)", color: "#fff", fontSize: 7, fontWeight: 700, padding: "1px 3px", borderRadius: 2, pointerEvents: "none", zIndex: 10, lineHeight: 1.4 }}>W</div>
                  </>
                )}

                {/* Header logo (z-index 2) */}
                {headerLogo && (
                  <>
                    <img
                      src={headerLogo}
                      draggable={false}
                      onPointerDown={e => startLogoDrag(e, setHeaderLogoPos, headerLogoPos)}
                      onPointerMove={moveLogoDrag}
                      onPointerUp={endLogoDrag}
                      onPointerCancel={endLogoDrag}
                      style={{
                        position: "absolute",
                        left: `${(headerLogoPos.x / 210 * 100).toFixed(2)}%`,
                        top: `${(headerLogoPos.y / 297 * 100).toFixed(2)}%`,
                        width: `${(headerLogoPos.width / 210 * 100).toFixed(2)}%`,
                        opacity: headerLogoPos.opacity,
                        cursor: "move",
                        userSelect: "none",
                        touchAction: "none",
                        zIndex: 2,
                      }}
                    />
                    <div style={{ position: "absolute", left: `${(headerLogoPos.x / 210 * 100).toFixed(2)}%`, top: `${(headerLogoPos.y / 297 * 100).toFixed(2)}%`, background: "rgba(232,184,75,0.9)", color: "#000", fontSize: 7, fontWeight: 700, padding: "1px 3px", borderRadius: 2, pointerEvents: "none", zIndex: 10, lineHeight: 1.4 }}>H</div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Per-logo controls */}
          {[
            { label: "Header Logo", logo: headerLogo, setLogo: setHeaderLogo, pos: headerLogoPos, setPos: setHeaderLogoPos, ref: headerLogoRef },
            { label: "Watermark Logo", logo: watermarkLogo, setLogo: setWatermarkLogo, pos: watermarkLogoPos, setPos: setWatermarkLogoPos, ref: watermarkLogoRef },
          ].map(({ label, logo, setLogo, pos, setPos, ref }) => {
            const jog = (axis, amt) => setPos(p => ({ ...p, [axis]: Math.round((p[axis] + amt) * 10) / 10 }));
            return (
              <div key={label} style={{ ...S.card, marginTop: 12 }}>
                <p style={{ ...S.sectionTitle, margin: "0 0 10px" }}>{label}</p>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
                  {logo && <img src={logo} alt="" style={{ height: 48, maxWidth: 120, objectFit: "contain", borderRadius: 4, border: "1px solid #252830", background: "#fff", padding: 2 }} />}
                  <input ref={ref} type="file" accept="image/*" style={{ display: "none" }} onChange={e => { const f = e.target.files[0]; if (!f) return; compressImage(f, { maxDim: 800, quality: 0.85 }).then(d => d && setLogo(d)); }} />
                  <button style={S.btn("ghost")} onClick={() => ref.current.click()}><Icon d={icons.photo} size={14} /> {logo ? "Replace" : "Upload"}</button>
                  {logo && <button style={{ ...S.btn("danger"), padding: "7px 10px" }} onClick={() => setLogo(null)}><Icon d={icons.x} size={13} /></button>}
                </div>
                {logo && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 12, color: "var(--text-muted,#666)", width: 64, flexShrink: 0 }}>X: {pos.x}mm</span>
                      <button style={{ ...S.btn("ghost"), padding: "4px 8px", fontSize: 11 }} onClick={() => jog("x", -10)}>−10</button>
                      <button style={{ ...S.btn("ghost"), padding: "4px 8px", fontSize: 11 }} onClick={() => jog("x", -1)}>−1</button>
                      <button style={{ ...S.btn("ghost"), padding: "4px 8px", fontSize: 11 }} onClick={() => jog("x", 1)}>+1</button>
                      <button style={{ ...S.btn("ghost"), padding: "4px 8px", fontSize: 11 }} onClick={() => jog("x", 10)}>+10</button>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 12, color: "var(--text-muted,#666)", width: 64, flexShrink: 0 }}>Y: {pos.y}mm</span>
                      <button style={{ ...S.btn("ghost"), padding: "4px 8px", fontSize: 11 }} onClick={() => jog("y", -10)}>−10</button>
                      <button style={{ ...S.btn("ghost"), padding: "4px 8px", fontSize: 11 }} onClick={() => jog("y", -1)}>−1</button>
                      <button style={{ ...S.btn("ghost"), padding: "4px 8px", fontSize: 11 }} onClick={() => jog("y", 1)}>+1</button>
                      <button style={{ ...S.btn("ghost"), padding: "4px 8px", fontSize: 11 }} onClick={() => jog("y", 10)}>+10</button>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 12, color: "var(--text-muted,#666)", width: 64, flexShrink: 0 }}>W: {pos.width}mm</span>
                      <button style={{ ...S.btn("ghost"), padding: "4px 8px", fontSize: 11 }} onClick={() => jog("width", -10)}>−10</button>
                      <button style={{ ...S.btn("ghost"), padding: "4px 8px", fontSize: 11 }} onClick={() => jog("width", -1)}>−1</button>
                      <button style={{ ...S.btn("ghost"), padding: "4px 8px", fontSize: 11 }} onClick={() => jog("width", 1)}>+1</button>
                      <button style={{ ...S.btn("ghost"), padding: "4px 8px", fontSize: 11 }} onClick={() => jog("width", 10)}>+10</button>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 12, color: "var(--text-muted,#666)", width: 64, flexShrink: 0 }}>Opacity: {Math.round(pos.opacity * 100)}%</span>
                      <input type="range" min="0" max="100" value={Math.round(pos.opacity * 100)} onChange={e => setPos(p => ({ ...p, opacity: parseInt(e.target.value) / 100 }))} style={{ flex: 1 }} />
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Save profile button */}
          <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12 }}>
            {adminSaveStatus === "saved" && <span style={{ fontSize: 13, color: "#34d399" }}>Saved</span>}
            {adminSaveStatus === "error" && <span style={{ fontSize: 13, color: "#f87171" }}>Save failed</span>}
            <button style={{ ...S.btn("primary"), minWidth: 120 }} onClick={saveAdminProfile} disabled={adminSaveStatus === "saving"}>
              {adminSaveStatus === "saving" ? "Saving…" : "Save Profile"}
            </button>
          </div>

          {/* My invoices */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
            <p style={{ ...S.sectionTitle, margin: 0 }}>My Invoices</p>
            <button style={S.btn("primary")} onClick={() => { setAdminEditInvoice(null); setAdminCreateModal(true); }}><Icon d={icons.plus} size={14} /> Create Invoice</button>
          </div>
          {myInvoices.length === 0 ? (
            <div style={{ ...S.card, textAlign: "center", padding: "30px 20px" }}>
              <p style={{ color: "var(--text-muted,#666)", fontSize: 13 }}>No invoices yet. Create your first one.</p>
            </div>
          ) : (
            <div style={S.col}>
              {[...myInvoices].sort((a, b) => b.updatedAt - a.updatedAt).map(inv => {
                const total = calcTotal(inv);
                const isPaid = (inv.status || "Pending") === "Paid";
                return (
                  <div key={inv.id} style={{ ...S.card, border: isPaid ? "1px solid rgba(52,211,153,0.25)" : "var(--card-border,1px solid #252830)" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 3 }}>
                          <span style={{ ...S.badge(isPaid ? "green" : "amber"), fontSize: 10 }}>{inv.status || "Pending"}</span>
                          <span style={{ fontSize: 10, color: "var(--text-muted,#666)", fontFamily: "monospace" }}>{fmtInvoiceNo(inv)}</span>
                        </div>
                        <p style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>{inv.jobName}</p>
                        <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--text-muted,#666)" }}>{inv.position || "—"} · {inv.productionCompany}</p>
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <p style={{ margin: 0, fontWeight: 800, fontSize: 16, color: "var(--accent,#e8b84b)" }}>฿{total.toLocaleString()}</p>
                        <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--text-muted,#666)" }}>{new Date(inv.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</p>
                        <div style={{ display: "flex", gap: 6, marginTop: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                          <button style={{ ...S.btn("ghost"), fontSize: 11, padding: "4px 8px" }} onClick={() => previewAdminInvoice(inv, false)}>Preview</button>
                          <button style={{ ...S.btn("ghost"), fontSize: 11, padding: "4px 8px" }} onClick={() => previewAdminInvoice(inv, true)}>Print</button>
                          <button style={{ ...S.btn("ghost"), fontSize: 11, padding: "4px 8px" }} onClick={() => { setAdminEditInvoice(inv); setAdminCreateModal(true); }}>Edit</button>
                          <button style={{ ...S.btn(isPaid ? "ghost" : "success"), fontSize: 11, padding: "4px 8px" }} onClick={() => setInvoices(p => p.map(i => i.id === inv.id ? { ...i, status: isPaid ? "Pending" : "Paid" } : i))}>{isPaid ? "Mark Pending" : "Mark Paid ✓"}</button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {modal && (
        <Modal title={editTarget ? "Edit Production Company" : "Add Production Company"} onClose={() => setModal(false)}>
          <div style={S.col}>
            <div>
              <label style={S.label}>Company Name</label>
              <input style={S.input} value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. One More Films" autoFocus />
            </div>
            <div>
              <label style={S.label}>Billing Address</label>
              <textarea style={{ ...S.input, height: 100, resize: "vertical", lineHeight: 1.5 }} value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} placeholder={"e.g. 123 Silom Rd\nBangkok 10500\nThailand"} />
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button style={S.btn("ghost")} onClick={() => setModal(false)}>Cancel</button>
              <button style={S.btn("primary")} onClick={save}>{editTarget ? "Save Changes" : "Add Company"}</button>
            </div>
          </div>
        </Modal>
      )}

      {adminCreateModal && (
        <InvoiceCreateModal
          existingInvoice={adminEditInvoice}
          employee={{ ...adminEmployee, invoicePrefix: adminProfileInfo.invoicePrefix }}
          positions={adminPositions}
          allInvoices={invoices}
          companyName={adminProfileInfo.showCompanyName !== false ? companyName : ""}
          invoicePresets={invoicePresets}
          productionCompanies={productionCompanies}
          jobs={jobs}
          adminRequests={adminRequests}
          onSave={inv => {
            setInvoices(p => adminEditInvoice ? p.map(i => i.id === inv.id ? inv : i) : [...p, inv]);
            setAdminCreateModal(false);
          }}
          onClose={() => setAdminCreateModal(false)}
        />
      )}
    </div>
  );
}

// ─── ADMIN THEME SELECTOR ────────────────────────────────────────────────────
function ThemeSelector({ themeStyle, setThemeStyle, themePalette, setThemePalette }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    document.addEventListener("touchstart", h);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("touchstart", h); };
  }, [open]);

  const STYLE_OPTS = [
    { id: "neumorphism", label: "Neu" },
    { id: "glassmorphism", label: "Glass" },
    { id: "skeuomorphism", label: "Skeu" },
  ];
  const PALETTE_OPTS = [
    { id: "black-white",  dot: "#e0e0e0", label: "B&W" },
    { id: "teal-orange",  dot: "#ff6a2a", label: "Teal" },
    { id: "black-red",    dot: "#dd3333", label: "Red" },
    { id: "white-blue",   dot: "#1a60d0", label: "W·Blue" },
    { id: "black-yellow", dot: "#e8b84b", label: "Amber" },
    { id: "black-blue",   dot: "#3a80e8", label: "Blue" },
  ];
  const activeDot = PALETTE_OPTS.find(p => p.id === themePalette)?.dot || "#e8b84b";

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ display: "flex", alignItems: "center", gap: 5, background: open ? "rgba(232,184,75,0.1)" : "transparent", border: `1px solid ${open ? "var(--accent,#e8b84b)" : "var(--border-color,#2e3340)"}`, borderRadius: "var(--btn-radius,7px)", padding: "5px 10px", cursor: "pointer", color: "var(--text-muted,#8a8f9d)" }}
        title="Theme"
      >
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: activeDot, flexShrink: 0 }} />
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="var(--accent,#e8b84b)" strokeWidth={1.8} strokeLinecap="round">
          <path d="M12 2a10 10 0 1 0 0 20c1.1 0 2-.9 2-2v-.5c0-.55.45-1 1-1h1.5a2 2 0 0 0 2-2 10 10 0 0 0-6.5-9.5M8 12a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM12 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM16 12a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" />
        </svg>
      </button>

      {open && (
        <div style={{ position: "absolute", right: 0, top: "calc(100% + 8px)", background: "var(--surface,#1a1e27)", border: "var(--card-border,1px solid #252830)", borderRadius: "var(--card-radius,10px)", boxShadow: "0 8px 32px rgba(0,0,0,0.5)", backdropFilter: "var(--card-backdrop,none)", padding: 16, width: 210, zIndex: 300 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", color: "var(--text-muted,#666)", marginBottom: 8, textTransform: "uppercase" }}>Style</div>
          <div style={{ display: "flex", gap: 5, marginBottom: 14 }}>
            {STYLE_OPTS.map(s => (
              <button
                key={s.id}
                onClick={() => setThemeStyle(s.id)}
                style={{ flex: 1, padding: "7px 4px", borderRadius: 6, border: themeStyle === s.id ? "2px solid var(--accent,#e8b84b)" : "1px solid var(--border-color,#2e3340)", background: themeStyle === s.id ? "rgba(232,184,75,0.08)" : "transparent", color: themeStyle === s.id ? "var(--accent,#e8b84b)" : "var(--text-muted,#666)", fontSize: 10, fontWeight: 700, cursor: "pointer", letterSpacing: "0.04em" }}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", color: "var(--text-muted,#666)", marginBottom: 8, textTransform: "uppercase" }}>Color</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 5 }}>
            {PALETTE_OPTS.map(pal => (
              <button
                key={pal.id}
                onClick={() => setThemePalette(pal.id)}
                style={{ padding: "7px 4px", borderRadius: 6, border: themePalette === pal.id ? `2px solid ${pal.dot}` : "1px solid var(--border-color,#2e3340)", background: "transparent", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}
              >
                <div style={{ width: 16, height: 16, borderRadius: "50%", background: pal.dot }} />
                <span style={{ fontSize: 9, color: "var(--text-muted,#666)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.03em" }}>{pal.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ADMIN TOP BAR ────────────────────────────────────────────────────────────
function AdminTopBar({ onLogout, saveErr, offlineMode, companyName, onOpenSettings, notifItems }) {
  const t = useT();
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef(null);
  const notifCount = (notifItems || []).reduce((s, n) => s + n.count, 0);

  useEffect(() => {
    if (!notifOpen) return;
    const h = (e) => { if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false); };
    document.addEventListener("mousedown", h);
    document.addEventListener("touchstart", h);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("touchstart", h); };
  }, [notifOpen]);

  return (
    <header style={S.topbar}>
      <div style={S.logo}>
        <Icon d={icons.film} size={20} color="var(--accent,#e8b84b)" />
        <div>
          <div style={S.logoText}>{companyName || "GEAR DESK"}</div>
          <div style={{ ...S.logoSub, marginTop: 0 }}>Pick Shoot Return</div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {offlineMode && <span title="Using cached data — reconnecting" style={{ fontSize: 10, color: "#e8b84b", fontWeight: 700, letterSpacing: "0.04em" }}>⚠ OFFLINE</span>}
        {!offlineMode && saveErr && <span title="Sync error — retrying" style={{ fontSize: 10, color: "#f87171", fontWeight: 700, letterSpacing: "0.04em" }}>⚠ SYNC</span>}

        {/* Notification bell */}
        <div ref={notifRef} style={{ position: "relative" }}>
          <button
            onClick={() => setNotifOpen(o => !o)}
            style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", background: notifOpen ? "rgba(232,184,75,0.1)" : "transparent", border: "none", cursor: "pointer", padding: "6px", borderRadius: 6 }}
            title={t("notifTitle")}
          >
            <Icon d={icons.bell} size={18} color={notifCount > 0 ? "#e8b84b" : "var(--text-muted,#8a8f9d)"} />
            {notifCount > 0 && (
              <div style={{ position: "absolute", top: 4, right: 4, width: 8, height: 8, borderRadius: "50%", background: "#ef4444", border: "1.5px solid var(--bg,#0f1117)" }} />
            )}
          </button>
          {notifOpen && (
            <div style={{ position: "absolute", right: 0, top: "calc(100% + 8px)", background: "var(--surface,#1a1e27)", border: "var(--card-border,1px solid #252830)", borderRadius: 12, boxShadow: "0 8px 32px rgba(0,0,0,0.6)", width: 270, zIndex: 300 }}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--divider-color,#252830)" }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "var(--text,#e8e4dc)" }}>
                  {t("notifTitle")} {notifCount > 0 && <span style={{ ...{ padding: "1px 7px", borderRadius: 10, fontSize: 11, fontWeight: 700, background: "#ef4444", color: "#fff" } }}>{notifCount}</span>}
                </p>
              </div>
              {notifCount === 0 ? (
                <div style={{ padding: "20px 16px", textAlign: "center" }}>
                  <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted,#666)" }}>{t("notifAllCaughtUp")}</p>
                </div>
              ) : (
                <div>
                  {(notifItems || []).map((item, i) => (
                    <div
                      key={i}
                      onClick={() => { item.onClick(); setNotifOpen(false); }}
                      style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 16px", cursor: "pointer", borderBottom: i < notifItems.length - 1 ? "1px solid var(--divider-color,#252830)" : "none", background: "transparent" }}
                    >
                      <div style={{ width: 32, height: 32, borderRadius: 8, background: `${item.color}1a`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <Icon d={item.icon} size={15} color={item.color} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--text,#e8e4dc)" }}>{item.label}</p>
                        <p style={{ margin: "2px 0 0", fontSize: 11, color: item.color }}>{item.count} {t("notifItemsAttention")}</p>
                      </div>
                      <Icon d={icons.arrow_left} size={14} color="var(--text-muted,#555)" strokeW={2} style={{ transform: "rotate(180deg)" }} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Settings gear */}
        <button
          onClick={onOpenSettings}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", cursor: "pointer", padding: "6px", borderRadius: 6 }}
          title="Settings"
        >
          <Icon d={icons.gear} size={18} color="var(--text-muted,#8a8f9d)" />
        </button>

        {/* Logout */}
        <button
          onClick={onLogout}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", cursor: "pointer", padding: "6px", borderRadius: 6 }}
          title="Log out"
        >
          <Icon d={icons.logout} size={18} color="var(--text-muted,#8a8f9d)" />
        </button>
      </div>
    </header>
  );
}

// ─── ADMIN CHECKOUT PAGE ──────────────────────────────────────────────────────
function AdminCheckoutPage({ jobs, equipment, checkouts, setCheckouts, verificationConfig, employees }) {
  const t = useT();
  const todayStr = today();
  const [selectedJob, setSelectedJob] = useState(null);
  const [phase, setPhase] = useState("pick"); // "pick" | "return"
  const [captureAe, setCaptureAe] = useState(null);
  const [scanAe, setScanAe] = useState(null);
  const [itemResults, setItemResults] = useState({});
  const [barcodeResults, setBarcodeResults] = useState({});
  const vMode = verificationConfig?.mode || "photo";

  const getState = (job) => {
    const mode = job.checkoutMode || "span";
    const jc = checkouts.filter(c => c.jobId === job.id);
    const relevant = mode === "daily"
      ? jc.filter(c => new Intl.DateTimeFormat("en-CA", { timeZone: APP_TZ }).format(new Date(c.ts)) === todayStr)
      : jc;
    const pickedIds = new Set(relevant.filter(c => c.type === "pick" || c.type === "checkout").map(c => c.eqId));
    const returnedIds = new Set(relevant.filter(c => c.type === "return").map(c => c.eqId));
    const assigned = (job.assignedEquipment || []);
    const allPicked = assigned.length > 0 && assigned.every(ae => pickedIds.has(ae.eqId));
    const allReturned = assigned.length > 0 && assigned.every(ae => returnedIds.has(ae.eqId));
    return { pickedIds, returnedIds, allPicked, allReturned };
  };

  const confirmedJobs = (jobs || []).filter(j => j.status === "Confirmed" && (j.assignedEquipment || []).length > 0);

  const selectJob = (job) => {
    const { allPicked } = getState(job);
    setSelectedJob(job);
    setPhase(allPicked ? "return" : "pick");
    setItemResults({});
    setBarcodeResults({});
    setCaptureAe(null);
    setScanAe(null);
  };

  const hasBarcodeEvent = (eqId) => {
    const evType = phase === "return" ? "barcode_return" : "barcode_pick";
    return checkouts.some(c => c.jobId === selectedJob?.id && c.eqId === eqId && c.type === evType);
  };
  const hasPhotoEvent = (eqId) => {
    const evType = phase === "return" ? "return" : "pick";
    return checkouts.some(c => c.jobId === selectedJob?.id && c.eqId === eqId && (c.type === evType || c.type === "checkout"));
  };

  const commitItem = (ae, dataUrl, loc) => {
    const now = Date.now();
    const type = phase === "pick" ? "pick" : "return";
    setCheckouts(p => [...p, { id: "co" + now + ae.eqId, jobId: selectedJob.id, jobName: selectedJob.name, eqId: ae.eqId, qty: ae.qty, employeeId: "admin", employeeName: "Admin", type, ts: now, photo: dataUrl || null, location: loc || null, adminApproved: true }]);
    setItemResults(r => ({ ...r, [ae.eqId]: "ok" }));
  };

  const commitBarcode = (ae, loc) => {
    const now = Date.now();
    const type = phase === "pick" ? "barcode_pick" : "barcode_return";
    setCheckouts(p => [...p, { id: "co" + now + ae.eqId, jobId: selectedJob.id, jobName: selectedJob.name, eqId: ae.eqId, qty: ae.qty, employeeId: "admin", employeeName: "Admin", type, ts: now, photo: null, location: loc || null, adminApproved: true }]);
    setBarcodeResults(r => ({ ...r, [ae.eqId]: true }));
  };

  const onTapItem = (ae, lane) => {
    if (lane === "barcode") { setScanAe(ae); return; }
    if (vMode === "none") { commitItem(ae, null, null); return; }
    setCaptureAe(ae);
  };

  if (scanAe && selectedJob) {
    const eq = equipment.find(e => e.id === scanAe.eqId);
    return (
      <div style={{ minHeight: "100vh", background: "var(--bg,#0f1117)" }}>
        <QRScanner
          key={scanAe.eqId}
          label={`Scan QR label on: ${eq?.name || ""}`}
          onScan={(scannedId, loc) => {
            if (scannedId === scanAe.eqId) { commitBarcode(scanAe, loc); setScanAe(null); }
          }}
          onClose={() => setScanAe(null)}
        />
      </div>
    );
  }

  if (captureAe && selectedJob) {
    const eq = equipment.find(e => e.id === captureAe.eqId);
    const isReturn = phase === "return";
    return (
      <div style={{ minHeight: "100vh", background: "var(--bg,#0f1117)" }}>
        <div style={{ padding: "16px 16px 8px", display: "flex", alignItems: "center", gap: 12 }}>
          <button style={S.btn("ghost")} onClick={() => setCaptureAe(null)}><Icon d={icons.arrow_left} size={16} /> {t("back")}</button>
        </div>
        <GeoPhoto
          key={captureAe.eqId}
          label={`${isReturn ? t("adminReturnLabel") : t("adminPickLabel")} — ${eq?.name || ""}`}
          onCapture={(dataUrl, loc) => { commitItem(captureAe, dataUrl, loc); setCaptureAe(null); }}
        />
      </div>
    );
  }

  if (selectedJob) {
    const isReturn = phase === "return";
    const { pickedIds, returnedIds } = getState(selectedJob);
    const items = (selectedJob.assignedEquipment || []).filter(ae =>
      equipment.some(e => e.id === ae.eqId) && (isReturn ? pickedIds.has(ae.eqId) : true)
    );
    const itemDone = (ae) => {
      if (vMode === "both") {
        const bDone = hasBarcodeEvent(ae.eqId) || barcodeResults[ae.eqId];
        const pDone = (isReturn ? returnedIds.has(ae.eqId) : pickedIds.has(ae.eqId)) || itemResults[ae.eqId] === "ok";
        return bDone && pDone;
      }
      return (isReturn ? returnedIds.has(ae.eqId) : pickedIds.has(ae.eqId)) || itemResults[ae.eqId] === "ok";
    };
    const allDone = items.length > 0 && items.every(itemDone);

    return (
      <div style={{ minHeight: "100vh", background: "var(--bg,#0f1117)", paddingBottom: 100 }}>
        <div style={{ padding: "16px 16px 0", display: "flex", alignItems: "center", gap: 12, borderBottom: "1px solid var(--divider-color,#252830)", paddingBottom: 14, marginBottom: 16 }}>
          <button style={S.btn("ghost")} onClick={() => setSelectedJob(null)}><Icon d={icons.arrow_left} size={16} /> {t("back")}</button>
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--text,#e8e4dc)" }}>{selectedJob.name}</p>
            <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-muted,#666)" }}>{isReturn ? t("adminReturnLabel") : t("adminPickLabel")}</p>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button style={{ ...S.btn(!isReturn ? "primary" : "ghost"), padding: "6px 12px", fontSize: 12 }} onClick={() => { setPhase("pick"); setItemResults({}); }}>{t("adminPickLabel")}</button>
            <button style={{ ...S.btn(isReturn ? "primary" : "ghost"), padding: "6px 12px", fontSize: 12 }} onClick={() => { setPhase("return"); setItemResults({}); }}>{t("adminReturnLabel")}</button>
          </div>
        </div>
        <div style={{ padding: "0 16px" }}>
          {items.length === 0 ? (
            <p style={{ color: "#666", textAlign: "center", padding: 32 }}>{isReturn ? t("adminNoItemsOut") : t("adminAllPicked")}</p>
          ) : items.map(ae => {
            const eq = equipment.find(e => e.id === ae.eqId);
            const done = itemDone(ae);
            const barcodeDone = hasBarcodeEvent(ae.eqId) || barcodeResults[ae.eqId];
            const photoDone = (isReturn ? returnedIds.has(ae.eqId) : pickedIds.has(ae.eqId)) || itemResults[ae.eqId] === "ok";
            return (
              <div key={ae.eqId} style={{ ...S.card, display: "flex", alignItems: "center", gap: 12, marginBottom: 10, opacity: done ? 0.5 : 1 }}>
                {eq?.photo ? (
                  <img src={eq.photo} alt="" style={{ width: 44, height: 44, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />
                ) : (
                  <div style={{ width: 44, height: 44, borderRadius: 8, background: "#252830", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <Icon d={icons.camera} size={18} color="#555" />
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--text,#e8e4dc)" }}>{eq?.name || ae.eqId}</p>
                  {ae.qty > 1 && <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--text-muted,#666)" }}>×{ae.qty}</p>}
                  {vMode === "both" && !done && (
                    <p style={{ margin: "3px 0 0", fontSize: 11, color: "var(--text-muted,#666)" }}>
                      {barcodeDone ? "✓ Scanned" : "○ Scan"} · {photoDone ? "✓ Photo" : "○ Photo"}
                    </p>
                  )}
                </div>
                {done ? (
                  <span style={{ ...S.badge("green"), flexShrink: 0 }}>✓</span>
                ) : (
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    {(vMode === "barcode" || vMode === "both") && !barcodeDone && (
                      <button style={{ ...S.btn("ghost"), padding: "6px 10px" }} onClick={() => onTapItem(ae, "barcode")}>
                        <Icon d={icons.qr} size={16} />
                      </button>
                    )}
                    {(vMode === "photo" || vMode === "both") && !photoDone && (
                      <button style={{ ...S.btn("ghost"), padding: "6px 10px" }} onClick={() => onTapItem(ae, "photo")}>
                        <Icon d={icons.camera} size={16} />
                      </button>
                    )}
                    {vMode === "none" && (
                      <button style={{ ...S.btn("ghost"), padding: "6px 10px" }} onClick={() => onTapItem(ae, "photo")}>
                        <Icon d={icons.check} size={16} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {allDone && (
            <div style={{ ...S.card, background: "rgba(52,211,153,0.07)", border: "1px solid rgba(52,211,153,0.25)", textAlign: "center", padding: 20, marginTop: 8 }}>
              <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#34d399" }}>✓ {isReturn ? t("adminAllReturned") : t("adminAllPicked")}</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "20px 16px 100px" }}>
      <p style={{ ...S.sectionTitle, fontSize: 18, marginBottom: 4 }}>{t("adminCheckoutTitle")}</p>
      <p style={{ fontSize: 12, color: "var(--text-muted,#666)", marginBottom: 20 }}>{t("adminCheckoutDesc")}</p>
      {confirmedJobs.length === 0 ? (
        <p style={{ color: "#666", textAlign: "center", padding: 32 }}>{t("adminNoConfirmedJobs")}</p>
      ) : confirmedJobs.map(job => {
        const { pickedIds, returnedIds, allPicked, allReturned } = getState(job);
        const outCount = pickedIds.size - returnedIds.size;
        return (
          <div key={job.id} style={{ ...S.card, marginBottom: 12, cursor: "pointer" }} onClick={() => selectJob(job)}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "var(--text,#e8e4dc)" }}>{job.name}</p>
                <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--text-muted,#666)" }}>
                  {(job.assignedEquipment || []).length} {t("jobAssignedEq").toLowerCase()} · {(job.dates || []).join(", ")}
                </p>
              </div>
              {allReturned
                ? <span style={S.badge("green")}>✓</span>
                : outCount > 0
                  ? <span style={S.badge("amber")}>{outCount} {t("dashEqOutToday").replace("Equipment ", "").toLowerCase()}</span>
                  : <span style={S.badge("gray")}>{t("adminPickLabel")}</span>
              }
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── ADMIN BOTTOM NAV ─────────────────────────────────────────────────────────
function AdminBottomNav({ activePage, setActivePage, unresolvedCount, navOrder }) {
  const t = useT();
  const navItems = [
    { key: "dashboard", label: t("navDashboard"), icon: icons.film },
    { key: "equipment", label: t("navEquipment"), icon: icons.camera },
    { key: "jobs", label: t("navJobs"), icon: icons.calendar },
    { key: "invoice", label: t("navInvoice"), icon: icons.invoice },
    { key: "team", label: t("navTeam"), icon: icons.user },
    { key: "checkout", label: t("navCheckout"), icon: icons.package },
  ];
  const orderedItems = navOrder ? navOrder.map(k => navItems.find(n => n.key === k)).filter(Boolean) : navItems;

  return (
    <nav style={{
      position: "fixed", bottom: 0, left: 0, right: 0,
      height: 62,
      background: "var(--nav-bg,var(--topbar-bg,#161920))",
      borderTop: "var(--nav-border,var(--topbar-border,1px solid #252830))",
      boxShadow: "var(--nav-shadow,none)",
      backdropFilter: "var(--card-backdrop,none)",
      display: "flex", alignItems: "stretch",
      zIndex: 100,
      padding: "0 4px",
      paddingBottom: "env(safe-area-inset-bottom,0px)",
    }}>
      {orderedItems.map(n => {
        const active = activePage === n.key;
        return (
          <button
            key={n.key}
            onClick={() => setActivePage(n.key)}
            style={{
              flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              gap: 3, border: "none", cursor: "pointer", background: "transparent",
              color: active ? "var(--accent,#e8b84b)" : "var(--text-muted,#8a8f9d)",
              position: "relative", padding: "8px 2px 6px",
            }}
          >
            {active && <div style={{ position: "absolute", top: 0, left: "25%", right: "25%", height: 2, background: "var(--accent,#e8b84b)", borderRadius: "0 0 3px 3px" }} />}
            <div style={{ position: "relative" }}>
              <Icon d={n.icon} size={20} color={active ? "var(--accent,#e8b84b)" : "var(--text-muted,#8a8f9d)"} />
              {n.key === "reports" && unresolvedCount > 0 && (
                <div style={{ position: "absolute", top: -4, right: -6, background: "#ef4444", color: "#fff", fontSize: 9, fontWeight: 800, borderRadius: 8, padding: "1px 4px", minWidth: 14, textAlign: "center", lineHeight: "14px" }}>
                  {unresolvedCount}
                </div>
              )}
            </div>
            <span style={{ fontSize: 9.5, fontWeight: active ? 700 : 500, letterSpacing: "0.02em" }}>{n.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

// ─── ROOT APP ─────────────────────────────────────────────────────────────────
export default function App() {
  // Persist the signed-in user so a page refresh / pull-to-refresh keeps the session.
  const [user, setUser] = useState(() => { try { return JSON.parse(localStorage.getItem("psr_user") || "null"); } catch { return null; } });
  useEffect(() => { try { user ? localStorage.setItem("psr_user", JSON.stringify(user)) : localStorage.removeItem("psr_user"); } catch {} }, [user]);
  const [activePage, setActivePage] = useState("dashboard");
  const [settingsPanelOpen, setSettingsPanelOpen] = useState(false);
  const [equipment, setEquipment] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [checkouts, setCheckouts] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [reports, setReports] = useState([]);
  const [productionCompanies, setProductionCompanies] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [companyName, setCompanyName] = useState("GEAR DESK");
  const [equipmentRequests, setEquipmentRequests] = useState([]);
  const [adminRequests, setAdminRequests] = useState([]);
  const [adminPin, setAdminPin] = useState("1234");
  const [lineGroupId, setLineGroupId] = useState(null);
  const [timezone, setTimezone] = useState("Asia/Bangkok");
  const [timeFormat, setTimeFormat] = useState("24"); // "12" | "24"
  const [kpiConfig, setKpiConfig] = useState({ startDate: "", resetMonths: 12, maxPoints: 100 });
  const [punishments, setPunishments] = useState([]); // [{ id, label, points, description }]
  const [kpiEvents, setKpiEvents] = useState([]); // [{ id, employeeId, points, reason, punishmentId, ts, by }]
  const [photoVerification, setPhotoVerification] = useState(true); // legacy — kept for KV compat read; UI uses verificationConfig
  // verificationConfig: { mode: "none"|"photo"|"barcode"|"both" }
  // Derived from photoVerification on first load if verificationConfig hasn't been saved yet.
  const [verificationConfig, setVerificationConfig] = useState({ mode: "photo" });
  const [lineNotifyMuted, setLineNotifyMuted] = useState(() => { try { return localStorage.getItem("psr_notify_muted") === "1"; } catch { return false; } });
  const [loaded, setLoaded] = useState(false);
  const [cloudSynced, setCloudSynced] = useState(false);
  const [saveErr, setSaveErr] = useState(false);
  // needsInit: KV returned all-null — could be new account or outage.
  // Admin must explicitly click "Initialize" before auto-save is allowed.
  const [needsInit, setNeedsInit] = useState(false);
  // loadError: all 3 fetch attempts failed AND no localStorage cache available.
  const [loadError, setLoadError] = useState(false);
  // offlineMode: KV failed but we loaded successfully from localStorage cache.
  // cloudSynced stays false so no writes go to KV until reconnection succeeds.
  const [offlineMode, setOfflineMode] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  // Holds the last savePayload that failed — drained by the online-retry effect.
  const pendingSaveRef = useRef(null);
  const [lang, setLang] = useState(() => { try { return localStorage.getItem("psr_lang") || "en"; } catch { return "en"; } });
  const [themeStyle, setThemeStyle] = useState(() => { try { return localStorage.getItem("psr_theme_style") || "glassmorphism"; } catch { return "glassmorphism"; } });
  const [themePalette, setThemePalette] = useState(() => { try { return localStorage.getItem("psr_theme_palette") || "black-yellow"; } catch { return "black-yellow"; } });
  const [navOrder, setNavOrder] = useState(null);
  const [invoicePresets, setInvoicePresets] = useState([]);
  const saveTimer = useRef(null);
  // kvLoadedRef tracks which fields actually came back non-null from KV on the initial load.
  // postLoadSnapRef holds a reference snapshot of state right after load settles.
  // Together they allow the save effect to skip fields that were never loaded (preventing
  // initial defaults from overwriting real KV data when a field comes back null).
  const kvLoadedRef = useRef(new Set());
  const postLoadSnapRef = useRef(null);
  const snapTakenRef = useRef(false);

  useEffect(() => { try { localStorage.setItem("psr_lang", lang); } catch {} }, [lang]);

  // Keep the module-level date/time helpers in sync with admin prefs.
  useEffect(() => { setTimePrefs(timezone, timeFormat); }, [timezone, timeFormat]);

  useEffect(() => {
    const id = "psr-theme-style";
    let el = document.getElementById(id);
    if (!el) { el = document.createElement("style"); el.id = id; document.head.appendChild(el); }
    el.textContent = buildThemeCss(themeStyle, themePalette);
    try { localStorage.setItem("psr_theme_style", themeStyle); localStorage.setItem("psr_theme_palette", themePalette); } catch {}
  }, [themeStyle, themePalette]);

  // Stable data-apply function — used by both the initial load and the offline reconnect loop.
  // setState functions are guaranteed stable so [] deps is correct.
  const applyData = useCallback((d) => {
    const kl = kvLoadedRef.current;
    if (d.equipment) { setEquipment(d.equipment); kl.add("equipment"); }
    if (d.jobs) { setJobs(d.jobs); kl.add("jobs"); }
    if (d.checkouts) { setCheckouts(d.checkouts); kl.add("checkouts"); }
    if (d.employees) { setEmployees(d.employees); kl.add("employees"); }
    if (d.reports) { setReports(d.reports); kl.add("reports"); }
    if (d.productionCompanies) { setProductionCompanies(d.productionCompanies); kl.add("productionCompanies"); }
    if (d.invoices) { setInvoices(d.invoices); kl.add("invoices"); }
    if (d.companyName != null) { setCompanyName(d.companyName); kl.add("companyName"); }
    if (d.equipmentRequests) { setEquipmentRequests(d.equipmentRequests); kl.add("equipmentRequests"); }
    if (d.adminRequests) { setAdminRequests(d.adminRequests); kl.add("adminRequests"); }
    if (d.adminPin) { setAdminPin(d.adminPin); kl.add("adminPin"); }
    if (d.lineGroupId) { setLineGroupId(d.lineGroupId); kl.add("lineGroupId"); }
    if (d.timezone) { setTimezone(d.timezone); kl.add("timezone"); }
    if (d.timeFormat) { setTimeFormat(d.timeFormat); kl.add("timeFormat"); }
    if (d.kpiConfig) { setKpiConfig(d.kpiConfig); kl.add("kpiConfig"); }
    if (d.punishments) { setPunishments(d.punishments); kl.add("punishments"); }
    if (d.kpiEvents) { setKpiEvents(d.kpiEvents); kl.add("kpiEvents"); }
    if (d.photoVerification != null) { setPhotoVerification(d.photoVerification); kl.add("photoVerification"); }
    if (d.navOrder) { setNavOrder(d.navOrder); kl.add("navOrder"); }
    if (d.verificationConfig != null) {
      setVerificationConfig(d.verificationConfig); kl.add("verificationConfig");
    } else if (d.photoVerification != null) {
      // Migrate legacy boolean: true→photo, false→none
      setVerificationConfig({ mode: d.photoVerification ? "photo" : "none" });
      kl.add("verificationConfig");
    }
    if (d.invoicePresets != null) { setInvoicePresets(d.invoicePresets); kl.add("invoicePresets"); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Animate load progress bar — ramps to ~88% while fetching, snaps to 100 on completion.
  useEffect(() => {
    if (loaded) { setLoadProgress(100); return; }
    const iv = setInterval(() => {
      setLoadProgress(p => {
        if (p >= 88) return p;
        return Math.min(88, p + (p < 45 ? 5 : p < 72 ? 2 : 0.6));
      });
    }, 100);
    return () => clearInterval(iv);
  }, [loaded]);

  // Load all data from cloud on mount — up to 3 attempts with back-off.
  // On success: write a full-state cache to localStorage (Phase 1 cache write).
  // On total failure: fall back to localStorage cache so the app stays usable offline.
  // If all fields come back null, we block auto-save and require the admin
  // to explicitly confirm initialization (prevents mistaking a KV outage
  // for a brand-new empty account and overwriting real data).
  useEffect(() => {
    (async () => {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const d = await api.getData();
          applyData(d);
          // Phase 1: write fresh KV data to localStorage cache on every successful load
          try { localStorage.setItem(CACHE_KEY, JSON.stringify(d)); } catch {}
          if (kvLoadedRef.current.size === 0) {
            // All fields null — show explicit init screen; do NOT set cloudSynced.
            setNeedsInit(true);
          } else {
            setCloudSynced(true);
          }
          setLoaded(true);
          return;
        } catch {
          if (attempt < 3) {
            await new Promise(r => setTimeout(r, 1200 * attempt));
          } else {
            // All 3 KV attempts failed — try loading from localStorage cache.
            try {
              const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
              if (cached && typeof cached === "object") {
                applyData(cached);
                if (kvLoadedRef.current.size > 0) {
                  // Cache had real data — go to offline mode (cloudSynced stays false)
                  setOfflineMode(true);
                  setLoaded(true);
                  return;
                }
              }
            } catch {}
            // No cache either — show the hard error screen
            setLoadError(true);
            setLoaded(true);
          }
        }
      }
    })();
  }, [applyData]);

  // Capture a reference snapshot of all state right after the initial KV load settles.
  // Runs once when both loaded and cloudSynced first become true (before the save effect below).
  // The snapshot lets the save effect detect user changes via reference inequality.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!loaded || !cloudSynced || snapTakenRef.current) return;
    snapTakenRef.current = true;
    postLoadSnapRef.current = { equipment, jobs, checkouts, employees, reports, productionCompanies, invoices, companyName, equipmentRequests, adminRequests, adminPin, timezone, timeFormat, kpiConfig, punishments, kpiEvents, photoVerification, navOrder, lineGroupId, verificationConfig, invoicePresets };
  }, [loaded, cloudSynced]); // intentionally omits data deps — captures post-load state once

  // Phase 1 reconnect loop: when offlineMode is active, poll every 20s and on the
  // browser's "online" event. On success, reload the page so KV data is applied cleanly.
  useEffect(() => {
    if (!offlineMode) return;
    const tryReconnect = async () => {
      try {
        const d = await api.getData();
        if (d && typeof d === "object") {
          try { localStorage.setItem(CACHE_KEY, JSON.stringify(d)); } catch {}
          window.location.reload();
        }
      } catch {}
    };
    window.addEventListener("online", tryReconnect);
    const interval = setInterval(tryReconnect, 20000);
    return () => { window.removeEventListener("online", tryReconnect); clearInterval(interval); };
  }, [offlineMode]);

  // Save to cloud whenever data changes (debounced 800ms).
  // Triple guard: loaded + cloudSynced + field-level safety check.
  // safeSave(key, val) returns true if the field should be included in the payload:
  //   - it was loaded from KV (kvLoadedRef), OR
  //   - it changed from the post-load snapshot (user modified it), OR
  //   - it's a brand-new account (all KV keys were null → safe to write initial state)
  useEffect(() => {
    if (!loaded || !cloudSynced) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const kl = kvLoadedRef.current;
      const snap = postLoadSnapRef.current;
      // kl.size === 0 means admin just initialized a fresh account (needsInit was shown
      // and they clicked Initialize — initializeAccount() populated kl manually).
      // The newAccount path no longer auto-triggers; initialization is always explicit.
      const safeSave = (key, val) => kl.has(key) || (snap !== null && val !== snap[key]);

      const savePayload = {};
      if (safeSave("equipment", equipment)) savePayload.equipment = equipment;
      if (safeSave("jobs", jobs)) savePayload.jobs = jobs;
      if (safeSave("checkouts", checkouts)) savePayload.checkouts = checkouts;
      if (safeSave("employees", employees)) savePayload.employees = employees;
      if (safeSave("reports", reports)) savePayload.reports = reports;
      if (safeSave("productionCompanies", productionCompanies)) savePayload.productionCompanies = productionCompanies;
      if (safeSave("invoices", invoices)) savePayload.invoices = invoices;
      if (safeSave("companyName", companyName)) savePayload.companyName = companyName;
      if (safeSave("equipmentRequests", equipmentRequests)) savePayload.equipmentRequests = equipmentRequests;
      if (safeSave("adminRequests", adminRequests)) savePayload.adminRequests = adminRequests;
      if (safeSave("adminPin", adminPin)) savePayload.adminPin = adminPin;
      if (safeSave("timezone", timezone)) savePayload.timezone = timezone;
      if (safeSave("timeFormat", timeFormat)) savePayload.timeFormat = timeFormat;
      if (safeSave("kpiConfig", kpiConfig)) savePayload.kpiConfig = kpiConfig;
      if (safeSave("punishments", punishments)) savePayload.punishments = punishments;
      if (safeSave("kpiEvents", kpiEvents)) savePayload.kpiEvents = kpiEvents;
      if (safeSave("photoVerification", photoVerification)) savePayload.photoVerification = photoVerification;
      if (safeSave("navOrder", navOrder)) savePayload.navOrder = navOrder;
      if (safeSave("verificationConfig", verificationConfig)) savePayload.verificationConfig = verificationConfig;
      if (safeSave("invoicePresets", invoicePresets)) savePayload.invoicePresets = invoicePresets;
      // lineGroupId: null means "don't touch KV"; only save if truthy or user cleared it
      if (lineGroupId !== null && safeSave("lineGroupId", lineGroupId)) savePayload.lineGroupId = lineGroupId;

      if (Object.keys(savePayload).length === 0) return;
      // Phase 1: build a full-state snapshot for the cache (saved on every success)
      const fullSnapshot = { equipment, jobs, checkouts, employees, reports, productionCompanies, invoices, companyName, equipmentRequests, adminRequests, adminPin, timezone, timeFormat, kpiConfig, punishments, kpiEvents, photoVerification, navOrder, lineGroupId, verificationConfig, invoicePresets };
      const onSuccess = () => {
        setSaveErr(false);
        pendingSaveRef.current = null;
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(fullSnapshot)); } catch {}
      };
      const onFail = () => {
        setSaveErr(true);
        // Phase 2: remember the failed payload so the retry effect can drain it
        pendingSaveRef.current = savePayload;
      };
      // Retry once after 3s before showing the error — absorbs transient network blips
      // and Cloudflare Worker cold starts without alarming the user.
      const tryPut = () => api.putData(savePayload).then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); });
      tryPut()
        .then(onSuccess)
        .catch(() => new Promise(r => setTimeout(r, 3000)).then(tryPut)
          .then(onSuccess)
          .catch(onFail));
    }, 1500);
  }, [equipment, jobs, checkouts, employees, reports, productionCompanies, invoices, companyName, equipmentRequests, adminRequests, adminPin, timezone, timeFormat, kpiConfig, punishments, kpiEvents, photoVerification, navOrder, lineGroupId, verificationConfig, invoicePresets, loaded, cloudSynced]);

  // Phase 2: when a save has failed, retry automatically when the browser comes back online
  // or every 30 seconds. This drains without user action and clears the ⚠ SYNC indicator.
  useEffect(() => {
    if (!saveErr) return;
    const retryPending = () => {
      const payload = pendingSaveRef.current;
      if (!payload || !navigator.onLine) return;
      api.putData(payload)
        .then(res => { if (!res.ok) throw new Error(); })
        .then(() => { setSaveErr(false); pendingSaveRef.current = null; })
        .catch(() => {}); // will retry on next event or interval
    };
    window.addEventListener("online", retryPending);
    const interval = setInterval(retryPending, 30000);
    return () => { window.removeEventListener("online", retryPending); clearInterval(interval); };
  }, [saveErr]);

  // Immediate, awaitable save for the admin "Save" button — returns {ok} or {ok:false,error}.
  const saveSettingsNow = async () => {
    if (!loaded || !cloudSynced) return { ok: false, error: "Still syncing with the cloud — wait a moment, then try again." };
    const payload = { equipment, jobs, checkouts, employees, reports, productionCompanies, invoices, companyName, equipmentRequests, adminRequests, adminPin, timezone, timeFormat, kpiConfig, punishments, kpiEvents, photoVerification, verificationConfig, invoicePresets };
    if (lineGroupId !== null) payload.lineGroupId = lineGroupId;
    try {
      const res = await api.putData(payload);
      if (!res.ok) { setSaveErr(true); return { ok: false, error: `Server error ${res.status} — changes not saved.` }; }
      setSaveErr(false);
      return { ok: true };
    } catch (e) {
      setSaveErr(true);
      return { ok: false, error: (e && e.message) ? e.message : "Network error — check your connection and try again." };
    }
  };

  // Explicit account initialization — called when admin clicks "Initialize Account"
  // on the needsInit screen. Writes the current (empty) state to KV, marks every
  // field as loaded, then enables normal auto-save.
  const initializeAccount = async () => {
    const kl = kvLoadedRef.current;
    const payload = {
      equipment, jobs, checkouts, employees, reports, productionCompanies, invoices,
      companyName, equipmentRequests, adminRequests, adminPin,
      timezone, timeFormat, kpiConfig, punishments, kpiEvents, photoVerification, verificationConfig, invoicePresets,
    };
    try {
      const res = await api.putData(payload);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      Object.keys(payload).forEach(k => kl.add(k));
      setNeedsInit(false);
      setCloudSynced(true);
    } catch {
      setSaveErr(true);
    }
  };

  // Daily auto-backup — runs silently in the background once per admin session
  // per 24-hour window. Writes to backup_auto (separate from the user's manual
  // backup_manual key, which is never touched automatically).
  const autoBackupDoneRef = useRef(false);
  useEffect(() => {
    if (!loaded || !cloudSynced || autoBackupDoneRef.current) return;
    if (user?.role !== "admin") return;
    if (kvLoadedRef.current.size === 0) return; // nothing to back up
    autoBackupDoneRef.current = true;
    const lastStr = (() => { try { return localStorage.getItem("psr_last_auto_backup"); } catch { return null; } })();
    const last = lastStr ? +lastStr : 0;
    if (Date.now() - last < 24 * 3600 * 1000) return;
    const snapshot = { equipment, jobs, checkouts, employees, reports, productionCompanies, invoices, companyName, equipmentRequests, adminRequests, adminPin, timezone, timeFormat, kpiConfig, punishments, kpiEvents, photoVerification, verificationConfig, invoicePresets, savedAt: Date.now() };
    api.putBackupAuto(snapshot).then(() => {
      try { localStorage.setItem("psr_last_auto_backup", String(Date.now())); } catch {}
    }).catch(() => {});
  }, [loaded, cloudSynced, user]); // eslint-disable-line

  // One-time optimization: shrink oversized equipment photos already stored in KV.
  // Runs once in an admin session after load and persists through the normal guarded
  // save. Only ever replaces a photo with a strictly smaller one (never grows data).
  const photosOptimizedRef = useRef(false);
  useEffect(() => {
    if (!loaded || !cloudSynced || photosOptimizedRef.current) return;
    if (user?.role !== "admin") return;
    const BIG = 300000; // ~225 KB+ of base64 → an uncompressed phone photo
    if (!equipment.some(e => e.photo && e.photo.length > BIG)) { photosOptimizedRef.current = true; return; }
    photosOptimizedRef.current = true;
    (async () => {
      const updated = [];
      for (const e of equipment) {
        if (e.photo && e.photo.length > BIG) {
          const c = await compressImage(e.photo, { maxDim: 1200, quality: 0.72 });
          updated.push(c && c.length < e.photo.length ? { ...e, photo: c } : e);
        } else updated.push(e);
      }
      setEquipment(updated);
    })();
  }, [loaded, cloudSynced, user, equipment]);

  const unresolvedCount = reports.filter(r => r.status === "open").length;
  const pendingAdminRequests = (adminRequests || []).filter(r => r.status === "pending");
  const pendingEquipReqCount = (equipmentRequests || []).filter(r => r.status === "pending").length;
  const _tRoot = (key) => (LANG[lang] || LANG.en)[key] ?? LANG.en[key] ?? key;
  const notifItems = [
    pendingAdminRequests.length > 0 && { label: _tRoot("notifAdminApprovals"), count: pendingAdminRequests.length, color: "#e8b84b", icon: icons.check, onClick: () => setActivePage("dashboard") },
    pendingEquipReqCount > 0 && { label: _tRoot("notifEquipRequests"), count: pendingEquipReqCount, color: "#60a5fa", icon: icons.gear, onClick: () => setActivePage("team") },
    unresolvedCount > 0 && { label: _tRoot("notifDamageReports"), count: unresolvedCount, color: "#f87171", icon: icons.alert, onClick: () => setActivePage("reports") },
  ].filter(Boolean);

  const approveAdminRequest = (req) => {
    if (req.type === "production-house") {
      setProductionCompanies(p => [...p, { id: "co" + Date.now(), name: req.name.trim(), address: req.address || "" }]);
    } else if (req.type === "equipment") {
      setEquipment(p => [...p, { id: "eq" + Date.now(), name: req.name.trim(), category: req.category || "", total: +req.total || 1, photo: req.photo || null, notes: req.notes || "" }]);
    } else if (req.type === "member-register") {
      setEmployees(p => [...p, { id: "e" + Date.now(), name: req.name.trim(), pin: req.requestedPin }]);
    } else if (req.type === "geo-return") {
      setCheckouts(p => [...p, { id: "co" + Date.now() + req.eqId, jobId: req.jobId, jobName: req.jobName, eqId: req.eqId, qty: req.qty, employeeId: req.employeeId, employeeName: req.employeeName, type: "return", ts: Date.now(), photo: req.photo || null, location: req.returnLocation || null, adminApproved: true }]);
    }
    setAdminRequests(p => p.map(r => r.id === req.id ? { ...r, status: "approved", resolvedAt: new Date().toISOString() } : r));
  };

  const rejectAdminRequest = (req) => {
    setAdminRequests(p => p.map(r => r.id === req.id ? { ...r, status: "rejected", resolvedAt: new Date().toISOString() } : r));
  };

  const createBackup = async () => {
    const payload = { savedAt: new Date().toISOString(), equipment, jobs, checkouts, employees, reports, productionCompanies, invoices, companyName, equipmentRequests, adminRequests, adminPin, lineGroupId, timezone, timeFormat, kpiConfig, punishments, kpiEvents, photoVerification, verificationConfig, invoicePresets };
    const res = await api.putBackup(payload);
    if (res?.ok) { try { localStorage.setItem("psr_last_backup", payload.savedAt); } catch {} }
    return res;
  };

  const restoreBackup = async () => {
    const d = await api.getBackup();
    if (!d) return null;
    if (d.equipment) setEquipment(d.equipment);
    if (d.jobs) setJobs(d.jobs);
    if (d.checkouts) setCheckouts(d.checkouts);
    if (d.employees) setEmployees(d.employees);
    if (d.reports) setReports(d.reports);
    if (d.productionCompanies) setProductionCompanies(d.productionCompanies);
    if (d.invoices) setInvoices(d.invoices);
    if (d.companyName != null) setCompanyName(d.companyName);
    if (d.equipmentRequests) setEquipmentRequests(d.equipmentRequests);
    if (d.adminRequests) setAdminRequests(d.adminRequests);
    if (d.adminPin) setAdminPin(d.adminPin);
    if (d.lineGroupId !== undefined) setLineGroupId(d.lineGroupId);
    if (d.timezone) setTimezone(d.timezone);
    if (d.timeFormat) setTimeFormat(d.timeFormat);
    if (d.kpiConfig) setKpiConfig(d.kpiConfig);
    if (d.punishments) setPunishments(d.punishments);
    if (d.kpiEvents) setKpiEvents(d.kpiEvents);
    if (d.photoVerification != null) setPhotoVerification(d.photoVerification);
    if (d.verificationConfig != null) setVerificationConfig(d.verificationConfig);
    else if (d.photoVerification != null) setVerificationConfig({ mode: d.photoVerification ? "photo" : "none" });
    return d.savedAt;
  };

  return (
    <LangCtx.Provider value={lang}>
      {!loaded ? (
        <div style={{ minHeight: "100vh", background: "#0f1117", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 32 }}>
          {/* Logo spins in following the circular-arrow direction of the mark */}
          <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ position: "absolute", width: 260, height: 260, borderRadius: "50%", background: "radial-gradient(circle, rgba(232,184,75,0.10) 0%, transparent 68%)", animation: "psrGlow 2.4s ease-in-out infinite alternate" }} />
            <img src="/logo.png" alt="Pick Shoot Return" style={{ width: "min(72vw, 320px)", height: "auto", position: "relative", zIndex: 1, animation: "psrSpinIn 0.85s cubic-bezier(0.34,1.56,0.64,1) forwards" }} />
          </div>
          {/* Thin progress bar */}
          <div style={{ width: "min(72vw, 300px)", display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ height: 2, background: "#141720", borderRadius: 2, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${loadProgress}%`, background: "linear-gradient(90deg, #a06820, #e8b84b)", borderRadius: 2, transition: "width 0.15s ease-out", boxShadow: "0 0 8px #e8b84b55" }} />
            </div>
            <p style={{ margin: 0, textAlign: "right", fontSize: 10, color: "#383c48", letterSpacing: "0.10em", fontFamily: "monospace" }}>{Math.round(loadProgress)}%</p>
          </div>
          <style>{`
            @keyframes psrSpinIn {
              0%   { transform: scale(0.45) rotate(-168deg); opacity: 0; filter: blur(8px); }
              65%  { transform: scale(1.07) rotate(7deg);   opacity: 1; filter: blur(0); }
              82%  { transform: scale(0.97) rotate(-2deg); }
              100% { transform: scale(1)    rotate(0deg);   opacity: 1; }
            }
            @keyframes psrGlow {
              from { opacity: 0.6; transform: scale(0.88); }
              to   { opacity: 1;   transform: scale(1.12); }
            }
          `}</style>
        </div>
      ) : loadError ? (
        <div style={{ minHeight: "100vh", background: "#0f1117", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16, padding: 32 }}>
          <div style={{ fontSize: 40 }}>⚠️</div>
          <p style={{ color: "#f87171", fontSize: 17, fontWeight: 700, textAlign: "center" }}>Could Not Connect to Cloud Storage</p>
          <p style={{ color: "#666", fontSize: 13, textAlign: "center", maxWidth: 320, lineHeight: 1.6 }}>
            The app tried 3 times and could not reach the server. Your data has <strong style={{ color: "#e8b84b" }}>not been changed</strong>. Check your internet connection and try again.
          </p>
          <button onClick={() => window.location.reload()} style={{ marginTop: 8, padding: "12px 28px", background: "#e8b84b", color: "#0e0e08", border: "none", borderRadius: 10, fontWeight: 700, fontSize: 15, cursor: "pointer" }}>Retry</button>
        </div>
      ) : needsInit && user?.role === "admin" ? (
        <div style={{ minHeight: "100vh", background: "#0f1117", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16, padding: 32 }}>
          <div style={{ fontSize: 40 }}>🗄️</div>
          <p style={{ color: "#f0f0dc", fontSize: 17, fontWeight: 700, textAlign: "center" }}>No Data Found in Cloud Storage</p>
          <p style={{ color: "#8a8a68", fontSize: 13, textAlign: "center", maxWidth: 340, lineHeight: 1.6 }}>
            All cloud storage fields came back empty. This is expected for a <strong style={{ color: "#e8b84b" }}>brand-new account</strong>.<br /><br />
            If you <strong style={{ color: "#f87171" }}>previously had data</strong>, this may be a temporary connection issue — try reloading before clicking Initialize.
          </p>
          <button onClick={() => window.location.reload()} style={{ padding: "10px 24px", background: "transparent", color: "#8a8a68", border: "1px solid #353520", borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>Reload First</button>
          <button onClick={initializeAccount} style={{ padding: "12px 28px", background: "#e8b84b", color: "#0e0e08", border: "none", borderRadius: 10, fontWeight: 700, fontSize: 15, cursor: "pointer" }}>Initialize Fresh Account</button>
          {saveErr && <p style={{ color: "#f87171", fontSize: 12 }}>Save failed — check your connection and try again.</p>}
        </div>
      ) : !user ? (
        <Login onLogin={setUser} employees={employees} companyName={companyName} adminPin={adminPin} adminRequests={adminRequests} setAdminRequests={setAdminRequests} />
      ) : user.role === "employee" ? (
        <EmployeeView employee={user} jobs={jobs} equipment={equipment} checkouts={checkouts} setCheckouts={setCheckouts} reports={reports} setReports={setReports} invoices={invoices} setInvoices={setInvoices} productionCompanies={productionCompanies} companyName={companyName} setLang={setLang} onLogout={() => setUser(null)} setEmployees={setEmployees} equipmentRequests={equipmentRequests} setEquipmentRequests={setEquipmentRequests} adminRequests={adminRequests} setAdminRequests={setAdminRequests} lineGroupId={lineGroupId} lineNotifyMuted={lineNotifyMuted} kpiConfig={kpiConfig} kpiEvents={kpiEvents} punishments={punishments} verificationConfig={verificationConfig} saveNow={saveSettingsNow} offlineMode={offlineMode} invoicePresets={invoicePresets} />
      ) : (
        <div id="admin-layout" style={S.app}>
          <AdminTopBar
            onLogout={() => setUser(null)}
            saveErr={saveErr}
            offlineMode={offlineMode}
            companyName={companyName}
            onOpenSettings={() => setSettingsPanelOpen(true)}
            notifItems={notifItems}
          />
          {offlineMode && (
            <div style={{ background: "rgba(232,184,75,0.12)", borderBottom: "1px solid rgba(232,184,75,0.25)", padding: "8px 16px", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13 }}>⚠️</span>
              <p style={{ margin: 0, fontSize: 12, color: "#e8b84b", lineHeight: 1.4 }}>
                <strong>Offline</strong> — showing cached data. Changes will not be saved until connection is restored. Reconnecting automatically…
              </p>
            </div>
          )}
          <main style={{ ...S.main, paddingBottom: 80 }}>
            {activePage === "dashboard" && <DashboardPage jobs={jobs} setJobs={setJobs} equipment={equipment} checkouts={checkouts} setCheckouts={setCheckouts} productionCompanies={productionCompanies} employees={employees} equipmentRequests={equipmentRequests} setEquipmentRequests={setEquipmentRequests} adminRequests={adminRequests} approveAdminRequest={approveAdminRequest} rejectAdminRequest={rejectAdminRequest} pendingAdminCount={pendingAdminRequests.length} lineGroupId={lineGroupId} lineNotifyMuted={lineNotifyMuted} />}
            {activePage === "equipment" && <EquipmentPage equipment={equipment} setEquipment={setEquipment} jobs={jobs} checkouts={checkouts} reports={reports} setReports={setReports} />}
            {activePage === "jobs" && <JobsPage jobs={jobs} setJobs={setJobs} equipment={equipment} checkouts={checkouts} productionCompanies={productionCompanies} employees={employees} lineGroupId={lineGroupId} lineNotifyMuted={lineNotifyMuted} verificationConfig={verificationConfig} />}
            {activePage === "invoice" && <InvoicePage productionCompanies={productionCompanies} setProductionCompanies={setProductionCompanies} invoices={invoices} setInvoices={setInvoices} employees={employees} companyName={companyName} user={user} invoicePresets={invoicePresets} jobs={jobs} adminRequests={adminRequests} />}
            {activePage === "team" && <TeamPage employees={employees} setEmployees={setEmployees} equipmentRequests={equipmentRequests} setEquipmentRequests={setEquipmentRequests} checkouts={checkouts} setCheckouts={setCheckouts} equipment={equipment} kpiConfig={kpiConfig} setKpiConfig={setKpiConfig} kpiEvents={kpiEvents} setKpiEvents={setKpiEvents} punishments={punishments} setPunishments={setPunishments} />}
            {activePage === "checkout" && <AdminCheckoutPage jobs={jobs} equipment={equipment} checkouts={checkouts} setCheckouts={setCheckouts} verificationConfig={verificationConfig} employees={employees} />}
          </main>
          <AdminBottomNav activePage={activePage} setActivePage={setActivePage} unresolvedCount={unresolvedCount} navOrder={navOrder} />
          {settingsPanelOpen && <SettingsPage companyName={companyName} setCompanyName={setCompanyName} adminPin={adminPin} setAdminPin={setAdminPin} lineGroupId={lineGroupId} setLineGroupId={setLineGroupId} lineNotifyMuted={lineNotifyMuted} setLineNotifyMuted={setLineNotifyMuted} createBackup={createBackup} restoreBackup={restoreBackup} timezone={timezone} setTimezone={setTimezone} timeFormat={timeFormat} setTimeFormat={setTimeFormat} saveSettingsNow={saveSettingsNow} verificationConfig={verificationConfig} setVerificationConfig={setVerificationConfig} themeStyle={themeStyle} setThemeStyle={setThemeStyle} themePalette={themePalette} setThemePalette={setThemePalette} lang={lang} setLang={setLang} navOrder={navOrder} setNavOrder={setNavOrder} checkoutsCount={checkouts.length} setCheckouts={setCheckouts} invoicePresets={invoicePresets} setInvoicePresets={setInvoicePresets} onClose={() => setSettingsPanelOpen(false)} />}
        </div>
      )}
    </LangCtx.Provider>
  );
}
