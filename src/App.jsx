import { useState, useEffect, useRef, useCallback, createContext, useContext } from "react";

// ─── CONSTANTS ───────────────────────────────────────────────────────────────
const ADMIN_PIN = "1234";
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
  putProfile: (empId, photo) => fetch(`/api/profile/${empId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ photo }) }),
};

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
};

// ─── UTILITY: Date helpers ───────────────────────────────────────────────────
const today = () => new Date().toISOString().split("T")[0];
const formatDate = (d) => new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const formatDateTime = (ts) => new Date(ts).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

// ─── STYLES ──────────────────────────────────────────────────────────────────
const S = {
  // Layout
  app: { minHeight: "100vh", background: "#0f1117", color: "#e8e4dc", fontFamily: "'Inter', 'SF Pro Display', system-ui, sans-serif", fontSize: 14 },
  topbar: { height: 54, background: "#161920", borderBottom: "1px solid #252830", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px", position: "sticky", top: 0, zIndex: 100 },
  main: { minHeight: "calc(100vh - 54px)", padding: "20px 16px" },
  // Nav (kept for reference, unused)
  logo: { display: "flex", alignItems: "center", gap: 8 },
  logoText: { fontSize: 15, fontWeight: 700, letterSpacing: "0.04em", color: "#e8b84b" },
  logoSub: { fontSize: 10, color: "#666", letterSpacing: "0.12em", textTransform: "uppercase" },
  navItem: (active) => ({ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", cursor: "pointer", color: active ? "#e8b84b" : "#e8e4dc", background: active ? "rgba(232,184,75,0.07)" : "transparent", borderLeft: active ? "3px solid #e8b84b" : "3px solid transparent", fontSize: 14, fontWeight: active ? 700 : 400 }),
  // Cards
  card: { background: "#1a1e27", border: "1px solid #252830", borderRadius: 10, padding: 20 },
  cardGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 },
  // Badges
  badge: (color) => ({ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", ...(color === "green" ? { background: "rgba(52,211,153,0.12)", color: "#34d399" } : color === "amber" ? { background: "rgba(232,184,75,0.12)", color: "#e8b84b" } : color === "red" ? { background: "rgba(239,68,68,0.12)", color: "#f87171" } : color === "blue" ? { background: "rgba(96,165,250,0.12)", color: "#60a5fa" } : color === "gray" ? { background: "rgba(148,163,184,0.1)", color: "#94a3b8" } : {}) }),
  // Form elements
  input: { width: "100%", background: "#0f1117", border: "1px solid #2e3340", borderRadius: 7, padding: "9px 12px", color: "#e8e4dc", fontSize: 13, outline: "none", boxSizing: "border-box" },
  select: { width: "100%", background: "#0f1117", border: "1px solid #2e3340", borderRadius: 7, padding: "9px 12px", color: "#e8e4dc", fontSize: 13, outline: "none", boxSizing: "border-box", cursor: "pointer" },
  label: { display: "block", marginBottom: 5, fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", color: "#8a8f9d", textTransform: "uppercase" },
  // Buttons
  btn: (variant = "primary") => ({
    display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: "pointer", border: "none", transition: "all 0.15s",
    ...(variant === "primary" ? { background: "#e8b84b", color: "#0f1117" } : variant === "ghost" ? { background: "transparent", color: "#8a8f9d", border: "1px solid #2e3340" } : variant === "danger" ? { background: "rgba(239,68,68,0.12)", color: "#f87171", border: "1px solid rgba(239,68,68,0.2)" } : variant === "success" ? { background: "rgba(52,211,153,0.12)", color: "#34d399", border: "1px solid rgba(52,211,153,0.2)" } : {})
  }),
  // Misc
  sectionTitle: { fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#8a8f9d", marginBottom: 16 },
  pageTitle: { fontSize: 22, fontWeight: 700, marginBottom: 4, color: "#e8e4dc" },
  pageSubtitle: { fontSize: 13, color: "#666", marginBottom: 28 },
  divider: { borderTop: "1px solid #252830", margin: "20px 0" },
  row: { display: "flex", alignItems: "center", gap: 12 },
  col: { display: "flex", flexDirection: "column", gap: 12 },
  tag: { display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 11, background: "#252830", color: "#8a8f9d", fontWeight: 500 },
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
      <video ref={videoRef} style={{ width: "100%", borderRadius: 8, marginTop: streaming ? 12 : 0, display: streaming ? "block" : "none" }} />
      {streaming && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          {location && <span style={S.badge("green")}><Icon d={icons.map} size={12} /> GPS: {location.lat}, {location.lng}</span>}
          <button style={S.btn("primary")} onClick={capture}><Icon d={icons.camera} size={16} /> Capture Photo</button>
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
    navTeam: "Team", navReports: "Reports",
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
    // Common
    cancel: "Cancel", save: "Save", logout: "Log Out", back: "Back", loading: "Loading…",
    qty: "Qty",
  },
  th: {
    // Nav
    navDashboard: "ภาพรวม", navEquipment: "อุปกรณ์", navJobs: "งาน",
    navTeam: "ทีม", navReports: "แจ้งปัญหา",
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
function JobsPage({ jobs, setJobs, equipment, checkouts }) {
  const [modal, setModal] = useState(null);
  const [editTarget, setEditTarget] = useState(null);
  const [assignTarget, setAssignTarget] = useState(null);
  const [selectedJob, setSelectedJob] = useState(null);
  const [form, setForm] = useState({ name: "", production: "", dates: [], status: "Pencil", shootTime: "Day", location: "Local (Bangkok)" });
  const [calendarMonth, setCalendarMonth] = useState(() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() }; });
  const [assignForm, setAssignForm] = useState({});

  const openAdd = () => {
    setForm({ name: "", production: "", dates: [], status: "Pencil", shootTime: "Day", location: "Local (Bangkok)" });
    setEditTarget(null);
    setModal("form");
  };

  const openEdit = (job) => {
    setForm({ ...job });
    setEditTarget(job);
    setModal("form");
  };

  const toggleDate = (dateStr) => {
    setForm(p => ({ ...p, dates: p.dates.includes(dateStr) ? p.dates.filter(d => d !== dateStr) : [...p.dates, dateStr].sort() }));
  };

  const saveJob = () => {
    if (!form.name.trim() || form.dates.length === 0) return;
    if (editTarget) {
      setJobs(p => p.map(j => j.id === editTarget.id ? { ...j, ...form } : j));
    } else {
      setJobs(p => [...p, { ...form, id: "job" + Date.now(), assignedEquipment: [] }]);
    }
    setModal(null);
  };

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

  // Calendar renderer
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
                    <span style={S.badge(locationColor[job.location] || "gray")}>{job.location}</span>
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
        <Modal title={editTarget ? "Edit Job" : "New Job"} onClose={() => setModal(null)} wide>
          <div style={S.col}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={{ gridColumn: "1/-1" }}><label style={S.label}>Job Name</label><input style={S.input} value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. TVC Toyota — Hero Film" /></div>
              <div style={{ gridColumn: "1/-1" }}><label style={S.label}>Production Company</label><input style={S.input} value={form.production} onChange={e => setForm(p => ({ ...p, production: e.target.value }))} placeholder="e.g. One More Films" /></div>
              <div>
                <label style={S.label}>Job Status</label>
                <select style={S.select} value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))}>
                  {JOB_STATUSES.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label style={S.label}>Shoot Time</label>
                <select style={S.select} value={form.shootTime} onChange={e => setForm(p => ({ ...p, shootTime: e.target.value }))}>
                  {SHOOT_TIMES.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div style={{ gridColumn: "1/-1" }}>
                <label style={S.label}>Location Type</label>
                <select style={S.select} value={form.location} onChange={e => setForm(p => ({ ...p, location: e.target.value }))}>
                  {LOCATIONS.map(l => <option key={l}>{l}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label style={S.label}>Production Dates (tap to select/deselect)</label>
              {renderCalendar()}
              <button style={{ ...S.btn("ghost"), fontSize: 11, marginTop: 8 }} onClick={() => {
                const next = new Date(calendarMonth.year, calendarMonth.month + 1);
                setCalendarMonth({ year: next.getFullYear(), month: next.getMonth() });
              }}>View next month →</button>
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button style={S.btn("ghost")} onClick={() => setModal(null)}>Cancel</button>
              <button style={S.btn("primary")} onClick={saveJob}>Save Job</button>
            </div>
          </div>
        </Modal>
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
              const maxAvail = (avForEq?.available || 0) + currentQty;
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
          <span style={S.badge("blue")}>{job.location}</span>
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
function DashboardPage({ jobs, equipment, checkouts }) {
  const todayStr = today();
  const todayJobs = jobs.filter(j => j.dates.includes(todayStr));
  const confirmedJobs = jobs.filter(j => j.status === "Confirmed");
  const pencilJobs = jobs.filter(j => j.status === "Pencil");
  const avList = calcAvailable(equipment, jobs, checkouts, todayStr);
  const recentCheckouts = checkouts.slice(-5).reverse();
  const [expandedStat, setExpandedStat] = useState(null); // null | "today" | "confirmed" | "pencil"

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
                    <span style={S.badge(locationColor[j.location] || "gray")}>{j.location}</span>
                  </div>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#e8e4dc", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{j.name}</p>
                  <p style={{ margin: "2px 0 0", fontSize: 11, color: "#666" }}>{j.production} · {j.shootTime}</p>
                  <p style={{ margin: "3px 0 0", fontSize: 11, color: "#8a8f9d" }}>
                    {j.dates.length} day{j.dates.length !== 1 ? "s" : ""}
                    {j.dates[0] ? ` · ${formatDate(j.dates[0])}${j.dates.length > 1 ? " →" : ""}` : ""}
                    {j.dates.length > 1 ? ` ${formatDate(j.dates[j.dates.length - 1])}` : ""}
                  </p>
                </div>
                {(j.assignedEquipment || []).length > 0 && (
                  <span style={{ ...S.badge("blue"), flexShrink: 0 }}>{j.assignedEquipment.length} items</span>
                )}
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
        {recentCheckouts.length === 0
          ? <p style={{ color: "#666", fontSize: 13 }}>No activity recorded yet.</p>
          : recentCheckouts.map((c, i) => {
            const eq = equipment.find(e => e.id === c.eqId);
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, paddingBottom: 10, borderBottom: i < recentCheckouts.length - 1 ? "1px solid #252830" : "none", marginBottom: 10 }}>
                <span style={S.badge(c.type === "pick" || c.type === "checkout" ? "amber" : "green")}>{c.type === "pick" || c.type === "checkout" ? "PICK" : "RETURN"}</span>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: 0, fontSize: 13 }}><strong>{eq?.name || "Unknown"}</strong> ×{c.qty}</p>
                  <p style={{ margin: 0, fontSize: 11, color: "#666" }}>{c.jobName} · {c.employeeName} · {formatDateTime(c.ts)}</p>
                </div>
              </div>
            );
          })}
      </div>
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
function EmployeeView({ employee, jobs, equipment, checkouts, setCheckouts, reports, setReports, setLang, onLogout }) {
  const t = useT();
  const lang = useContext(LangCtx);
  const [tab, setTab] = useState("today"); // today | calendar | profile | report
  const [showReportModal, setShowReportModal] = useState(false);
  const [selectedJob, setSelectedJob] = useState(null);
  const [checkedItems, setCheckedItems] = useState({});
  const [phase, setPhase] = useState("select"); // select | pick | photo_pick | done_pick | return | photo_return | done_return
  const [capturePhoto, setCapturePhoto] = useState(null);
  const [captureLocation, setCaptureLocation] = useState(null);
  const [profilePhoto, setProfilePhoto] = useState(null);
  const profileFileRef = useRef(null);
  const profileSaveTimer = useRef(null);

  const todayStr = today();
  const availableJobs = jobs.filter(j => j.status === "Confirmed" && j.dates.includes(todayStr) && (j.assignedEquipment || []).length > 0);
  const myReports = reports.filter(r => r.reportedBy?.id === employee.id);

  // Load profile photo from cloud
  useEffect(() => {
    api.getProfile(employee.id).then(d => d?.photo && setProfilePhoto(d.photo)).catch(() => {});
  }, [employee.id]);

  // Save profile photo to cloud (debounced)
  useEffect(() => {
    clearTimeout(profileSaveTimer.current);
    profileSaveTimer.current = setTimeout(() => {
      api.putProfile(employee.id, profilePhoto || null).catch(() => {});
    }, 800);
  }, [profilePhoto, employee.id]);

  const handleProfileUpload = (e) => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = (ev) => setProfilePhoto(ev.target.result);
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
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "#666" }}>{selectedJob.production} · {selectedJob.location} · {selectedJob.shootTime}</p>
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

      {/* Tab bar */}
      <div style={{ display: "flex", borderBottom: "1px solid #252830", background: "#161920" }}>
        {[
          { key: "today", label: t("tabToday"), icon: icons.gear },
          { key: "calendar", label: t("tabSchedule"), icon: icons.calendar },
          { key: "profile", label: t("tabProfile"), icon: icons.user },
          { key: "report", label: t("tabReport"), icon: icons.alert },
        ].map(tItem => (
          <button key={tItem.key} onClick={() => setTab(tItem.key)} style={{
            flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "10px 4px 8px",
            background: "transparent", border: "none", borderBottom: tab === tItem.key ? "2px solid #e8b84b" : "2px solid transparent",
            color: tab === tItem.key ? "#e8b84b" : "#666", cursor: "pointer", fontSize: 10, fontWeight: 600, letterSpacing: "0.04em",
          }}>
            <Icon d={tItem.icon} size={16} color={tab === tItem.key ? "#e8b84b" : "#666"} />
            {tItem.label}
          </button>
        ))}
      </div>

      {showReportModal && (
        <ReportModal employee={employee} equipment={equipment} onSubmit={(report) => { setReports(p => [...p, report]); setShowReportModal(false); }} onClose={() => setShowReportModal(false)} />
      )}

      <div style={S.main}>
        {/* TODAY TAB */}
        {tab === "today" && (
          <div style={S.col}>
            <div>
              <h1 style={{ ...S.pageTitle, fontSize: 18, marginBottom: 2 }}>{t("todaysJobs")}</h1>
              <p style={{ ...S.pageSubtitle, marginBottom: 0, fontSize: 12 }}>{new Date().toLocaleDateString(lang === "th" ? "th-TH" : "en-GB", { weekday: "long", day: "2-digit", month: "long" })}</p>
            </div>
            {availableJobs.length === 0 ? (
              <div style={{ ...S.card, textAlign: "center", padding: 40 }}>
                <Icon d={icons.calendar} size={40} color="#2e3340" />
                <p style={{ color: "#666", marginTop: 12 }}>{t("noJobsToday")}</p>
              </div>
            ) : availableJobs.map(job => {
              const { allPicked, allReturned } = getJobCheckoutState(job);
              return (
                <div key={job.id} style={{ ...S.card, cursor: "pointer" }} onClick={() => selectJob(job)}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, justifyContent: "space-between" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
                        {allReturned ? <span style={S.badge("green")}>{t("allReturned")}</span> : allPicked ? <span style={S.badge("amber")}>{t("onShoot")}</span> : <span style={S.badge("blue")}>{t("readyPick")}</span>}
                        <span style={S.badge("gray")}>{job.shootTime}</span>
                      </div>
                      <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{job.name}</h3>
                      <p style={{ margin: "4px 0 0", fontSize: 12, color: "#666" }}>{job.production} · {job.location}</p>
                      <p style={{ margin: "4px 0 0", fontSize: 12, color: "#8a8f9d" }}>{(job.assignedEquipment || []).length} {t("itemsAssigned")}</p>
                    </div>
                    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth={2} strokeLinecap="round"><path d="M9 18l6-6-6-6" /></svg>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* CALENDAR TAB */}
        {tab === "calendar" && (
          <div style={S.col}>
            <div>
              <h1 style={{ ...S.pageTitle, fontSize: 18, marginBottom: 2 }}>{t("jobSchedule")}</h1>
              <p style={{ ...S.pageSubtitle, marginBottom: 0, fontSize: 12 }}>{t("tapJobBar")}</p>
            </div>
            <DashboardCalendar jobs={jobs} equipment={equipment} />
          </div>
        )}

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
                <p style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "#e8e4dc" }}>{employee.name}</p>
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
      </div>
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
function Login({ onLogin, employees }) {
  const [mode, setMode] = useState("choose"); // choose | admin | employee
  const [pin, setPin] = useState("");
  const [selectedEmp, setSelectedEmp] = useState(null);
  const [error, setError] = useState("");

  const tryLogin = () => {
    if (mode === "admin") {
      if (pin === ADMIN_PIN) { onLogin({ role: "admin" }); }
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
        <h1 style={{ fontSize: 24, fontWeight: 800, color: "#e8e4dc", marginBottom: 4 }}>GEAR DESK</h1>
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
        {mode === "employee" && (
          <div style={{ marginBottom: 20 }}>
            <label style={S.label}>Select Employee</label>
            <div style={S.col}>
              {employees.map(e => (
                <div key={e.id} onClick={() => setSelectedEmp(e.id)} style={{ ...S.card, background: selectedEmp === e.id ? "rgba(232,184,75,0.1)" : "#1a1e27", borderColor: selectedEmp === e.id ? "#e8b84b" : "#252830", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, padding: 12 }}>
                  <Icon d={icons.user} size={16} color={selectedEmp === e.id ? "#e8b84b" : "#666"} />
                  <span style={{ fontWeight: 600, color: selectedEmp === e.id ? "#e8b84b" : "#e8e4dc" }}>{e.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div style={{ marginBottom: 16 }}>
          <label style={S.label}>PIN</label>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 16 }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} style={{ width: 18, height: 18, borderRadius: "50%", background: pin[i] ? "#e8b84b" : "#2e3340" }} />
            ))}
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
        <p style={{ fontSize: 11, color: "#444", textAlign: "center", marginTop: 16 }}>Admin PIN: {ADMIN_PIN}</p>
      </div>
    </div>
  );
}

// ─── SETTINGS / EMPLOYEES PAGE ────────────────────────────────────────────────
function SettingsPage({ employees, setEmployees }) {
  const [modal, setModal] = useState(null); // null | "add" | "edit"
  const [editTarget, setEditTarget] = useState(null);
  const [form, setForm] = useState({ name: "", pin: "" });
  const [formErr, setFormErr] = useState("");
  const [showPin, setShowPin] = useState({});

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
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button style={{ ...S.btn("ghost"), padding: "5px 9px" }} onClick={() => openEdit(e)}><Icon d={icons.edit} size={13} /></button>
                <button style={{ ...S.btn("danger"), padding: "5px 9px" }} onClick={() => delEmployee(e.id)}><Icon d={icons.trash} size={13} /></button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={S.card}>
        <p style={S.sectionTitle}>System Info</p>
        <p style={{ fontSize: 13, color: "#666" }}>All data is stored in Cloudflare KV — synced across all devices automatically.</p>
        <p style={{ fontSize: 13, color: "#666", marginTop: 8 }}>Geo-locked photos use the browser's camera API — location metadata is embedded in the image stamp.</p>
        <p style={{ fontSize: 13, color: "#666", marginTop: 8 }}>Admin PIN: <strong style={{ color: "#e8b84b" }}>{ADMIN_PIN}</strong></p>
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
    </div>
  );
}

// ─── TOP NAV DROPDOWN ─────────────────────────────────────────────────────────
function TopNav({ activePage, setActivePage, onLogout, saveErr, unresolvedCount, setLang }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const navItems = [
    { key: "dashboard", label: t("navDashboard"), icon: icons.film },
    { key: "equipment", label: t("navEquipment"), icon: icons.camera },
    { key: "jobs", label: t("navJobs"), icon: icons.calendar },
    { key: "reports", label: t("navReports"), icon: icons.alert, badge: unresolvedCount > 0 ? unresolvedCount : 0 },
    { key: "settings", label: t("navTeam"), icon: icons.user },
  ];

  const active = navItems.find(n => n.key === activePage);

  // Close on outside tap
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => { document.removeEventListener("mousedown", handler); document.removeEventListener("touchstart", handler); };
  }, [open]);

  return (
    <header style={S.topbar}>
      {/* Logo */}
      <div style={S.logo}>
        <Icon d={icons.film} size={20} color="#e8b84b" />
        <div style={S.logoText}>GEAR DESK</div>
      </div>

      {/* Right side: lang toggle + sync indicator + dropdown */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }} ref={ref}>
        <LangPill setLang={setLang} />
        {saveErr && <span title="Sync error — check connection" style={{ fontSize: 10, color: "#f87171", fontWeight: 700, letterSpacing: "0.04em" }}>⚠ SYNC</span>}
        {unresolvedCount > 0 && activePage !== "reports" && (
          <div onClick={() => setActivePage("reports")} style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 20, padding: "3px 8px 3px 6px" }}>
            <Icon d={icons.alert} size={13} color="#f87171" />
            <span style={{ fontSize: 11, fontWeight: 800, color: "#f87171" }}>{unresolvedCount}</span>
          </div>
        )}
        {/* Nav dropdown */}
        <div style={{ position: "relative" }}>
          <button
            onClick={() => setOpen(o => !o)}
            style={{ display: "flex", alignItems: "center", gap: 7, background: open ? "rgba(232,184,75,0.12)" : "#1a1e27", border: "1px solid " + (open ? "#e8b84b" : "#2e3340"), borderRadius: 8, padding: "7px 12px", color: open ? "#e8b84b" : "#e8e4dc", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
          >
            <Icon d={active?.icon || icons.film} size={15} color={open ? "#e8b84b" : "#e8b84b"} />
            {active?.label}
            <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s", opacity: 0.6 }}>
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>

          {open && (
            <div style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", background: "#1a1e27", border: "1px solid #2e3340", borderRadius: 10, overflow: "hidden", minWidth: 190, boxShadow: "0 8px 32px rgba(0,0,0,0.5)", zIndex: 200 }}>
              {navItems.map((n, i) => (
                <div
                  key={n.key}
                  onClick={() => { setActivePage(n.key); setOpen(false); }}
                  style={{ ...S.navItem(activePage === n.key), borderLeft: "none", borderBottom: i < navItems.length - 1 ? "1px solid #252830" : "none", padding: "13px 16px" }}
                >
                  <Icon d={n.icon} size={16} color={activePage === n.key ? "#e8b84b" : "#8a8f9d"} />
                  {n.label}
                  {n.badge > 0 && <span style={{ marginLeft: 4, background: "#f87171", color: "#fff", fontSize: 10, fontWeight: 800, borderRadius: 10, padding: "1px 6px", minWidth: 18, textAlign: "center" }}>{n.badge}</span>}
                  {activePage === n.key && <span style={{ marginLeft: "auto", color: "#e8b84b", fontSize: 10 }}>✦</span>}
                </div>
              ))}
              <div style={{ borderTop: "1px solid #252830", padding: "10px 16px" }}>
                <button style={{ ...S.btn("ghost"), width: "100%", justifyContent: "center", fontSize: 12, padding: "8px" }} onClick={() => { setOpen(false); onLogout(); }}>
                  <Icon d={icons.logout} size={13} /> Log Out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
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
  const [loaded, setLoaded] = useState(false);
  const [saveErr, setSaveErr] = useState(false);
  const [lang, setLang] = useState(() => { try { return localStorage.getItem("psr_lang") || "en"; } catch { return "en"; } });
  const saveTimer = useRef(null);

  useEffect(() => { try { localStorage.setItem("psr_lang", lang); } catch {} }, [lang]);

  // Load all data from cloud on mount
  useEffect(() => {
    api.getData()
      .then(d => {
        if (d.equipment) setEquipment(d.equipment);
        if (d.jobs) setJobs(d.jobs);
        if (d.checkouts) setCheckouts(d.checkouts);
        if (d.employees) setEmployees(d.employees);
        if (d.reports) setReports(d.reports);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  // Save to cloud whenever data changes (debounced 800ms)
  useEffect(() => {
    if (!loaded) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      api.putData({ equipment, jobs, checkouts, employees, reports })
        .then(() => setSaveErr(false))
        .catch(() => setSaveErr(true));
    }, 800);
  }, [equipment, jobs, checkouts, employees, reports, loaded]);

  const unresolvedCount = reports.filter(r => r.status === "open").length;

  return (
    <LangCtx.Provider value={lang}>
      {!loaded ? (
        <div style={{ minHeight: "100vh", background: "#0f1117", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16 }}>
          <Icon d={icons.film} size={40} color="#e8b84b" />
          <p style={{ color: "#666", fontSize: 13, letterSpacing: "0.08em" }}>{LANG[lang]?.loading || "LOADING…"}</p>
        </div>
      ) : !user ? (
        <Login onLogin={setUser} employees={employees} />
      ) : user.role === "employee" ? (
        <EmployeeView employee={user} jobs={jobs} equipment={equipment} checkouts={checkouts} setCheckouts={setCheckouts} reports={reports} setReports={setReports} setLang={setLang} onLogout={() => setUser(null)} />
      ) : (
        <div style={S.app}>
          <TopNav activePage={activePage} setActivePage={setActivePage} onLogout={() => setUser(null)} saveErr={saveErr} unresolvedCount={unresolvedCount} setLang={setLang} />
          <main style={S.main}>
            {activePage === "dashboard" && <DashboardPage jobs={jobs} equipment={equipment} checkouts={checkouts} />}
            {activePage === "equipment" && <EquipmentPage equipment={equipment} setEquipment={setEquipment} jobs={jobs} checkouts={checkouts} />}
            {activePage === "jobs" && <JobsPage jobs={jobs} setJobs={setJobs} equipment={equipment} checkouts={checkouts} />}
            {activePage === "reports" && <AdminReportsPage reports={reports} setReports={setReports} equipment={equipment} />}
            {activePage === "settings" && <SettingsPage employees={employees} setEmployees={setEmployees} />}
          </main>
        </div>
      )}
    </LangCtx.Provider>
  );
}
