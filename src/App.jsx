import { useState, useEffect, useRef, useCallback, createContext, useContext } from "react";

// ─── CONSTANTS ───────────────────────────────────────────────────────────────
const INITIAL_EMPLOYEES = [
  { id: "e1", name: "Somchai", pin: "1111" },
  { id: "e2", name: "Nong", pin: "2222" },
  { id: "e3", name: "Arthit", pin: "3333" },
];

const JOB_STATUSES = ["Pencil", "Confirmed", "Cancelled"];
const SHOOT_TIMES = ["Day", "Night", "Half Day / Half Night", "Half Night / Half Day"];
const LOCATIONS = ["Local (Bangkok)", "Out of Town", "Overseas"];

const SAMPLE_EQUIPMENT = [
  { id: "eq1", name: "ARRI Alexa Mini LF", category: "Camera", total: 1, photo: null, notes: "Main camera body" },
  { id: "eq2", name: "Steadicam Rig", category: "Stabilizer", total: 1, photo: null, notes: "Full rig with vest & arm" },
  { id: "eq3", name: "Gold Mount Battery", category: "Power", total: 8, photo: null, notes: "Anton Bauer" },
  { id: "eq4", name: "V-Mount Battery", category: "Power", total: 4, photo: null, notes: "IDX" },
  { id: "eq5", name: "Cooke S4/i Prime Set", category: "Lens", total: 1, photo: null, notes: "5 lenses: 18, 25, 32, 50, 75mm" },
  { id: "eq6", name: "Follow Focus", category: "Accessories", total: 2, photo: null, notes: "Preston MDR4" },
  { id: "eq7", name: "Monitor - SmallHD 703", category: "Monitor", total: 2, photo: null, notes: "" },
  { id: "eq8", name: "Matte Box", category: "Accessories", total: 1, photo: null, notes: "MB-T06" },
];

// ─── CLOUD API ───────────────────────────────────────────────────────────────
const api = {
  getData: () => fetch("/api/data").then(r => r.ok ? r.json() : {}),
  putData: (body) => fetch("/api/data", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  getProfile: (empId) => fetch(`/api/profile/${empId}`).then(r => r.ok ? r.json() : null),
  putProfile: (empId, profileObj) => fetch(`/api/profile/${empId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(profileObj) }),
  notify: (body) => fetch("/api/notify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => {}),
};

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
};

// ─── UTILITY: Date helpers ───────────────────────────────────────────────────
const today = () => new Date().toISOString().split("T")[0];
const formatDate = (d) => new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const formatDateTime = (ts) => new Date(ts).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

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
function GeoPhoto({ onCapture, label }) {
  const videoRef = useRef(null);
  const [streaming, setStreaming] = useState(false);
  const [location, setLocation] = useState(null);
  const [locErr, setLocErr] = useState(null);
  const [photo, setPhoto] = useState(null);
  const [loading, setLoading] = useState(false);

  const startCamera = async () => {
    setLoading(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      videoRef.current.srcObject = stream;
      videoRef.current.play();
      setStreaming(true);
      navigator.geolocation.getCurrentPosition(
        (pos) => setLocation({ lat: pos.coords.latitude.toFixed(5), lng: pos.coords.longitude.toFixed(5), acc: Math.round(pos.coords.accuracy) }),
        () => setLocErr("Location unavailable — photo still captured with timestamp.")
      );
    } catch { setLocErr("Camera access denied. Please allow camera permissions."); }
    setLoading(false);
  };

  const capture = () => {
    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(videoRef.current, 0, 0);
    // Stamp overlay
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, canvas.height - 60, canvas.width, 60);
    ctx.fillStyle = "#e8b84b";
    ctx.font = "bold 14px Inter, sans-serif";
    ctx.fillText(new Date().toLocaleString(), 10, canvas.height - 38);
    if (location) ctx.fillText(`GPS: ${location.lat}, ${location.lng} (±${location.acc}m)`, 10, canvas.height - 16);
    else ctx.fillText(locErr || "No GPS", 10, canvas.height - 16);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    setPhoto(dataUrl);
    // stop stream
    videoRef.current.srcObject?.getTracks().forEach(t => t.stop());
    setStreaming(false);
    onCapture(dataUrl, location);
  };

  return (
    <div style={{ ...S.card, background: "#0f1117" }}>
      <p style={S.label}>{label || "Capture Verification Photo"}</p>
      {!streaming && !photo && (
        <button style={S.btn("primary")} onClick={startCamera} disabled={loading}>
          <Icon d={icons.camera} size={16} />{loading ? "Starting…" : "Open Camera"}
        </button>
      )}
      {locErr && <p style={{ fontSize: 12, color: "#f87171", marginTop: 8 }}>{locErr}</p>}
      {/* Wrapper blocks iOS native video tap-to-fullscreen / Live Broadcast overlay */}
      <div style={{ position: "relative", marginTop: streaming ? 12 : 0, display: streaming ? "block" : "none" }}>
        <video ref={videoRef} playsInline muted style={{ width: "100%", borderRadius: 8, display: "block" }} />
        <div style={{ position: "absolute", inset: 0, borderRadius: 8 }} />
      </div>
      {streaming && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          {location
            ? <span style={S.badge("green")}><Icon d={icons.map} size={12} /> GPS: {location.lat}, {location.lng}</span>
            : <span style={{ fontSize: 11, color: "#666" }}>Acquiring GPS…</span>
          }
          <button style={{ ...S.btn("primary"), justifyContent: "center", padding: "14px", fontSize: 16 }} onClick={capture}>
            📸 Capture Photo
          </button>
        </div>
      )}
      {photo && (
        <div style={{ marginTop: 12 }}>
          <img src={photo} alt="captured" style={{ width: "100%", borderRadius: 8 }} />
          <p style={{ fontSize: 11, color: "#34d399", marginTop: 8 }}>✓ Photo captured with timestamp{location ? " & GPS" : ""}</p>
        </div>
      )}
    </div>
  );
}

// ─── LANG / TRANSLATIONS ─────────────────────────────────────────────────────
const LANG = {
  en: {
    // Nav
    navDashboard: "Dashboard", navEquipment: "Equipment", navJobs: "Job Bookings",
    navTeam: "Team", navReports: "Reports", navInvoice: "Invoice",
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
    readyPick: "Ready to Pick Up",
    itemsAssigned: "items assigned",
    // Schedule tab
    jobSchedule: "Job Schedule",
    tapJobBar: "Tap any job bar to see details",
    // Profile tab
    myProfile: "My Profile",
    crewCard: "Your crew card",
    cameraCrew: "Camera Crew",
    uploadPhoto: "Upload Photo",
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
    // Job form (admin)
    newJob: "New Job", editJob: "Edit Job",
    jobNameField: "Job Name", productionCoField: "Production Company",
    jobStatusField: "Job Status", shootTimeField: "Shoot Time", locationField: "Location Type",
    contactPersonField: "Contact Person", contactPlatformField: "Contact Platform",
    datesField: "Production Dates (tap to select/deselect)", viewNextMonth: "View next month →", saveJob: "Save Job",
    // Common
    cancel: "Cancel", save: "Save", logout: "Log Out", back: "Back", loading: "Loading…",
    qty: "Qty",
  },
  th: {
    // Nav
    navDashboard: "ภาพรวม", navEquipment: "อุปกรณ์", navJobs: "งาน",
    navTeam: "ทีม", navReports: "แจ้งปัญหา", navInvoice: "ใบแจ้งหนี้",
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
    readyPick: "พร้อมรับอุปกรณ์",
    itemsAssigned: "รายการ",
    // Schedule tab
    jobSchedule: "ตารางงาน",
    tapJobBar: "แตะแถบงานเพื่อดูรายละเอียด",
    // Profile tab
    myProfile: "โปรไฟล์ของฉัน",
    crewCard: "บัตรทีมงาน",
    cameraCrew: "ทีมกล้อง",
    uploadPhoto: "อัปโหลดรูป",
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
    // Job form (admin)
    newJob: "งานใหม่", editJob: "แก้ไขงาน",
    jobNameField: "ชื่องาน", productionCoField: "บริษัทผลิต",
    jobStatusField: "สถานะ", shootTimeField: "ช่วงเวลาถ่าย", locationField: "ประเภทสถานที่",
    contactPersonField: "ผู้ติดต่อ", contactPlatformField: "ช่องทางติดต่อ",
    datesField: "วันถ่าย (แตะเพื่อเลือก)", viewNextMonth: "เดือนถัดไป →", saveJob: "บันทึก",
    // Common
    cancel: "ยกเลิก", save: "บันทึก", logout: "ออกจากระบบ", back: "กลับ", loading: "กำลังโหลด…",
    qty: "จำนวน",
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
const EQ_SORT_OPTIONS = [
  { key: "name_az", label: "Name A→Z" },
  { key: "name_za", label: "Name Z→A" },
  { key: "cat",     label: "Category" },
  { key: "qty_lo",  label: "Qty ↑" },
  { key: "qty_hi",  label: "Qty ↓" },
  { key: "latest",  label: "Latest Used" },
  { key: "most",    label: "Most Used" },
];

function EquipmentPage({ equipment, setEquipment, jobs, checkouts }) {
  const [modal, setModal] = useState(null);
  const [editTarget, setEditTarget] = useState(null);
  const [form, setForm] = useState({ name: "", category: "", total: 1, notes: "", photo: null });
  const [newCatInput, setNewCatInput] = useState("");
  const [histTarget, setHistTarget] = useState(null);
  const [sortBy, setSortBy] = useState("name_az");
  const [filterCat, setFilterCat] = useState(null);
  const fileRef = useRef(null);

  const availableList = calcAvailable(equipment, jobs, checkouts, today());
  const existingCategories = [...new Set(equipment.map(e => e.category).filter(Boolean))].sort();

  const openAdd = () => { setForm({ name: "", category: "", total: 1, notes: "", photo: null }); setNewCatInput(""); setModal("add"); };
  const openEdit = (eq) => { setEditTarget(eq); setForm({ ...eq }); setNewCatInput(""); setModal("edit"); };
  const openHistory = (eq) => { setHistTarget(eq); setModal("history"); };

  const handlePhoto = (e) => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader(); r.onload = (ev) => setForm(p => ({ ...p, photo: ev.target.result })); r.readAsDataURL(f);
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

  const del = (id) => { if (window.confirm("Delete this equipment?")) setEquipment(p => p.filter(e => e.id !== id)); };

  const getHistory = (eqId) => checkouts.filter(c => c.eqId === eqId).sort((a, b) => b.ts - a.ts).slice(0, 20);

  const AvStatus = ({ av }) => {
    if (av.available === 0) return <span style={{ ...S.badge("red"), fontSize: 10 }}>Unavail.</span>;
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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <h1 style={S.pageTitle}>Equipment Library</h1>
          <p style={S.pageSubtitle}>{equipment.length} items · {availableList.filter(e => e.available > 0).length} available today</p>
        </div>
        <button style={S.btn("primary")} onClick={openAdd}><Icon d={icons.plus} size={15} /> Add</button>
      </div>

      {/* Category filter chips */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        <button onClick={() => setFilterCat(null)} style={{ ...S.badge(filterCat === null ? "amber" : "gray"), cursor: "pointer", border: "none", padding: "4px 10px" }}>All</button>
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
        <Modal title={modal === "add" ? "Add Equipment" : "Edit Equipment"} onClose={() => setModal(null)}>
          <div style={S.col}>
            <div><label style={S.label}>Item Name</label><input style={S.input} value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. ARRI Alexa Mini LF" /></div>
            <div>
              <label style={S.label}>Category</label>
              {form.category === "__new__" ? (
                <div style={{ display: "flex", gap: 8 }}>
                  <input style={{ ...S.input, flex: 1 }} value={newCatInput} onChange={e => setNewCatInput(e.target.value)} placeholder="New category name…" autoFocus />
                  <button style={{ ...S.btn("ghost"), padding: "8px 10px", flexShrink: 0 }} onClick={() => setForm(p => ({ ...p, category: "" }))}>✕</button>
                </div>
              ) : (
                <select style={S.select} value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}>
                  <option value="">— Select category —</option>
                  {existingCategories.map(c => <option key={c} value={c}>{c}</option>)}
                  <option value="__new__">＋ Add new category…</option>
                </select>
              )}
            </div>
            <div><label style={S.label}>Total Units Owned</label><input style={S.input} type="number" min={1} value={form.total} onChange={e => setForm(p => ({ ...p, total: e.target.value }))} /></div>
            <div><label style={S.label}>Notes</label><input style={S.input} value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} placeholder="Optional notes" /></div>
            <div>
              <label style={S.label}>Photo</label>
              <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handlePhoto} />
              <button style={S.btn("ghost")} onClick={() => fileRef.current.click()}><Icon d={icons.photo} size={14} /> {form.photo ? "Change Photo" : "Upload Photo"}</button>
              {form.photo && <img src={form.photo} alt="preview" style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 6, marginTop: 8 }} />}
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
              <button style={S.btn("ghost")} onClick={() => setModal(null)}>Cancel</button>
              <button style={S.btn("primary")} onClick={save}>Save Equipment</button>
            </div>
          </div>
        </Modal>
      )}

      {/* History Modal */}
      {modal === "history" && histTarget && (
        <Modal title={`History — ${histTarget.name}`} onClose={() => setModal(null)} wide>
          {getHistory(histTarget.id).length === 0 ? (
            <p style={{ color: "#666", fontSize: 13 }}>No checkout history yet.</p>
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

function calcTotal(inv) {
  if (inv.items?.length) {
    return inv.items.reduce((s, it) => s + (parseFloat(it.qty) || 0) * (parseFloat(it.rate) || 0), 0);
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

function printInvoice({ invoice, employee, profileInfo, promptPayQR, idCard, signature, productionCompanies, companyName, print: doPrint = true }) {
  const prodCo = productionCompanies.find(c => c.name === invoice.productionCompany);
  const total = calcTotal(invoice);

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

  const itemRows = items.map(it => {
    const qty = parseFloat(it.qty) || 0;
    const rate = parseFloat((it.rate || "").toString().replace(/,/g, "")) || 0;
    const lineTotal = qty * rate;
    return `<tr>
      <td>${it.description}</td>
      <td class="num">${qty % 1 === 0 ? qty : qty.toFixed(2)}</td>
      <td class="num">฿${rate.toLocaleString()}</td>
      <td class="num"><strong>฿${lineTotal.toLocaleString()}</strong></td>
    </tr>`;
  }).join("");

  const html = `<!DOCTYPE html><html><head><title>${invoice.invoiceNo}</title><meta charset="utf-8"><style>
    @page{size:A4;margin:0}
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Helvetica Neue',Arial,sans-serif;color:#111;font-size:11.5px;background:#fff;padding:15mm}
    .hdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px}
    .divider{border-top:2px solid #111;margin-bottom:14px}
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:12px}
    .job-box{background:#f7f7f7;border-radius:5px;padding:10px 14px;margin-bottom:12px;border-left:3px solid #111}
    .lbl{font-size:8.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#888;margin-bottom:4px}
    table{width:100%;border-collapse:collapse;margin-bottom:8px}
    th{text-align:left;font-size:8.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#888;padding:5px 8px;border-bottom:1.5px solid #ccc;background:#fafafa}
    td{padding:6px 8px;border-bottom:1px solid #f0f0f0;font-size:11.5px}
    .num{text-align:right;width:80px}
    .total-row td{border-top:2px solid #111;border-bottom:none;font-weight:800;font-size:13px;padding-top:8px}
    .bottom-box{border:1.5px solid #ddd;border-radius:7px;padding:16px 20px;margin-top:12px;display:flex;gap:28px;align-items:center;justify-content:center}
    .id-wrap{width:160px;flex-shrink:0}
    .id-img{width:100%;border-radius:5px;display:block;border:1px solid #ddd}
    .sig-col{flex-shrink:0;display:flex;flex-direction:column;align-items:center}
    .sig-img{width:160px;opacity:.95}
    @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  </style></head><body>
  <div class="hdr">
    <div>
      <div style="font-size:20px;font-weight:800;letter-spacing:.01em">${companyName || "GEAR DESK"}</div>
    </div>
    <div style="text-align:right">
      <div style="font-size:26px;font-weight:900;letter-spacing:.04em">INVOICE</div>
      <div style="font-size:11px;color:#555;margin-top:3px">#${fmtInvoiceNo(invoice)}</div>
      <div style="font-size:10px;color:#888;margin-top:2px">${invDate}</div>
      ${invoice.status === "Paid" ? `<div style="margin-top:6px;display:inline-block;padding:2px 10px;border-radius:20px;font-size:9.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;background:${statusBg};color:${statusColor}">PAID</div>` : ""}
    </div>
  </div>
  <div class="divider"></div>
  <div class="grid2">
    <div>
      <div class="lbl">Bill To</div>
      <div style="font-weight:700;font-size:13px">${invoice.productionCompany || "—"}</div>
      ${prodCo?.address ? `<div style="font-size:10.5px;color:#555;white-space:pre-wrap;margin-top:3px;line-height:1.5">${prodCo.address}</div>` : ""}
    </div>
    <div>
      <div class="lbl">From</div>
      <div style="font-weight:700;font-size:13px">${profileInfo?.firstName ? `${profileInfo.firstName} ${profileInfo.lastName || ""}`.trim() : employee.name}</div>
      ${profileInfo?.legalAddress ? `<div style="font-size:10.5px;color:#555;white-space:pre-wrap;margin-top:3px;line-height:1.5">${profileInfo.legalAddress}</div>` : ""}
      ${profileInfo?.phone ? `<div style="font-size:10.5px;color:#555;margin-top:3px">Phone No.: ${profileInfo.phone}</div>` : ""}
      ${profileInfo?.email ? `<div style="font-size:10.5px;color:#555;margin-top:2px">Email: ${profileInfo.email}</div>` : ""}
    </div>
  </div>
  <div class="job-box">
    <div style="font-weight:700;font-size:13px;margin-bottom:3px">${invoice.jobName}</div>
    <div style="font-size:11px;color:#555">Position: <strong>${invoice.position || "—"}</strong>${dateStr ? ` &nbsp;|&nbsp; Dates: ${dateStr}` : ""}</div>
  </div>
  ${invoice.callWrap && Object.keys(invoice.callWrap).some(d => invoice.callWrap[d]?.call || invoice.callWrap[d]?.wrap) ? `
  <table style="margin-bottom:10px;width:auto;min-width:260px">
    <thead><tr><th>Date</th><th>Call Time</th><th>Wrap Time</th></tr></thead>
    <tbody>${Object.keys(invoice.callWrap).sort().map(d => {
      const cw = invoice.callWrap[d];
      if (!cw?.call && !cw?.wrap) return "";
      const label = new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
      const fmtTime = t => t ? t.slice(0, 5) : "—";
      return `<tr><td>${label}</td><td>${fmtTime(cw.call)}</td><td>${fmtTime(cw.wrap)}</td></tr>`;
    }).join("")}</tbody>
  </table>` : ""}
  <table>
    <thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Total</th></tr></thead>
    <tbody>${itemRows}</tbody>
    <tfoot><tr class="total-row"><td colspan="3">TOTAL AMOUNT</td><td class="num">฿${total.toLocaleString()}</td></tr></tfoot>
  </table>
  ${(promptPayQR || idCard || signature) ? `
  <div class="bottom-box">
    ${promptPayQR ? `<div style="text-align:center;flex-shrink:0">
      <div class="lbl" style="margin-bottom:6px">PromptPay / QR Payment</div>
      <img src="${promptPayQR}" style="width:208px;height:208px;object-fit:contain;border:1px solid #ddd;border-radius:6px;background:#fff"/>
      ${(profileInfo?.bankName || profileInfo?.bankAccount || profileInfo?.accountName) ? `<div style="margin-top:8px;font-size:10px;color:#444;line-height:1.7;text-align:center">
        ${profileInfo.bankName ? `<div style="font-weight:700">${profileInfo.bankName}</div>` : ""}
        ${profileInfo.accountName ? `<div>${profileInfo.accountName}</div>` : ""}
        ${profileInfo.bankAccount ? `<div>${profileInfo.bankAccount}</div>` : ""}
      </div>` : ""}
    </div>` : ""}
    ${idCard ? `<div class="id-wrap">
      <div class="lbl" style="margin-bottom:6px">ID Card</div>
      <img class="id-img" src="${idCard}" />
    </div>` : ""}
    ${signature ? `<div class="sig-col">
      <div style="font-size:8.5px;color:#888;text-align:center;line-height:1.6;margin-bottom:8px;max-width:180px">
        ข้อมูลและสำเนาถูกต้อง<br>ใช้สำหรับงาน <strong>${invoice.jobName || "—"}</strong><br>ของ <strong>${invoice.productionCompany || "—"}</strong>
      </div>
      <img class="sig-img" src="${signature}" />
    </div>` : ""}
  </div>` : ""}
  ${doPrint ? `<script>window.onload=()=>{window.print();window.onafterprint=()=>window.close();}<\/script>` : ""}
  </body></html>`;

  const win = window.open("", "_blank", "width=820,height=1180");
  if (win) { win.document.write(html); win.document.close(); }
}

const DEFAULT_ITEMS = [
  { id: "d1", description: "Labor (12hr)", qty: 1, rate: "" },
  { id: "d2", description: "Overtime", qty: 1, rate: "" },
  { id: "d3", description: "Travel Day Fee", qty: 1, rate: "" },
];

function migrateItems(inv) {
  if (inv?.items) return inv.items;
  const items = [];
  const add = (desc, val) => { if (parseFloat(val) > 0) items.push({ id: "m" + desc, description: desc, qty: 1, rate: val }); };
  add("Labor (12hr)", inv?.laborFee); add("Overtime", inv?.overtime);
  add("Travel Day Fee", inv?.travelFee); add("Per Diem", inv?.perDiem);
  return items.length ? items : JSON.parse(JSON.stringify(DEFAULT_ITEMS));
}

function InvoiceCreateModal({ job, existingInvoice, employee, onSave, onClose, allInvoices }) {
  const [jobName, setJobName] = useState(existingInvoice?.jobName || job?.name || "");
  const [productionCompany, setProductionCompany] = useState(existingInvoice?.productionCompany || job?.production || "");
  const [shootDates] = useState(existingInvoice?.shootDates || job?.dates || []);
  const [position, setPosition] = useState(existingInvoice?.position || "");
  const [status, setStatus] = useState(existingInvoice?.status || "Pending");
  const [items, setItems] = useState(() => migrateItems(existingInvoice));
  const [callWrap, setCallWrap] = useState(() => {
    if (existingInvoice?.callWrap) return existingInvoice.callWrap;
    const obj = {};
    (existingInvoice?.shootDates || job?.dates || []).forEach(d => { obj[d] = { call: "", wrap: "" }; });
    return obj;
  });

  const updateItem = (id, field, val) => setItems(p => p.map(it => it.id === id ? { ...it, [field]: val } : it));
  const addItem = () => setItems(p => [...p, { id: "i" + Date.now(), description: "", qty: 1, rate: "" }]);
  const removeItem = (id) => setItems(p => p.filter(it => it.id !== id));

  const total = items.reduce((s, it) => s + (parseFloat(it.qty) || 0) * (parseFloat((it.rate || "").toString().replace(/,/g, "")) || 0), 0);

  const save = () => {
    const now = Date.now();
    let invNo, revisions;
    if (existingInvoice) {
      invNo = existingInvoice.invoiceNo;
      revisions = (existingInvoice.revisions || 0) + 1;
    } else {
      const yr = new Date().getFullYear().toString().slice(-2);
      const prefix = `INV-${yr}-`;
      const yearInvs = (allInvoices || []).filter(inv => inv.invoiceNo?.startsWith(prefix));
      let maxSeq = 0;
      yearInvs.forEach(inv => { const m = inv.invoiceNo.match(/INV-\d{2}-(\d+)/); if (m) maxSeq = Math.max(maxSeq, parseInt(m[1])); });
      invNo = `${prefix}${String(maxSeq + 1).padStart(4, "0")}`;
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
      jobName, productionCompany, shootDates, position, status, items, callWrap,
    });
  };

  const dateStr = shootDates.map(d => new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })).join(", ");

  return (
    <Modal title={existingInvoice ? "Edit Invoice" : "Create Invoice"} onClose={onClose} wide>
      <div style={S.col}>
        <div style={{ ...S.card, background: "rgba(232,184,75,0.04)", border: "1px solid rgba(232,184,75,0.15)" }}>
          <p style={S.sectionTitle}>Job Info</p>
          <div style={S.col}>
            <div><label style={S.label}>Job Name</label><input style={S.input} value={jobName} onChange={e => setJobName(e.target.value)} /></div>
            <div><label style={S.label}>Production Company</label><input style={S.input} value={productionCompany} onChange={e => setProductionCompany(e.target.value)} /></div>
            {dateStr && <p style={{ fontSize: 12, color: "var(--text-muted,#666)", margin: 0 }}>Dates: {dateStr}</p>}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={S.label}>Position</label>
            <select style={S.select} value={position} onChange={e => setPosition(e.target.value)}>
              <option value="">Select position…</option>
              {POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
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

        {/* Line items */}
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <p style={{ ...S.sectionTitle, margin: 0 }}>Line Items</p>
            <button style={{ ...S.btn("ghost"), padding: "4px 10px", fontSize: 12 }} onClick={addItem}><Icon d={icons.plus} size={12} /> Add Item</button>
          </div>

          {/* Header */}
          <div style={{ display: "grid", gridTemplateColumns: "90px 1fr 60px 80px 32px", gap: 6, marginBottom: 4 }}>
            {["Description", "Qty", "Rate (฿)", "Total", ""].map((h, i) => (
              <div key={i} style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text-muted,#666)", textAlign: i >= 2 ? "right" : "left" }}>{h}</div>
            ))}
          </div>

          <div style={S.col}>
            {items.map(it => {
              const lineTotal = (parseFloat(it.qty) || 0) * (parseFloat((it.rate || "").toString().replace(/,/g, "")) || 0);
              return (
                <div key={it.id} style={{ display: "grid", gridTemplateColumns: "90px 1fr 60px 80px 32px", gap: 6, alignItems: "center" }}>
                  <input style={{ ...S.input, fontSize: 12, padding: "7px 10px" }} value={it.description} onChange={e => updateItem(it.id, "description", e.target.value)} placeholder="Labor…" />
                  <input style={{ ...S.input, fontSize: 12, padding: "7px 6px", textAlign: "right" }} type="number" min="0" step="0.5" value={it.qty} onChange={e => updateItem(it.id, "qty", e.target.value)} />
                  <input style={{ ...S.input, fontSize: 12, padding: "7px 8px", textAlign: "right" }} type="number" min="0" value={it.rate} onChange={e => updateItem(it.id, "rate", e.target.value)} placeholder="0" />
                  <div style={{ fontSize: 13, fontWeight: 700, textAlign: "right", color: lineTotal > 0 ? "var(--accent,#e8b84b)" : "var(--text-muted,#666)" }}>
                    {lineTotal > 0 ? `฿${lineTotal.toLocaleString()}` : "—"}
                  </div>
                  <button style={{ ...S.btn("danger"), padding: "5px 6px", minWidth: 0 }} onClick={() => removeItem(it.id)}><Icon d={icons.x} size={12} /></button>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12, paddingTop: 12, borderTop: "1px solid var(--divider-color,#252830)" }}>
          <span style={{ fontSize: 12, color: "var(--text-muted,#666)" }}>Total</span>
          <span style={{ fontSize: 20, fontWeight: 800, color: "var(--accent,#e8b84b)" }}>฿{total.toLocaleString()}</span>
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button style={S.btn("ghost")} onClick={onClose}>Cancel</button>
          <button style={S.btn("primary")} onClick={save}>Save Invoice</button>
        </div>
      </div>
    </Modal>
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

function JobsPage({ jobs, setJobs, equipment, checkouts, productionCompanies, employees, lineGroupId, lineNotifyMuted }) {
  const [modal, setModal] = useState(null);
  const [editTarget, setEditTarget] = useState(null);
  const [assignTarget, setAssignTarget] = useState(null);
  const [selectedJob, setSelectedJob] = useState(null);
  const [assignForm, setAssignForm] = useState({});

  const openAdd = () => { setEditTarget(null); setModal("form"); };
  const openEdit = (job) => { setEditTarget(job); setModal("form"); };
  const del = (id) => { if (window.confirm("Delete this job?")) setJobs(p => p.filter(j => j.id !== id)); };

  const openAssign = (job) => {
    const init = {};
    (job.assignedEquipment || []).forEach(ae => { init[ae.eqId] = ae.qty; });
    setAssignForm(init);
    setAssignTarget(job);
    setModal("assign");
  };

  const saveAssign = () => {
    const assigned = Object.entries(assignForm).filter(([, qty]) => qty > 0).map(([eqId, qty]) => ({ eqId, qty: +qty }));
    setJobs(p => p.map(j => j.id === assignTarget.id ? { ...j, assignedEquipment: assigned } : j));
    setModal(null);
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
          <h1 style={S.pageTitle}>Job Bookings</h1>
          <p style={S.pageSubtitle}>{jobs.filter(j => j.status === "Confirmed").length} confirmed · {jobs.filter(j => j.status === "Pencil").length} pencil</p>
        </div>
        <button style={S.btn("primary")} onClick={openAdd}><Icon d={icons.plus} size={15} /> New Job</button>
      </div>

      {/* Job list */}
      <div style={S.col}>
        {jobs.length === 0 && <p style={{ color: "#666", fontSize: 13 }}>No jobs yet. Add your first job above.</p>}
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
                  </div>
                  <h3 style={{ margin: "0 0 2px", fontSize: 16, fontWeight: 700 }}>{job.name}</h3>
                  <p style={{ margin: 0, fontSize: 12, color: "#666" }}>{job.production}</p>
                  <p style={{ margin: "6px 0 0", fontSize: 12, color: "#8a8f9d" }}>
                    {job.dates.length} day{job.dates.length !== 1 ? "s" : ""} · {job.dates[0] ? formatDate(job.dates[0]) : "No date"}{job.dates.length > 1 ? ` → ${formatDate(job.dates[job.dates.length - 1])}` : ""}
                  </p>
                  {outCount > 0 && <p style={{ margin: "4px 0 0", fontSize: 11, color: "#60a5fa" }}>{outCount} assigned · {picked} picked · {returned} returned</p>}
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                  {job.status === "Confirmed" && <button style={{ ...S.btn("success"), padding: "6px 10px", fontSize: 12 }} onClick={() => openAssign(job)}><Icon d={icons.gear} size={13} /> Assign Gear</button>}
                  <button style={{ ...S.btn("ghost"), padding: "6px 8px" }} onClick={() => openEdit(job)}><Icon d={icons.edit} size={14} /></button>
                  <button style={{ ...S.btn("danger"), padding: "6px 8px" }} onClick={() => del(job.id)}><Icon d={icons.trash} size={14} /></button>
                </div>
              </div>

              {selectedJob?.id === job.id && (
                <div style={{ marginTop: 16 }}>
                  <div style={S.divider} />
                  <p style={S.sectionTitle}>Production Dates</p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {job.dates.map(d => (
                      <span key={d} style={{ ...S.badge(d === today() ? "amber" : d < today() ? "gray" : "blue") }}>{formatDate(d)}{d === today() ? " ★ Today" : ""}</span>
                    ))}
                  </div>
                  {(job.assignedEquipment || []).length > 0 && (
                    <>
                      <div style={S.divider} />
                      <p style={S.sectionTitle}>Assigned Equipment</p>
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
        <Modal title={`Assign Gear — ${assignTarget.name}`} onClose={() => setModal(null)} wide>
          <p style={{ fontSize: 12, color: "#8a8f9d", marginBottom: 16 }}>Tap a card to assign or unassign. Use +/− for multi-unit items.</p>
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
                      {isMulti ? ` · ${maxAvail} of ${eq.total} free` : maxAvail === 0 ? " · Unavailable" : " · Available"}
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

          {/* Summary */}
          {Object.values(assignForm).some(q => q > 0) && (
            <div style={{ marginTop: 14, padding: "10px 14px", background: "rgba(232,184,75,0.06)", border: "1px solid rgba(232,184,75,0.15)", borderRadius: 8 }}>
              <p style={{ margin: 0, fontSize: 11, color: "#e8b84b", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>Assigned</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {Object.entries(assignForm).filter(([, q]) => q > 0).map(([eqId, qty]) => {
                  const eq = equipment.find(e => e.id === eqId);
                  return eq ? <span key={eqId} style={S.tag}>{eq.name}{eq.total > 1 ? ` ×${qty}` : ""}</span> : null;
                })}
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
            <button style={S.btn("ghost")} onClick={() => setModal(null)}>Cancel</button>
            <button style={S.btn("primary")} onClick={saveAssign}>Save Assignment</button>
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
function DashboardPage({ jobs, setJobs, equipment, checkouts, setCheckouts, productionCompanies, employees, equipmentRequests, setEquipmentRequests, lineGroupId, lineNotifyMuted }) {
  const todayStr = today();
  const todayJobs = jobs.filter(j => j.dates.includes(todayStr));
  const confirmedJobs = jobs.filter(j => j.status === "Confirmed");
  const pencilJobs = jobs.filter(j => j.status === "Pencil");
  const avList = calcAvailable(equipment, jobs, checkouts, todayStr);
  const pendingRequests = (equipmentRequests || []).filter(r => r.status === "pending");
  const [expandedStat, setExpandedStat] = useState(null);
  const [dashJobModal, setDashJobModal] = useState(null);
  const [dashReqModal, setDashReqModal] = useState(null);
  const [expandedActivityKeys, setExpandedActivityKeys] = useState(new Set());
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
    today:     { jobs: todayJobs,     label: "Today's Jobs",    color: "#e8b84b", badge: "amber" },
    confirmed: { jobs: confirmedJobs, label: "Confirmed Jobs",  color: "#34d399", badge: "green" },
    pencil:    { jobs: pencilJobs,    label: "Pencil Jobs",     color: "#94a3b8", badge: "gray"  },
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h1 style={{ ...S.pageTitle, marginBottom: 2 }}>Overview</h1>
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
              <p style={{ fontSize: 13, color: "#555" }}>No jobs in this category.</p>
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
                    <Icon d={icons.edit} size={12} /> Edit
                  </button>
                </div>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Calendar */}
      <DashboardCalendar jobs={jobs} equipment={equipment} />

      {/* Equipment status */}
      <div style={S.card}>
        <p style={S.sectionTitle}>Equipment Status Today</p>
        {avList.filter(e => e.taken > 0).length === 0
          ? <p style={{ color: "#666", fontSize: 13 }}>All equipment available.</p>
          : avList.filter(e => e.taken > 0).map(eq => (
            <div key={eq.id} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{eq.name}</p>
                <p style={{ margin: 0, fontSize: 11, color: "#666" }}>{eq.taken} out · {eq.available} available</p>
              </div>
              <AvailBar available={eq.available} total={eq.total} />
            </div>
          ))}
      </div>

      {/* Recent activity */}
      <div style={S.card}>
        <p style={S.sectionTitle}>Recent Activity</p>
        {activityGroups.length === 0 ? (
          <p style={{ color: "#666", fontSize: 13 }}>No activity recorded yet.</p>
        ) : activityGroups.map((group, i, arr) => {
          const isExpanded = expandedActivityKeys.has(group.key);
          const sortedItems = [...group.items].sort((a, b) => b.ts - a.ts);
          const latestType = sortedItems[0]?.type;
          const isPick = latestType === "pick" || latestType === "checkout";
          const empNames = [...group.empNames].join(", ");
          return (
            <div key={group.key} style={{ paddingBottom: i < arr.length - 1 ? 10 : 0, marginBottom: i < arr.length - 1 ? 10 : 0, borderBottom: i < arr.length - 1 ? "1px solid #252830" : "none" }}>
              <div onClick={() => toggleActivity(group.key)} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                <span style={S.badge(isPick ? "amber" : "green")}>{isPick ? "PICKED" : "RETURNED"}</span>
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
                        <span style={S.badge(cIsPick ? "amber" : "green")}>{cIsPick ? "PICK" : "RETURN"}</span>
                        <div style={{ flex: 1 }}>
                          <p style={{ margin: 0, fontSize: 12, fontWeight: 600 }}>{eq?.name || "Unknown"} ×{c.qty}</p>
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
            Gear Requests
            {pendingRequests.length > 0 && <span style={{ ...S.badge("amber"), marginLeft: 8 }}>{pendingRequests.length} pending</span>}
          </p>
        </div>
        {(equipmentRequests || []).length === 0 ? (
          <p style={{ fontSize: 13, color: "#555" }}>No requests yet.</p>
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
          <Modal title="Gear Request Detail" onClose={() => setDashReqModal(null)}>
            <div style={S.col}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={S.badge(req.status === "approved" ? "green" : req.status === "denied" ? "red" : "amber")}>{req.status}</span>
                <span style={{ fontWeight: 700, fontSize: 15 }}>{req.employeeName}</span>
              </div>

              <div style={{ borderTop: "1px solid #252830", paddingTop: 12 }}>
                <p style={{ ...S.label, marginBottom: 8 }}>Requested Items</p>
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
                  <p style={S.label}>Date{req.useDates?.length > 1 ? "s" : ""} Needed</p>
                  <p style={{ fontSize: 13, color: "#e8e4dc", margin: 0 }}>{dateLabel}</p>
                </div>
              )}

              <div>
                <p style={S.label}>Purpose</p>
                <p style={{ fontSize: 13, color: "#e8e4dc", margin: 0 }}>
                  {req.purpose === "work" ? `Work — ${req.jobName || ""}${req.productionName ? ` (${req.productionName})` : ""}` : "Practice / Personal Use"}
                </p>
              </div>

              {req.reason && (
                <div>
                  <p style={S.label}>Reason</p>
                  <p style={{ fontSize: 13, color: "#8a8f9d", margin: 0 }}>{req.reason}</p>
                </div>
              )}

              <p style={{ fontSize: 11, color: "#444", margin: 0 }}>Requested {new Date(req.requestedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</p>

              {req.status === "pending" && (
                <div style={{ display: "flex", gap: 10, paddingTop: 4 }}>
                  <button style={{ ...S.btn("danger"), flex: 1 }} onClick={() => denyRequest(req)}>Deny</button>
                  <button style={{ ...S.btn("success"), flex: 1 }} onClick={() => approveRequest(req)}>Approve</button>
                </div>
              )}
              {req.status === "approved" && (() => {
                const reqCheckouts = checkouts.filter(c => c.requestId === req.id);
                if (reqCheckouts.length === 0) return null;
                const pickedIds = new Set(reqCheckouts.filter(c => c.type === "pick" || c.type === "checkout").map(c => c.eqId));
                const returnedIds = new Set(reqCheckouts.filter(c => c.type === "return").map(c => c.eqId));
                return (
                  <div style={{ borderTop: "1px solid #252830", paddingTop: 12 }}>
                    <p style={{ ...S.label, marginBottom: 8 }}>Checkout Status</p>
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
                <button style={{ ...S.btn("ghost"), width: "100%" }} onClick={() => setDashReqModal(null)}>Close</button>
              )}
            </div>
          </Modal>
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
function EmployeeView({ employee, jobs, equipment, checkouts, setCheckouts, reports, setReports, invoices, setInvoices, productionCompanies, companyName, setLang, onLogout, setEmployees, equipmentRequests, setEquipmentRequests, lineGroupId, lineNotifyMuted }) {
  const t = useT();
  const lang = useContext(LangCtx);
  const [tab, setTab] = useState("today"); // today | calendar | profile | report | invoice
  const [showReportModal, setShowReportModal] = useState(false);
  const [showGearRequest, setShowGearRequest] = useState(false);
  const [gearReqForm, setGearReqForm] = useState({ useDates: [], purpose: "practice", productionName: "", jobName: "", reason: "", selectedGear: {} });
  const [gearReqCalMonth, setGearReqCalMonth] = useState(() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() }; });
  const [pinChangeForm, setPinChangeForm] = useState({ newPin: "", confirmPin: "" });
  const [pinChangeMsg, setPinChangeMsg] = useState(null);
  const [selectedJob, setSelectedJob] = useState(null);
  const [checkedItems, setCheckedItems] = useState({});
  const [phase, setPhase] = useState("select");
  const [capturePhoto, setCapturePhoto] = useState(null);
  const [captureLocation, setCaptureLocation] = useState(null);
  const [profilePhoto, setProfilePhoto] = useState(null);
  const [profileInfo, setProfileInfo] = useState({ firstName: "", lastName: "", nickname: "", phone: "", email: "", lineId: "", legalAddress: "", bankName: "", bankAccount: "", accountName: "" });
  const [idCard, setIdCard] = useState(null);
  const [promptPayQR, setPromptPayQR] = useState(null);
  const [signature, setSignature] = useState(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [invoiceModal, setInvoiceModal] = useState(null); // null | { job, existing }
  const [expandedInv, setExpandedInv] = useState(null);
  const [expandedStat, setExpandedStat] = useState(null); // null | "today" | "confirmed" | "pencil"
  const [empDetailJob, setEmpDetailJob] = useState(null);
  const [invFilter, setInvFilter] = useState("all"); // all | Pending | Paid
  const [invSort, setInvSort] = useState("date"); // date | amount
  const [revPeriod, setRevPeriod] = useState("all"); // all | year | custom
  const [revYear, setRevYear] = useState(new Date().getFullYear().toString());
  const [revFrom, setRevFrom] = useState("");
  const [revTo, setRevTo] = useState("");
  const profileFileRef = useRef(null);
  const idCardRef = useRef(null);
  const promptPayRef = useRef(null);
  const signatureRef = useRef(null);
  const [profileSaveStatus, setProfileSaveStatus] = useState(null); // null | "saving" | "saved" | "error"

  const todayStr = today();
  const availableJobs = jobs.filter(j => j.status === "Confirmed" && j.dates.includes(todayStr) && (j.assignedEquipment || []).length > 0);
  const myReports = reports.filter(r => r.reportedBy?.id === employee.id);

  // Load full profile from cloud
  useEffect(() => {
    api.getProfile(employee.id).then(d => {
      if (!d) return;
      if (d.photo) setProfilePhoto(d.photo);
      setProfileInfo({ firstName: d.firstName || "", lastName: d.lastName || "", nickname: d.nickname || "", phone: d.phone || "", email: d.email || "", lineId: d.lineId || "", legalAddress: d.legalAddress || "", bankName: d.bankName || "", bankAccount: d.bankAccount || "", accountName: d.accountName || "" });
      if (d.idCard) setIdCard(d.idCard);
      if (d.promptPayQR) setPromptPayQR(d.promptPayQR);
      if (d.signature) setSignature(d.signature);
    }).catch(() => {}).finally(() => setProfileLoaded(true));
  }, [employee.id]);

  const saveProfile = async () => {
    if (!profileLoaded) return;
    setProfileSaveStatus("saving");
    try {
      const res = await api.putProfile(employee.id, { photo: profilePhoto, ...profileInfo, idCard, promptPayQR, signature });
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
    const r = new FileReader();
    r.onload = (ev) => setProfilePhoto(ev.target.result);
    r.readAsDataURL(f);
  };

  const handleDocUpload = (setter) => (e) => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = (ev) => setter(ev.target.result);
    r.readAsDataURL(f);
  };

  const getJobCheckoutState = (job) => {
    const jobCheckouts = checkouts.filter(c => c.jobId === job.id);
    const assignedIds = (job.assignedEquipment || []).map(ae => ae.eqId);
    const pickedIds = new Set(jobCheckouts.filter(c => c.type === "pick" || c.type === "checkout").map(c => c.eqId));
    const returnedIds = new Set(jobCheckouts.filter(c => c.type === "return").map(c => c.eqId));
    const allPicked = assignedIds.every(id => pickedIds.has(id));
    const allReturned = assignedIds.every(id => returnedIds.has(id));
    return { allPicked, allReturned, pickedIds, returnedIds };
  };

  const selectJob = (job) => {
    setSelectedJob(job);
    const { allPicked } = getJobCheckoutState(job);
    setPhase(allPicked ? "return" : "pick");
    setCheckedItems({});
  };

  const toggleItem = (eqId) => setCheckedItems(p => ({ ...p, [eqId]: !p[eqId] }));
  const allSelected = selectedJob && (selectedJob.assignedEquipment || []).every(ae => checkedItems[ae.eqId]);

  const proceedToPhoto = () => {
    if (!allSelected) return;
    setPhase(phase === "pick" ? "photo_pick" : "photo_return");
  };

  const submitCheckout = () => {
    if (!capturePhoto) return;
    const type = phase === "photo_pick" ? "pick" : "return";
    const newCheckouts = (selectedJob.assignedEquipment || []).map(ae => ({
      id: "co" + Date.now() + ae.eqId,
      jobId: selectedJob.id,
      jobName: selectedJob.name,
      eqId: ae.eqId,
      qty: ae.qty,
      employeeId: employee.id,
      employeeName: employee.name,
      type,
      ts: Date.now(),
      photo: capturePhoto,
      location: captureLocation,
    }));
    setCheckouts(p => [...p, ...newCheckouts]);
    setPhase(type === "pick" ? "done_pick" : "done_return");
  };

  // ── Non-select phases (checkout flow) ──────────────────────────────────────
  if (phase !== "select" && selectedJob) {
    const { pickedIds, returnedIds } = getJobCheckoutState(selectedJob);

    if (phase === "done_pick" || phase === "done_return") {
      return (
        <div style={{ ...S.main, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "80vh" }}>
          <div style={{ textAlign: "center", maxWidth: 400 }}>
            <StepBar currentStep={phase === "done_pick" ? 1 : 2} />
            <div style={{ fontSize: 60, marginBottom: 16 }}>{phase === "done_pick" ? "✅" : "🏁"}</div>
            <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>{phase === "done_pick" ? t("gearPickedUp") : t("gearReturned")}</h2>
            {capturePhoto && <img src={capturePhoto} alt="evidence" style={{ width: "100%", borderRadius: 8, marginBottom: 12 }} />}
            <p style={{ color: "#666", marginBottom: 24 }}>{captureLocation ? t("savedGPS") : t("savedNoGPS")}</p>
            <button style={S.btn("primary")} onClick={() => { setSelectedJob(null); setPhase("select"); setCapturePhoto(null); setCaptureLocation(null); setCheckedItems({}); }}>{t("backToJobs")}</button>
          </div>
        </div>
      );
    }

    if (phase === "photo_pick" || phase === "photo_return") {
      return (
        <div style={{ ...S.main, maxWidth: 500 }}>
          <button style={{ ...S.btn("ghost"), marginBottom: 16 }} onClick={() => setPhase(phase === "photo_pick" ? "pick" : "return")}><Icon d={icons.arrow_left} size={15} /> {t("back")}</button>
          <StepBar currentStep={phase === "photo_pick" ? 0 : 2} />
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{phase === "photo_pick" ? t("pickUpPhoto") : t("returnPhoto")}</h2>
          <p style={{ fontSize: 13, color: "#666", marginBottom: 20 }}>{t("photoInstruction")}</p>
          <div style={{ ...S.card, background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.15)", marginBottom: 20 }}>
            <p style={{ margin: 0, fontSize: 12, color: "#f87171", display: "flex", gap: 8, alignItems: "center" }}><Icon d={icons.lock} size={14} /> {t("photoLiveWarning")}</p>
          </div>
          <GeoPhoto label={phase === "photo_pick" ? t("capturePickPhoto") : t("captureReturnPhoto")} onCapture={(dataUrl, loc) => { setCapturePhoto(dataUrl); setCaptureLocation(loc); }} />
          {capturePhoto && (
            <button style={{ ...S.btn("primary"), width: "100%", marginTop: 16, justifyContent: "center" }} onClick={submitCheckout}>
              <Icon d={icons.check} size={15} /> {phase === "photo_pick" ? t("confirmPickUp") : t("confirmReturn")}
            </button>
          )}
        </div>
      );
    }

    // Checklist phase
    const isReturn = phase === "return";
    return (
      <div style={{ ...S.main, maxWidth: 600 }}>
        <button style={{ ...S.btn("ghost"), marginBottom: 16 }} onClick={() => { setSelectedJob(null); setPhase("select"); }}><Icon d={icons.arrow_left} size={15} /> {t("back")}</button>
        <StepBar currentStep={isReturn ? 2 : 0} />
        <div style={{ ...S.card, marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{selectedJob.name}</h2>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "#666" }}>{selectedJob.production} · {selectedJob.location}{selectedJob.locationCity ? ` · ${selectedJob.locationCity}` : ""} · {selectedJob.shootTime}</p>
        </div>
        <p style={S.sectionTitle}>{isReturn ? t("returnPhase") : t("pickPhase")} {t("tickWhenReady")}</p>
        <div style={S.col}>
          {(selectedJob.assignedEquipment || []).map(ae => {
            const eq = equipment.find(e => e.id === ae.eqId);
            if (!eq) return null;
            const done = isReturn ? returnedIds.has(ae.eqId) : pickedIds.has(ae.eqId);
            const checked = done || !!checkedItems[ae.eqId];
            return (
              <div key={ae.eqId} style={{ ...S.card, background: "#0f1117", display: "flex", alignItems: "center", gap: 16, opacity: done ? 0.5 : 1 }}>
                <div onClick={() => !done && toggleItem(ae.eqId)} style={{ width: 24, height: 24, borderRadius: 6, border: checked ? "none" : "2px solid #2e3340", background: checked ? "#e8b84b" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: done ? "default" : "pointer", flexShrink: 0 }}>
                  {checked && <Icon d={icons.check} size={14} color="#0f1117" strokeW={3} />}
                </div>
                {eq.photo && <img src={eq.photo} alt="" style={{ width: 48, height: 40, objectFit: "cover", borderRadius: 6 }} />}
                <div style={{ flex: 1 }}>
                  <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>{eq.name}</p>
                  <p style={{ margin: "2px 0 0", fontSize: 12, color: "#666" }}>{eq.category} · {t("qty")}: {ae.qty}{done ? ` · ${t("alreadyProcessed")}` : ""}</p>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 20 }}>
          {!allSelected && <p style={{ fontSize: 12, color: "#f87171", marginBottom: 12 }}>{t("tickAllWarning")}</p>}
          <button style={{ ...S.btn(allSelected ? "primary" : "ghost"), width: "100%", justifyContent: "center" }} onClick={proceedToPhoto} disabled={!allSelected}>
            <Icon d={icons.camera} size={15} /> {t("proceedPhoto")}
          </button>
        </div>
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

            {/* Stats — clickable, expand one at a time */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              {[
                { key: "today", label: "Today", value: availableJobs.length, color: "#e8b84b" },
                { key: "confirmed", label: "Confirmed", value: confirmedJobs.length, color: "#34d399" },
                { key: "pencil", label: "Pencil", value: pencilJobs.length, color: "#94a3b8" },
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
                <p style={{ ...S.sectionTitle, margin: 0 }}>{t("gearRequests")} {pendingRequests.length > 0 && <span style={{ ...S.badge("amber"), marginLeft: 6 }}>{pendingRequests.length} pending</span>}</p>
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
                                    {isMulti ? ` · ${maxAvail} of ${eq.total} free` : maxAvail === 0 ? " · Unavailable" : " · Available"}
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

            {/* Calendar */}
            <div>
              <p style={{ ...S.sectionTitle, marginBottom: 8 }}>{t("jobSchedule")}</p>
              <DashboardCalendar jobs={jobs} equipment={equipment} />
            </div>
          </div>
          );
        })()}

        {/* REPORT TAB */}
        {tab === "report" && (
          <div style={S.col}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <h1 style={{ ...S.pageTitle, fontSize: 18, marginBottom: 2 }}>{t("reportTitle")}</h1>
                <p style={{ ...S.pageSubtitle, marginBottom: 0, fontSize: 12 }}>{t("myReports")}</p>
              </div>
              <button style={S.btn("primary")} onClick={() => setShowReportModal(true)}>
                <Icon d={icons.alert} size={14} /> {t("reportNew")}
              </button>
            </div>
            {myReports.length === 0 ? (
              <div style={{ ...S.card, textAlign: "center", padding: 40 }}>
                <Icon d={icons.alert} size={40} color="#2e3340" />
                <p style={{ color: "#666", marginTop: 12 }}>{t("reportNone")}</p>
              </div>
            ) : [...myReports].sort((a, b) => b.ts - a.ts).map(r => (
              <div key={r.id} style={{ ...S.card, border: r.status === "open" ? "1px solid rgba(239,68,68,0.25)" : "1px solid #252830" }}>
                <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
                  {{ open: <span style={S.badge("red")}>{t("reportStatusOpen")}</span>, solved: <span style={S.badge("green")}>{t("reportStatusSolved")}</span>, discarded: <span style={S.badge("gray")}>{t("reportStatusDiscarded")}</span> }[r.status]}
                  {r.eqName && <span style={S.tag}>{r.eqName}</span>}
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
        )}

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
                    placeholder="Legal Address"
                    value={profileInfo.legalAddress}
                    onChange={e => setProfileInfo(p => ({ ...p, legalAddress: e.target.value }))} />
                </div>
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
                    <input ref={idCardRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleDocUpload(setIdCard)} />
                    <button style={S.btn("ghost")} onClick={() => idCardRef.current.click()}>
                      <Icon d={icons.photo} size={14} /> {idCard ? "Replace" : "Upload"}
                    </button>
                    {idCard && <button style={{ ...S.btn("danger"), padding: "7px 10px" }} onClick={() => setIdCard(null)}><Icon d={icons.x} size={13} /></button>}
                  </div>
                </div>
                {/* PromptPay / Bank QR */}
                <div>
                  <label style={S.label}>{t("promptPayQR")}</label>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    {promptPayQR && <img src={promptPayQR} alt="QR" style={{ width: 80, height: 80, objectFit: "contain", borderRadius: 6, border: "1px solid #2e3340", background: "#fff" }} />}
                    <input ref={promptPayRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleDocUpload(setPromptPayQR)} />
                    <button style={S.btn("ghost")} onClick={() => promptPayRef.current.click()}>
                      <Icon d={icons.photo} size={14} /> {promptPayQR ? "Replace" : "Upload"}
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
                      <Icon d={icons.photo} size={14} /> {signature ? "Replace" : "Upload Signature"}
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
                {profileSaveStatus === "saving" ? "Saving…" : profileSaveStatus === "saved" ? "✓ Profile Saved" : profileSaveStatus === "error" ? "Save Failed — Tap to Retry" : "Save Profile"}
              </button>
            </div>

            {/* My recent activity */}
            <div style={S.card}>
              <p style={S.sectionTitle}>{t("recentActivity")}</p>
              {checkouts.filter(c => c.employeeId === employee.id).length === 0
                ? <p style={{ fontSize: 13, color: "#666" }}>{t("noActivity")}</p>
                : checkouts.filter(c => c.employeeId === employee.id).slice(-8).reverse().map((c, i, arr) => {
                    const eq = equipment.find(e => e.id === c.eqId);
                    return (
                      <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", paddingBottom: 10, borderBottom: i < arr.length - 1 ? "1px solid #252830" : "none", marginBottom: 10 }}>
                        <span style={{ ...S.badge(c.type === "pick" || c.type === "checkout" ? "amber" : "green"), flexShrink: 0 }}>{c.type === "pick" || c.type === "checkout" ? t("pickEvt") : t("returnEvt")}</span>
                        <div>
                          <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{eq?.name || "Unknown"}</p>
                          <p style={{ margin: "2px 0 0", fontSize: 11, color: "#666" }}>{c.jobName} · {formatDateTime(c.ts)}</p>
                        </div>
                      </div>
                    );
                  })}
            </div>
          </div>
        )}

        {/* INVOICE TAB */}
        {tab === "invoice" && (() => {
          const confirmedJobs = jobs.filter(j => j.status === "Confirmed").sort((a, b) => (b.dates[0] || "") > (a.dates[0] || "") ? 1 : -1);
          const allMyInvoices = invoices.filter(inv => inv.employeeId === employee.id);
          const filteredInvoices = allMyInvoices
            .filter(inv => invFilter === "all" ? true : (inv.status || "Pending") === invFilter)
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
                                <button style={{ ...S.btn("ghost"), fontSize: 12, padding: "6px 10px" }} onClick={() => {
                                  const name = profileInfo.firstName ? `${profileInfo.firstName} ${profileInfo.lastName || ""}`.trim() : employee.name;
                                  const total = (() => { const items = inv.items || [{ description: "Labor", qty: 1, rate: (inv.laborFee||0)+(inv.overtime||0)+(inv.travelFee||0)+(inv.perDiem||0) }]; return items.reduce((s, it) => s + (it.qty||1)*(it.rate||0), 0); })();
                                  const msg = `🧾 Invoice — ${name}\n📄 ${fmtInvoiceNo(inv)}\n🎬 ${inv.jobName || "—"}${inv.productionCompany ? ` · ${inv.productionCompany}` : ""}\n💰 ฿${total.toLocaleString()}\n📋 ${inv.status || "Pending"}\n🔗 https://pickshootreturn.pages.dev`;
                                  api.notify({ userIds: [lineGroupId], message: msg });
                                }}>
                                  💬 Send to Group
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
                  employee={employee}
                  onSave={saveInvoice}
                  onClose={() => setInvoiceModal(null)}
                  allInvoices={invoices}
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
          { key: "report", label: t("tabReport"), icon: icons.alert },
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
      const r = new FileReader();
      r.onload = (ev) => setPhotos(p => [...p, ev.target.result]);
      r.readAsDataURL(f);
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
function Login({ onLogin, employees, companyName, adminPin }) {
  const [mode, setMode] = useState("choose"); // choose | admin | employee
  const [pin, setPin] = useState("");
  const [selectedEmp, setSelectedEmp] = useState(null);
  const [error, setError] = useState("");
  const [ddOpen, setDdOpen] = useState(false);

  const tryLogin = () => {
    if (mode === "admin") {
      if (pin === adminPin) { onLogin({ role: "admin" }); }
      else { setError("Incorrect PIN."); setPin(""); }
    } else if (mode === "employee" && selectedEmp) {
      const emp = employees.find(e => e.id === selectedEmp);
      if (pin === emp.pin) { onLogin({ role: "employee", ...emp }); }
      else { setError("Incorrect PIN."); setPin(""); }
    }
  };

  const addDigit = (d) => { if (pin.length < 6) setPin(p => p + d); setError(""); };
  const del = () => setPin(p => p.slice(0, -1));

  if (mode === "choose") return (
    <div style={{ minHeight: "100vh", background: "#0f1117", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center", maxWidth: 340 }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}><Icon d={icons.film} size={48} color="#e8b84b" /></div>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: "#e8e4dc", marginBottom: 4 }}>{companyName || "GEAR DESK"}</h1>
        <p style={{ color: "#666", marginBottom: 40, fontSize: 13, letterSpacing: "0.1em", textTransform: "uppercase" }}>Equipment Checkout System</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <button style={{ ...S.btn("primary"), justifyContent: "center", padding: "14px 24px", fontSize: 15 }} onClick={() => setMode("admin")}><Icon d={icons.lock} size={16} /> Admin Login</button>
          <button style={{ ...S.btn("ghost"), justifyContent: "center", padding: "14px 24px", fontSize: 15 }} onClick={() => setMode("employee")}><Icon d={icons.user} size={16} /> Employee Login</button>
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#0f1117", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: 300 }}>
        <button style={{ ...S.btn("ghost"), marginBottom: 24, fontSize: 12 }} onClick={() => { setMode("choose"); setPin(""); setError(""); setSelectedEmp(null); }}><Icon d={icons.arrow_left} size={14} /> Back</button>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{mode === "admin" ? "Admin PIN" : "Employee Login"}</h2>
        {mode === "employee" && (() => {
          const selEmp = employees.find(e => e.id === selectedEmp);
          return (
            <div style={{ marginBottom: 20, position: "relative" }}>
              <label style={S.label}>Account</label>
              <button
                onClick={() => setDdOpen(o => !o)}
                style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 14px", background: "#1a1e27", border: `1px solid ${ddOpen ? "#e8b84b" : "#2e3340"}`, borderRadius: 10, color: selEmp ? "#e8e4dc" : "#555", fontSize: 14, fontWeight: selEmp ? 600 : 400, cursor: "pointer", transition: "border-color .15s" }}>
                <span>{selEmp ? selEmp.name : "Select account…"}</span>
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
              ? <span style={{ fontSize: 12, color: "#444", letterSpacing: "0.08em", textTransform: "uppercase" }}>Enter PIN</span>
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
        {error && <p style={{ color: "#f87171", fontSize: 13, textAlign: "center", marginBottom: 12 }}>{error}</p>}
        <button style={{ ...S.btn("primary"), width: "100%", justifyContent: "center", padding: "12px" }} onClick={tryLogin} disabled={mode === "employee" && !selectedEmp}>
          Unlock
        </button>

      </div>
    </div>
  );
}

// ─── SETTINGS / EMPLOYEES PAGE ────────────────────────────────────────────────
function SettingsPage({ employees, setEmployees, companyName, setCompanyName, equipmentRequests, setEquipmentRequests, checkouts, setCheckouts, equipment, adminPin, setAdminPin, lineGroupId, setLineGroupId, lineNotifyMuted, setLineNotifyMuted }) {
  const [modal, setModal] = useState(null); // null | "add" | "edit" | "profile"
  const [editTarget, setEditTarget] = useState(null);
  const [form, setForm] = useState({ name: "", pin: "" });
  const [formErr, setFormErr] = useState("");
  const [showPin, setShowPin] = useState({});
  const [profileTarget, setProfileTarget] = useState(null);
  const [profileData, setProfileData] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [apForm, setApForm] = useState({ newPin: "", confirmPin: "" });
  const [apMsg, setApMsg] = useState(null);

  const openProfile = (emp) => {
    setProfileTarget(emp);
    setProfileData(null);
    setProfileLoading(true);
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
      id: "co" + now + i,
      jobId: null,
      jobName,
      eqId: item.eqId,
      qty: item.qty,
      employeeId: req.employeeId,
      employeeName: req.employeeName,
      type: "pick",
      ts: now,
      photo: null,
      location: null,
      requestId: req.id,
    }));
    setCheckouts(p => [...p, ...newCheckouts]);
  };

  const denyRequest = (id) => {
    setEquipmentRequests(p => p.map(r => r.id === id ? { ...r, status: "denied", resolvedAt: Date.now() } : r));
  };

  const openAdd = () => { setForm({ name: "", pin: "" }); setEditTarget(null); setFormErr(""); setModal("add"); };
  const openEdit = (emp) => { setForm({ name: emp.name, pin: emp.pin }); setEditTarget(emp); setFormErr(""); setModal("edit"); };

  const validate = () => {
    if (!form.name.trim()) return "Name is required.";
    if (!form.pin.trim()) return "PIN is required.";
    if (!/^\d{4,6}$/.test(form.pin)) return "PIN must be 4–6 digits.";
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
    if (window.confirm("Remove this team member?")) setEmployees(p => p.filter(e => e.id !== id));
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
        <div>
          <h1 style={S.pageTitle}>Team & Settings</h1>
          <p style={S.pageSubtitle}>Manage crew access</p>
        </div>
        <button style={S.btn("primary")} onClick={openAdd}><Icon d={icons.plus} size={15} /> Add Member</button>
      </div>

      <div style={{ ...S.card, marginBottom: 20 }}>
        <p style={S.sectionTitle}>Company</p>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <input
            style={{ ...S.input, flex: 1 }}
            value={companyName}
            onChange={e => setCompanyName(e.target.value)}
            placeholder="e.g. GEAR DESK"
            maxLength={40}
          />
          {!companyName.trim() && (
            <span style={{ fontSize: 11, color: "var(--text-muted,#666)", flexShrink: 0 }}>uses default</span>
          )}
        </div>
        <p style={{ fontSize: 11, color: "var(--text-muted,#666)", marginTop: 6 }}>Appears in the top bar and login screen.</p>
      </div>

      <div style={{ ...S.card, marginBottom: 20 }}>
        <p style={S.sectionTitle}>Team Members ({employees.length})</p>
        <div style={S.col}>
          {employees.length === 0 && <p style={{ fontSize: 13, color: "#666" }}>No team members yet.</p>}
          {employees.map((e, i) => (
            <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 12, paddingBottom: i < employees.length - 1 ? 14 : 0, marginBottom: i < employees.length - 1 ? 14 : 0, borderBottom: i < employees.length - 1 ? "1px solid #252830" : "none" }}>
              <div style={{ width: 38, height: 38, borderRadius: "50%", background: "rgba(232,184,75,0.1)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Icon d={icons.user} size={17} color="#e8b84b" />
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>{e.name}</p>
                <p style={{ margin: "2px 0 0", fontSize: 12, color: "#666", display: "flex", alignItems: "center", gap: 6 }}>
                  PIN:&nbsp;
                  <span style={{ fontFamily: "monospace", letterSpacing: 2 }}>
                    {showPin[e.id] ? e.pin : "•".repeat(e.pin.length)}
                  </span>
                  <button onClick={() => setShowPin(p => ({ ...p, [e.id]: !p[e.id] }))} style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 11, padding: 0 }}>
                    {showPin[e.id] ? "hide" : "show"}
                  </button>
                </p>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
                  <span style={{ fontSize: 10, color: "#555", flexShrink: 0 }}>LINE ID:</span>
                  <input
                    style={{ ...S.input, fontSize: 11, padding: "3px 8px", height: "auto" }}
                    value={e.lineUserId || ""}
                    placeholder="Uxxxxxxxxxx…"
                    onChange={ev => setEmployees(p => p.map(emp => emp.id === e.id ? { ...emp, lineUserId: ev.target.value } : emp))}
                  />
                </div>
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

      {/* Equipment Checkout Requests */}
      <div style={{ ...S.card, marginBottom: 20 }}>
        <p style={S.sectionTitle}>Equipment Requests {pendingRequests.length > 0 && <span style={{ ...S.badge("amber"), marginLeft: 6 }}>{pendingRequests.length} pending</span>}</p>
        {(equipmentRequests || []).length === 0 ? (
          <p style={{ fontSize: 13, color: "#666" }}>No equipment requests yet.</p>
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
                    <button style={{ ...S.btn("success"), padding: "5px 10px", fontSize: 12 }} onClick={() => approveRequest(req)}>Approve</button>
                    <button style={{ ...S.btn("danger"), padding: "5px 10px", fontSize: 12 }} onClick={() => denyRequest(req.id)}>Deny</button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ ...S.card, marginBottom: 20 }}>
        <p style={S.sectionTitle}>Line OA Notifications</p>

        {/* Group chat status */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, padding: "10px 14px", borderRadius: 8, background: lineGroupId ? "rgba(52,211,153,0.07)" : "rgba(255,255,255,0.03)", border: `1px solid ${lineGroupId ? "rgba(52,211,153,0.25)" : "#252830"}` }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: lineGroupId ? "#34d399" : "#444", flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: lineGroupId ? "#34d399" : "#666" }}>
              {lineGroupId ? "Group chat connected" : "No group chat connected"}
            </p>
            {lineGroupId && <p style={{ margin: "2px 0 0", fontSize: 10, color: "#555", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lineGroupId}</p>}
          </div>
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            {!lineGroupId && (
              <button style={{ ...S.btn("ghost"), padding: "5px 10px", fontSize: 11 }} onClick={() => api.getData().then(d => { if (d.lineGroupId) setLineGroupId(d.lineGroupId); })}>↻ Refresh</button>
            )}
            {lineGroupId && (
              <button style={{ ...S.btn("danger"), padding: "5px 10px", fontSize: 11 }} onClick={() => { api.putData({ lineGroupId: null }); setLineGroupId(null); }}>Disconnect</button>
            )}
          </div>
        </div>

        {/* Notify bypass */}
        <div
          onClick={() => { const next = !lineNotifyMuted; setLineNotifyMuted(next); try { localStorage.setItem("psr_notify_muted", next ? "1" : "0"); } catch {} }}
          style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 8, background: lineNotifyMuted ? "rgba(239,68,68,0.07)" : "rgba(52,211,153,0.05)", border: `1px solid ${lineNotifyMuted ? "rgba(239,68,68,0.25)" : "rgba(52,211,153,0.15)"}`, cursor: "pointer", userSelect: "none" }}>
          <div style={{ width: 36, height: 20, borderRadius: 10, background: lineNotifyMuted ? "#ef4444" : "#34d399", position: "relative", flexShrink: 0, transition: "background .2s" }}>
            <div style={{ position: "absolute", top: 2, left: lineNotifyMuted ? 2 : 18, width: 16, height: 16, borderRadius: "50%", background: "#fff", transition: "left .2s", boxShadow: "0 1px 3px rgba(0,0,0,.3)" }} />
          </div>
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: lineNotifyMuted ? "#f87171" : "#34d399" }}>
              {lineNotifyMuted ? "🔕 Notifications muted" : "🔔 Notifications active"}
            </p>
            <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-muted,#555)" }}>
              {lineNotifyMuted ? "No messages sent to LINE — testing mode" : "All job/report/request events notify the group"}
            </p>
          </div>
        </div>

        <div style={{ fontSize: 12, color: "var(--text-muted,#666)", lineHeight: 1.8 }}>
          <strong style={{ color: "var(--text,#e8e4dc)", display: "block", marginBottom: 6 }}>Connect a Group Chat (one-time):</strong>
          1. Add your LINE OA to the group chat<br />
          2. In <strong>LINE Developers Console</strong> → Messaging API → Webhook URL, set:<br />
          <code style={{ background: "rgba(232,184,75,0.1)", color: "var(--accent,#e8b84b)", padding: "2px 8px", borderRadius: 4, display: "inline-block", margin: "4px 0", fontSize: 11 }}>https://pickshootreturn.pages.dev/api/webhook</code><br />
          3. Enable <strong>Use webhook</strong> and click <strong>Verify</strong><br />
          4. The group ID is captured automatically when the OA joins or receives a message in the group
        </div>
        <p style={{ fontSize: 11, color: "var(--text-muted,#555)", marginTop: 10 }}>
          {lineGroupId ? "All job notifications go to the group. Free tier: 200 messages/month." : "Without a group, notifications go to individual team members via their Line User ID above."}
        </p>
      </div>

      <div style={S.card}>
        <p style={S.sectionTitle}>📅 Calendar Sync</p>
        <div style={S.col}>
          <p style={{ fontSize: 13, color: "var(--text-muted,#666)", margin: 0, lineHeight: 1.7 }}>
            Subscribe to the job schedule in your iPhone Calendar. Pencil jobs appear as <strong style={{ color: "var(--text,#e8e4dc)" }}>tentative (striped)</strong>, Confirmed as <strong style={{ color: "#34d399" }}>solid</strong>. Auto-refreshes hourly.
          </p>
          <div style={{ fontSize: 12, color: "var(--text-muted,#666)", lineHeight: 1.8 }}>
            <strong style={{ color: "var(--text,#e8e4dc)", display: "block", marginBottom: 6 }}>Subscribe on iPhone:</strong>
            1. Open <strong>Settings → Calendar → Accounts → Add Account → Other</strong><br />
            2. Tap <strong>Add Subscribed Calendar</strong><br />
            3. Paste this URL:<br />
            <code style={{ background: "rgba(232,184,75,0.1)", color: "var(--accent,#e8b84b)", padding: "2px 8px", borderRadius: 4, display: "inline-block", margin: "4px 0", fontSize: 11 }}>https://pickshootreturn.pages.dev/api/calendar</code><br />
            4. Tap <strong>Next</strong> → <strong>Save</strong>
          </div>
          <button style={{ ...S.btn("ghost"), alignSelf: "flex-start", fontSize: 12 }} onClick={() => { navigator.clipboard?.writeText("https://pickshootreturn.pages.dev/api/calendar"); }}>
            📋 Copy Calendar URL
          </button>
        </div>
      </div>

      <div style={S.card}>
        <p style={S.sectionTitle}>Admin PIN</p>
        <div style={S.col}>
          <p style={{ fontSize: 13, color: "var(--text-muted,#666)", margin: 0 }}>Current admin PIN: <strong style={{ color: "var(--accent,#e8b84b)", fontFamily: "monospace" }}>{adminPin}</strong></p>
          <div style={S.row}>
            <div style={{ flex: 1 }}>
              <label style={S.label}>New PIN (4–6 digits)</label>
              <input style={S.input} type="password" inputMode="numeric" maxLength={6} value={apForm.newPin} onChange={e => setApForm(p => ({ ...p, newPin: e.target.value.replace(/\D/g, "") }))} placeholder="e.g. 9999" />
            </div>
            <div style={{ flex: 1 }}>
              <label style={S.label}>Confirm PIN</label>
              <input style={S.input} type="password" inputMode="numeric" maxLength={6} value={apForm.confirmPin} onChange={e => setApForm(p => ({ ...p, confirmPin: e.target.value.replace(/\D/g, "") }))} placeholder="Re-enter PIN" />
            </div>
          </div>
          {apMsg && <p style={{ fontSize: 12, color: apMsg.ok ? "#34d399" : "#f87171", margin: 0 }}>{apMsg.text}</p>}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button style={S.btn("primary")} onClick={() => {
              const { newPin, confirmPin } = apForm;
              if (!/^\d{4,6}$/.test(newPin)) { setApMsg({ ok: false, text: "PIN must be 4–6 digits." }); return; }
              if (newPin !== confirmPin) { setApMsg({ ok: false, text: "PINs do not match." }); return; }
              setAdminPin(newPin);
              setApForm({ newPin: "", confirmPin: "" });
              setApMsg({ ok: true, text: "Admin PIN updated." });
              setTimeout(() => setApMsg(null), 3000);
            }}>Change Admin PIN</button>
          </div>
        </div>
      </div>

      <div style={S.card}>
        <p style={S.sectionTitle}>System Info</p>
        <p style={{ fontSize: 13, color: "#666" }}>All data is stored in Cloudflare KV — synced across all devices automatically.</p>
        <p style={{ fontSize: 13, color: "#666", marginTop: 8 }}>Geo-locked photos use the browser's camera API — location metadata is embedded in the image stamp.</p>
      </div>

      {(modal === "add" || modal === "edit") && (
        <Modal title={modal === "add" ? "Add Team Member" : "Edit Team Member"} onClose={() => setModal(null)}>
          <div style={S.col}>
            <div>
              <label style={S.label}>Name</label>
              <input style={S.input} value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Somchai" autoFocus />
            </div>
            <div>
              <label style={S.label}>PIN (4–6 digits)</label>
              <input style={S.input} type="text" inputMode="numeric" maxLength={6} value={form.pin} onChange={e => setForm(p => ({ ...p, pin: e.target.value.replace(/\D/g, "") }))} placeholder="e.g. 1234" />
            </div>
            {formErr && <p style={{ fontSize: 12, color: "#f87171", margin: 0 }}>{formErr}</p>}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button style={S.btn("ghost")} onClick={() => setModal(null)}>Cancel</button>
              <button style={S.btn("primary")} onClick={saveEmployee}>{modal === "add" ? "Add Member" : "Save Changes"}</button>
            </div>
          </div>
        </Modal>
      )}

      {modal === "profile" && profileTarget && (
        <Modal title={`${profileTarget.name}'s Profile`} onClose={() => setModal(null)}>
          {profileLoading ? (
            <p style={{ color: "#666", textAlign: "center", padding: 24 }}>Loading…</p>
          ) : !profileData ? (
            <p style={{ color: "#666", textAlign: "center", padding: 24 }}>No profile data uploaded yet.</p>
          ) : (
            <div style={S.col}>
              {profileData.photo && (
                <div style={{ display: "flex", justifyContent: "center" }}>
                  <img src={profileData.photo} alt="profile" style={{ width: 90, height: 90, borderRadius: "50%", objectFit: "cover", border: "3px solid #e8b84b" }} />
                </div>
              )}
              {[
                ["Phone", profileData.phone],
                ["Email", profileData.email],
                ["Line ID", profileData.lineId],
              ].filter(([, v]) => v).map(([label, val]) => (
                <div key={label}>
                  <p style={{ ...S.sectionTitle, marginBottom: 3 }}>{label}</p>
                  <p style={{ margin: 0, fontSize: 14 }}>{val}</p>
                </div>
              ))}
              {profileData.legalAddress && (
                <div>
                  <p style={{ ...S.sectionTitle, marginBottom: 3 }}>Legal Address</p>
                  <p style={{ margin: 0, fontSize: 13, whiteSpace: "pre-wrap", color: "#8a8f9d" }}>{profileData.legalAddress}</p>
                </div>
              )}
              {profileData.idCard && (
                <div>
                  <p style={{ ...S.sectionTitle, marginBottom: 6 }}>ID Card</p>
                  <img src={profileData.idCard} alt="ID" style={{ width: "100%", maxWidth: 280, borderRadius: 8, border: "1px solid #2e3340" }} />
                </div>
              )}
              {profileData.promptPayQR && (
                <div>
                  <p style={{ ...S.sectionTitle, marginBottom: 6 }}>PromptPay / Bank QR</p>
                  <img src={profileData.promptPayQR} alt="QR" style={{ width: 120, height: 120, objectFit: "contain", borderRadius: 8, border: "1px solid #2e3340", background: "#fff", padding: 4 }} />
                </div>
              )}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

// ─── INVOICE PAGE ─────────────────────────────────────────────────────────────
function InvoicePage({ productionCompanies, setProductionCompanies, invoices, setInvoices, employees, companyName }) {
  const [activeTab, setActiveTab] = useState("companies");
  const [modal, setModal] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [form, setForm] = useState({ name: "", address: "" });
  const [previewing, setPreviewing] = useState(null);

  const previewInvoice = async (inv) => {
    if (previewing === inv.id) return;
    setPreviewing(inv.id);
    try {
      const emp = employees.find(e => e.id === inv.employeeId) || { name: inv.employeeName, id: inv.employeeId };
      const profileData = await api.getProfile(inv.employeeId).catch(() => null);
      const profileInfo = profileData ? { phone: profileData.phone, email: profileData.email, lineId: profileData.lineId, legalAddress: profileData.legalAddress, bankName: profileData.bankName, bankAccount: profileData.bankAccount, accountName: profileData.accountName } : {};
      printInvoice({ invoice: inv, employee: emp, profileInfo, promptPayQR: profileData?.promptPayQR || null, idCard: profileData?.idCard || null, signature: profileData?.signature || null, productionCompanies, companyName });
    } finally {
      setPreviewing(null);
    }
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
        {[["companies", "🏢 Companies"], ["invoices", `📄 All Invoices${invoices.length ? " (" + invoices.length + ")" : ""}`]].map(([key, lbl]) => (
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
          {invoices.length === 0 ? (
            <div style={{ ...S.card, textAlign: "center", padding: "40px 20px" }}>
              <Icon d={icons.invoice} size={36} color="var(--text-muted,#444)" />
              <p style={{ color: "var(--text-muted,#666)", fontSize: 13, marginTop: 12 }}>No invoices submitted yet.</p>
            </div>
          ) : (
            <div style={S.col}>
              {[...invoices].sort((a, b) => b.updatedAt - a.updatedAt).map(inv => {
                const total = calcTotal(inv);
                const isPaid = (inv.status || "Pending") === "Paid";
                return (
                  <div key={inv.id} style={{ ...S.card, border: isPaid ? "1px solid rgba(52,211,153,0.25)" : "var(--card-border,1px solid #252830)" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 3 }}>
                          <span style={{ ...S.badge(isPaid ? "green" : "amber"), fontSize: 10 }}>{inv.status || "Pending"}</span>
                          <p style={{ margin: 0, fontSize: 10, color: "var(--text-muted,#666)", fontFamily: "monospace" }}>{fmtInvoiceNo(inv)}</p>
                        </div>
                        <p style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>{inv.jobName}</p>
                        <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--text-muted,#666)" }}>{inv.employeeName} · {inv.position || "—"}</p>
                        <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--text-muted,#666)" }}>{inv.productionCompany}</p>
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <p style={{ margin: 0, fontWeight: 800, fontSize: 16, color: "var(--accent,#e8b84b)" }}>฿{total.toLocaleString()}</p>
                        <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--text-muted,#666)" }}>{new Date(inv.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</p>
                        <div style={{ display: "flex", gap: 6, marginTop: 6, justifyContent: "flex-end" }}>
                          <button style={{ ...S.btn("ghost"), fontSize: 11, padding: "4px 8px" }} onClick={() => previewInvoice(inv)} disabled={previewing === inv.id}>
                            {previewing === inv.id ? "…" : "Preview"}
                          </button>
                          <button style={{ ...S.btn(isPaid ? "ghost" : "success"), fontSize: 11, padding: "4px 8px" }} onClick={() => setInvoices(p => p.map(i => i.id === inv.id ? { ...i, status: isPaid ? "Pending" : "Paid" } : i))}>
                            {isPaid ? "Mark Pending" : "Mark Paid ✓"}
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
function AdminTopBar({ onLogout, saveErr, setLang, themeStyle, setThemeStyle, themePalette, setThemePalette, companyName }) {
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
        <ThemeSelector themeStyle={themeStyle} setThemeStyle={setThemeStyle} themePalette={themePalette} setThemePalette={setThemePalette} />
        <LangPill setLang={setLang} />
        {saveErr && <span title="Sync error" style={{ fontSize: 10, color: "#f87171", fontWeight: 700, letterSpacing: "0.04em" }}>⚠ SYNC</span>}
        <button
          onClick={onLogout}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", cursor: "pointer", padding: "6px", borderRadius: 6, color: "var(--text-muted,#8a8f9d)" }}
          title="Log out"
        >
          <Icon d={icons.logout} size={18} color="var(--text-muted,#8a8f9d)" />
        </button>
      </div>
    </header>
  );
}

// ─── ADMIN BOTTOM NAV ─────────────────────────────────────────────────────────
function AdminBottomNav({ activePage, setActivePage, unresolvedCount }) {
  const t = useT();
  const navItems = [
    { key: "dashboard", label: t("navDashboard"), icon: icons.film },
    { key: "equipment", label: t("navEquipment"), icon: icons.camera },
    { key: "jobs", label: t("navJobs"), icon: icons.calendar },
    { key: "reports", label: t("navReports"), icon: icons.alert },
    { key: "invoice", label: t("navInvoice"), icon: icons.invoice },
    { key: "settings", label: t("navTeam"), icon: icons.user },
  ];

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
      {navItems.map(n => {
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
  const [user, setUser] = useState(null);
  const [activePage, setActivePage] = useState("dashboard");
  const [equipment, setEquipment] = useState(SAMPLE_EQUIPMENT);
  const [jobs, setJobs] = useState([]);
  const [checkouts, setCheckouts] = useState([]);
  const [employees, setEmployees] = useState(INITIAL_EMPLOYEES);
  const [reports, setReports] = useState([]);
  const [productionCompanies, setProductionCompanies] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [companyName, setCompanyName] = useState("GEAR DESK");
  const [equipmentRequests, setEquipmentRequests] = useState([]);
  const [adminPin, setAdminPin] = useState("1234");
  const [lineGroupId, setLineGroupId] = useState(null);
  const [lineNotifyMuted, setLineNotifyMuted] = useState(() => { try { return localStorage.getItem("psr_notify_muted") === "1"; } catch { return false; } });
  const [loaded, setLoaded] = useState(false);
  const [saveErr, setSaveErr] = useState(false);
  const [lang, setLang] = useState(() => { try { return localStorage.getItem("psr_lang") || "en"; } catch { return "en"; } });
  const [themeStyle, setThemeStyle] = useState(() => { try { return localStorage.getItem("psr_theme_style") || "glassmorphism"; } catch { return "glassmorphism"; } });
  const [themePalette, setThemePalette] = useState(() => { try { return localStorage.getItem("psr_theme_palette") || "black-yellow"; } catch { return "black-yellow"; } });
  const saveTimer = useRef(null);

  useEffect(() => { try { localStorage.setItem("psr_lang", lang); } catch {} }, [lang]);

  useEffect(() => {
    const id = "psr-theme-style";
    let el = document.getElementById(id);
    if (!el) { el = document.createElement("style"); el.id = id; document.head.appendChild(el); }
    el.textContent = buildThemeCss(themeStyle, themePalette);
    try { localStorage.setItem("psr_theme_style", themeStyle); localStorage.setItem("psr_theme_palette", themePalette); } catch {}
  }, [themeStyle, themePalette]);

  // Load all data from cloud on mount
  useEffect(() => {
    api.getData()
      .then(d => {
        if (d.equipment) setEquipment(d.equipment);
        if (d.jobs) setJobs(d.jobs);
        if (d.checkouts) setCheckouts(d.checkouts);
        if (d.employees) setEmployees(d.employees);
        if (d.reports) setReports(d.reports);
        if (d.productionCompanies) setProductionCompanies(d.productionCompanies);
        if (d.invoices) setInvoices(d.invoices);
        if (d.companyName != null) setCompanyName(d.companyName);
        if (d.equipmentRequests) setEquipmentRequests(d.equipmentRequests);
        if (d.adminPin) setAdminPin(d.adminPin);
        if (d.lineGroupId) setLineGroupId(d.lineGroupId);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  // Save to cloud whenever data changes (debounced 800ms)
  useEffect(() => {
    if (!loaded) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const savePayload = { equipment, jobs, checkouts, employees, reports, productionCompanies, invoices, companyName, equipmentRequests, adminPin };
      if (lineGroupId !== null) savePayload.lineGroupId = lineGroupId;
      api.putData(savePayload)
        .then(() => setSaveErr(false))
        .catch(() => setSaveErr(true));
    }, 800);
  }, [equipment, jobs, checkouts, employees, reports, productionCompanies, invoices, companyName, equipmentRequests, adminPin, loaded]);

  const unresolvedCount = reports.filter(r => r.status === "open").length;

  return (
    <LangCtx.Provider value={lang}>
      {!loaded ? (
        <div style={{ minHeight: "100vh", background: "#0f1117", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16 }}>
          <Icon d={icons.film} size={40} color="#e8b84b" />
          <p style={{ color: "#666", fontSize: 13, letterSpacing: "0.08em" }}>{LANG[lang]?.loading || "LOADING…"}</p>
        </div>
      ) : !user ? (
        <Login onLogin={setUser} employees={employees} companyName={companyName} adminPin={adminPin} />
      ) : user.role === "employee" ? (
        <EmployeeView employee={user} jobs={jobs} equipment={equipment} checkouts={checkouts} setCheckouts={setCheckouts} reports={reports} setReports={setReports} invoices={invoices} setInvoices={setInvoices} productionCompanies={productionCompanies} companyName={companyName} setLang={setLang} onLogout={() => setUser(null)} setEmployees={setEmployees} equipmentRequests={equipmentRequests} setEquipmentRequests={setEquipmentRequests} lineGroupId={lineGroupId} lineNotifyMuted={lineNotifyMuted} />
      ) : (
        <div id="admin-layout" style={S.app}>
          <AdminTopBar
            onLogout={() => setUser(null)}
            saveErr={saveErr}
            setLang={setLang}
            themeStyle={themeStyle}
            setThemeStyle={setThemeStyle}
            themePalette={themePalette}
            setThemePalette={setThemePalette}
            companyName={companyName}
          />
          <main style={{ ...S.main, paddingBottom: 80 }}>
            {activePage === "dashboard" && <DashboardPage jobs={jobs} setJobs={setJobs} equipment={equipment} checkouts={checkouts} setCheckouts={setCheckouts} productionCompanies={productionCompanies} employees={employees} equipmentRequests={equipmentRequests} setEquipmentRequests={setEquipmentRequests} lineGroupId={lineGroupId} lineNotifyMuted={lineNotifyMuted} />}
            {activePage === "equipment" && <EquipmentPage equipment={equipment} setEquipment={setEquipment} jobs={jobs} checkouts={checkouts} />}
            {activePage === "jobs" && <JobsPage jobs={jobs} setJobs={setJobs} equipment={equipment} checkouts={checkouts} productionCompanies={productionCompanies} employees={employees} lineGroupId={lineGroupId} lineNotifyMuted={lineNotifyMuted} />}
            {activePage === "reports" && <AdminReportsPage reports={reports} setReports={setReports} equipment={equipment} />}
            {activePage === "invoice" && <InvoicePage productionCompanies={productionCompanies} setProductionCompanies={setProductionCompanies} invoices={invoices} setInvoices={setInvoices} employees={employees} companyName={companyName} />}
            {activePage === "settings" && <SettingsPage employees={employees} setEmployees={setEmployees} companyName={companyName} setCompanyName={setCompanyName} equipmentRequests={equipmentRequests} setEquipmentRequests={setEquipmentRequests} checkouts={checkouts} setCheckouts={setCheckouts} equipment={equipment} adminPin={adminPin} setAdminPin={setAdminPin} lineGroupId={lineGroupId} setLineGroupId={setLineGroupId} lineNotifyMuted={lineNotifyMuted} setLineNotifyMuted={setLineNotifyMuted} />}
          </main>
          <AdminBottomNav activePage={activePage} setActivePage={setActivePage} unresolvedCount={unresolvedCount} />
        </div>
      )}
    </LangCtx.Provider>
  );
}
