import { Component, Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { LANG } from "./i18n/index.js";
import { versionsFor, rebasePayload, pendingSave, adoptRemote } from "./logic/sync.js";
import { stillOutList, buildReceiveEvents } from "./logic/availability.js";
import { ToastProvider } from "./components/toast.jsx";
import { setFormatLang } from "./i18n/format.js";
import { buildSavePayload, dirtyFields, queueProfile, drainProfileQueue } from "./logic/offline.js";
import { api, setActor, actorName, SESSION_KEY, PENDING_KEY, CACHE_KEY, DATA_FIELDS, readCachedTheme, normalizeTheme, writeCache, buildThemeCss, Icon, icons, APP_TZ, setTimePrefs, today, compressImage, S, orderNav, LangCtx, RolesCtx, useT, LangPill } from "./ui/shared.jsx";

// ─── LAZY VIEW CHUNKS (P3-8) ──────────────────────────────────────────────────
// The crew portal, the admin pages, the document views and the settings panel
// are separate chunks: the login screen and the shell ship in the main bundle,
// a crew session never downloads the admin pages and vice versa. A chunk that
// fails to load (offline, or a deploy replaced the hashed files under an open
// tab) lands in ViewBoundary below instead of a blank screen.
const lazyView = (load, name) => lazy(() => load().then(m => { if (!m || !m[name]) throw new Error("view chunk missing " + name); return { default: m[name] }; }));
const EmployeeView = lazyView(() => import("./views/crew.jsx"), "EmployeeView");
const DashboardPage = lazyView(() => import("./views/admin.jsx"), "DashboardPage");
const EquipmentPage = lazyView(() => import("./views/admin.jsx"), "EquipmentPage");
const JobsPage = lazyView(() => import("./views/admin.jsx"), "JobsPage");
const TeamPage = lazyView(() => import("./views/admin.jsx"), "TeamPage");
const AdminCheckoutPage = lazyView(() => import("./views/admin.jsx"), "AdminCheckoutPage");
const ReportsPage = lazyView(() => import("./views/admin.jsx"), "ReportsPage");
const InvoicePage = lazyView(() => import("./views/invoice.jsx"), "InvoicePage");
const SettingsPage = lazyView(() => import("./views/settings.jsx"), "SettingsPage");
// Warm the admin chunks once the shell is up (idle time), so the first click on
// a page and the offline path never wait on the network.
// While it runs, window.__psrPrefetching tells the vite:preloadError hook in
// main.jsx that a failure is a warm-up miss, not a user action (no reload).
const prefetchAdminViews = () => {
  const go = () => {
    window.__psrPrefetching = true;
    Promise.allSettled([import("./views/admin.jsx"), import("./views/invoice.jsx"), import("./views/settings.jsx")]).finally(() => { window.__psrPrefetching = false; });
  };
  if (typeof requestIdleCallback === "function") requestIdleCallback(go, { timeout: 4000 }); else setTimeout(go, 1500);
};
// `overlay`: the view is a full-screen panel (Settings), so its fallback and
// its failure card cover the screen the way the panel would, instead of landing
// below the page content where nobody looks.
const OVERLAY = { position: "fixed", inset: 0, zIndex: 60, background: "var(--bg,#F4F7FB)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 };
function ViewLoading({ overlay }) {
  const t = useT();
  const body = <div role="status" style={{ padding: "40px 16px", textAlign: "center", color: "var(--text-muted,#5F7A91)", fontSize: 13 }}>{t("loading")}</div>;
  return overlay ? <div style={OVERLAY}>{body}</div> : body;
}
function ViewLoadFailed({ onReload, overlay }) {
  const t = useT();
  const card = (
    <div role="alert" style={{ margin: 16, padding: 20, maxWidth: 420, background: "var(--surface,#FFFFFF)", border: "1px solid var(--border-color,#D8E1EC)", borderRadius: 12, textAlign: "center" }}>
      <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--text,#16324A)", lineHeight: 1.5 }}>{t("viewLoadFailed")}</p>
      <button onClick={onReload} style={S.btn("primary")}>{t("viewReload")}</button>
    </div>
  );
  return overlay ? <div style={OVERLAY}>{card}</div> : card;
}
// Error boundary around every lazy view: a chunk that cannot be fetched (or a
// render error inside a page) shows a reload card instead of unmounting the app.
class ViewBoundary extends Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err) { try { console.error("view failed to load", err); } catch {} }
  render() { return this.state.failed ? <ViewLoadFailed overlay={this.props.overlay} onReload={() => window.location.reload()} /> : this.props.children; }
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────
// Server-side login (P0-2): the PIN goes to POST /api/login and never touches
// local state after the request; the lockout countdown is the SERVER's 429
// Retry-After, so a reload does not reset it. Crew is the primary action and
// admin a small link (P2-10); registration asks for a contact and this device
// remembers the request so the screen can say "waiting for approval" (P2-8).
// `info` = GET /api/public: { companyName, employees:[{id,name}], staff:[{id,name,role}], ownerName, pendingRegistrations:[{name}] }.
function Login({ onLogin, info, refreshInfo, setLang }) {
  const t = useT();
  const [mode, setMode] = useState("choose"); // choose | admin | employee | register
  // Names + pending registrations can change while this screen is open (an
  // approval on the admin side): refresh whenever the chooser is shown again.
  const firstShow = useRef(true);
  useEffect(() => {
    if (mode !== "choose" || !refreshInfo) return;
    if (firstShow.current) { firstShow.current = false; return; }
    refreshInfo();
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const [pin, setPin] = useState("");
  const [selectedEmp, setSelectedEmp] = useState(null);
  const [selectedStaff, setSelectedStaff] = useState("owner");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ddOpen, setDdOpen] = useState(false);
  const [regForm, setRegForm] = useState({ name: "", contact: "", pin: "", confirm: "" });
  const [regMsg, setRegMsg] = useState(null);
  const [lockUntil, setLockUntil] = useState(0);
  const [lockSecsLeft, setLockSecsLeft] = useState(0);
  const [pendingName, setPendingName] = useState(() => { try { return localStorage.getItem(PENDING_KEY) || ""; } catch { return ""; } });
  const employees = (info && info.employees) || [];
  const staffList = (info && info.staff) || [];
  const companyName = info && info.companyName;

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

  const tryLogin = async () => {
    if (isLocked || busy) return;
    if (!/^\d{4,6}$/.test(pin)) { setError(t("loginPinDigits")); return; }
    const body = mode === "admin" ? { role: "admin", staffId: selectedStaff || "owner", pin } : { role: "employee", empId: selectedEmp, pin };
    if (mode === "employee" && !selectedEmp) return;
    setBusy(true);
    let r;
    try { r = await api.login(body); } catch { r = { status: 0 }; }
    setBusy(false);
    if (r.ok && r.user) { setPin(""); onLogin(r.user); return; }
    setPin("");
    if (r.status === 429) { setLockUntil(Date.now() + Math.max(1, +r.retryAfter || 60) * 1000); setError(""); return; }
    if (r.status === 401) { setError(t("loginIncorrectPin") + (r.attemptsLeft != null && r.attemptsLeft <= 2 ? " " + t("loginAttemptsLeft").replace("{n}", r.attemptsLeft) : "")); return; }
    if (r.status === 500) { setError(r.error || t("loginServerError")); return; }
    setError(t("loginServerError"));
  };

  const addDigit = (d) => { if (!isLocked && pin.length < 6) setPin(p => p + d); setError(""); };
  const del = () => { if (!isLocked) setPin(p => p.slice(0, -1)); };
  const shell = (children, width = 300) => (
    <div style={{ minHeight: "100vh", background: "var(--bg,#F4F7FB)", display: "flex", alignItems: "center", justifyContent: "center", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 14, right: 14 }}><LangPill setLang={setLang} /></div>
      <div style={{ width, maxWidth: "calc(100vw - 32px)" }}>{children}</div>
    </div>
  );

  // Pending-approval state for the name this device registered (P2-8).
  const pendingMatch = pendingName && (info?.pendingRegistrations || []).some(r => (r.name || "").toLowerCase() === pendingName.toLowerCase());
  const approvedMatch = pendingName && !pendingMatch && employees.some(e => (e.name || "").toLowerCase() === pendingName.toLowerCase());
  const clearPending = () => { setPendingName(""); try { localStorage.removeItem(PENDING_KEY); } catch {} };

  if (mode === "choose") return shell(
    <div style={{ textAlign: "center" }}>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}><div style={{ width: 132, height: 132, borderRadius: 20, background: "var(--logo-bg,#16324A)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 16px rgba(22,50,74,0.18)" }}><img src="/logo.png" alt="" style={{ width: 120, height: 120, objectFit: "contain" }} /></div></div>
      <h1 style={{ fontSize: 24, fontWeight: 800, color: "var(--text,#16324A)", marginBottom: 4 }}>{companyName || "GEAR DESK"}</h1>
      <p style={{ color: "var(--text-muted,#5F7A91)", marginBottom: 28, fontSize: 13, letterSpacing: "0.1em", textTransform: "uppercase" }}>{t("loginSystem")}</p>
      {info && info.unreachable && <p style={{ fontSize: 12, color: "#C53030", margin: "0 0 12px" }}>{t("loginServerError")}</p>}
      {(pendingMatch || approvedMatch) && (
        <div style={{ ...S.card, textAlign: "left", marginBottom: 16, padding: "12px 14px", background: approvedMatch ? "rgba(47,133,90,0.08)" : "rgba(var(--accent-rgb,37,99,235),0.06)", border: `1px solid ${approvedMatch ? "rgba(47,133,90,0.35)" : "rgba(var(--accent-rgb,37,99,235),0.25)"}` }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: approvedMatch ? "#2F855A" : "var(--accent,#2563EB)" }}>{approvedMatch ? t("loginApprovedTitle") : t("loginPendingTitle")}</p>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-muted,#5F7A91)", lineHeight: 1.5 }}>{(approvedMatch ? t("loginApprovedBody") : t("loginPendingBody")).replace("{name}", pendingName)}</p>
          <button onClick={clearPending} style={{ background: "none", border: "none", color: "var(--text-muted,#7B8FA3)", fontSize: 11, cursor: "pointer", padding: 0, marginTop: 6, textDecoration: "underline" }}>{t("loginDismiss")}</button>
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <button style={{ ...S.btn("primary"), justifyContent: "center", padding: "16px 24px", fontSize: 16 }} onClick={() => { setMode("employee"); setError(""); }}><Icon d={icons.user} size={17} /> {t("loginCrewBtn")}</button>
        <p style={{ margin: "2px 0 8px", fontSize: 12, color: "var(--text-muted,#5F7A91)" }}>{t("loginPinHint")}</p>
        <button style={{ background: "none", border: "none", color: "var(--text-muted,#5F7A91)", fontSize: 13, cursor: "pointer", textDecoration: "underline", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }} onClick={() => { setMode("admin"); setError(""); setSelectedStaff("owner"); }}><Icon d={icons.lock} size={13} /> {t("loginAdminLink")}</button>
        <button style={{ background: "none", border: "none", color: "var(--text-muted,#7B8FA3)", fontSize: 12, cursor: "pointer", marginTop: 4, textDecoration: "underline" }} onClick={() => { setMode("register"); setRegForm({ name: "", contact: "", pin: "", confirm: "" }); setRegMsg(null); }}>{t("loginRegisterLink")}</button>
      </div>
    </div>, 340);

  if (mode === "register") return shell(
    <div>
      <button style={{ ...S.btn("ghost"), marginBottom: 24, fontSize: 12 }} onClick={() => setMode("choose")}><Icon d={icons.arrow_left} size={14} /> {t("back")}</button>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{t("loginRegisterTitle")}</h2>
      <p style={{ fontSize: 12, color: "var(--text-muted,#7B8FA3)", marginBottom: 20 }}>{t("loginRegisterDesc")}</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <label style={S.label}>{t("loginYourName")}</label>
          <input style={S.input} value={regForm.name} onChange={e => setRegForm(p => ({ ...p, name: e.target.value }))} placeholder={t("loginFullName")} />
        </div>
        <div>
          <label style={S.label}>{t("loginContact")}</label>
          <input style={S.input} value={regForm.contact} onChange={e => setRegForm(p => ({ ...p, contact: e.target.value }))} placeholder="08x-xxx-xxxx / LINE ID" />
          <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--text-muted,#7B8FA3)" }}>{t("loginContactHint")}</p>
        </div>
        <div>
          <label style={S.label}>{t("loginDesiredPin")}</label>
          <input style={S.input} type="password" inputMode="numeric" maxLength={6} value={regForm.pin} onChange={e => setRegForm(p => ({ ...p, pin: e.target.value.replace(/\D/g, "") }))} placeholder="e.g. 5678" />
        </div>
        <div>
          <label style={S.label}>{t("settingsConfirmPin")}</label>
          <input style={S.input} type="password" inputMode="numeric" maxLength={6} value={regForm.confirm} onChange={e => setRegForm(p => ({ ...p, confirm: e.target.value.replace(/\D/g, "") }))} placeholder={t("settingsPinReEnter")} />
        </div>
        {regMsg && <p style={{ fontSize: 12, color: regMsg.ok ? "#2F855A" : "#C53030", margin: 0 }}>{regMsg.text}</p>}
        <button style={{ ...S.btn("primary"), justifyContent: "center", padding: "13px", opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={async () => {
          const name = regForm.name.trim();
          if (!name) { setRegMsg({ ok: false, text: t("loginEnterName") }); return; }
          if (!regForm.contact.trim()) { setRegMsg({ ok: false, text: t("loginEnterContact") }); return; }
          if (!/^\d{4,6}$/.test(regForm.pin)) { setRegMsg({ ok: false, text: t("loginPinDigits") }); return; }
          if (regForm.pin !== regForm.confirm) { setRegMsg({ ok: false, text: t("loginPinMatch") }); return; }
          setBusy(true);
          let r; try { r = await api.register({ name, contact: regForm.contact.trim(), pin: regForm.pin }); } catch { r = { status: 0 }; }
          setBusy(false);
          if (r.ok) {
            setPendingName(name); try { localStorage.setItem(PENDING_KEY, name); } catch {}
            setRegMsg({ ok: true, text: t("loginRequestSent") });
            setRegForm({ name: "", contact: "", pin: "", confirm: "" });
            if (refreshInfo) refreshInfo();
            return;
          }
          if (r.status === 409 && r.pending) { setRegMsg({ ok: false, text: t("loginPendingExists") }); setPendingName(name); try { localStorage.setItem(PENDING_KEY, name); } catch {} return; }
          if (r.status === 409 && r.taken) { setRegMsg({ ok: false, text: t("loginNameTaken") }); return; }
          if (r.status === 429) { setRegMsg({ ok: false, text: t("loginTooManyAttempts") + (r.retryAfter || 60) + t("loginSeconds") }); return; }
          setRegMsg({ ok: false, text: r.error || t("loginServerError") });
        }}>{t("loginSendRequest")}</button>
      </div>
    </div>);

  const dropdown = (items, selectedId, onPick, placeholder) => {
    const sel = items.find(e => e.id === selectedId);
    return (
      <div style={{ marginBottom: 20, position: "relative" }}>
        <label style={S.label}>{mode === "admin" ? t("loginStaffAccount") : t("loginAccount")}</label>
        <button
          onClick={() => setDdOpen(o => !o)}
          style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 14px", background: "var(--surface,#FFFFFF)", border: `1px solid ${ddOpen ? "var(--accent,#2563EB)" : "var(--border-color,#D8E1EC)"}`, borderRadius: 10, color: sel ? "var(--text,#16324A)" : "var(--text-muted,#7B8FA3)", fontSize: 14, fontWeight: sel ? 600 : 400, cursor: "pointer", transition: "border-color .15s" }}>
          <span>{sel ? sel.name : placeholder}</span>
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" style={{ opacity: 0.5, transform: ddOpen ? "rotate(180deg)" : "none", transition: "transform .2s" }}><path d="M6 9l6 6 6-6" /></svg>
        </button>
        {ddOpen && (
          <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: "var(--surface,#FFFFFF)", border: "1px solid var(--border-color,#D8E1EC)", borderRadius: 10, overflow: "hidden", zIndex: 50, boxShadow: "0 8px 24px rgba(22,50,74,0.17)", maxHeight: 280, overflowY: "auto" }}>
            {items.length === 0 && <p style={{ margin: 0, padding: "11px 14px", fontSize: 12, color: "var(--text-muted,#7B8FA3)" }}>{t("loginNoAccounts")}</p>}
            {items.map((e, i) => (
              <div key={e.id} onClick={() => { onPick(e.id); setDdOpen(false); }}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", cursor: "pointer", background: selectedId === e.id ? "rgba(var(--accent-rgb,37,99,235),0.1)" : "transparent", borderTop: i > 0 ? "1px solid var(--divider-color,#D8E1EC)" : "none" }}>
                <div style={{ width: 28, height: 28, borderRadius: "50%", background: selectedId === e.id ? "rgba(var(--accent-rgb,37,99,235),0.15)" : "var(--divider-color,#D8E1EC)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: selectedId === e.id ? "var(--accent,#2563EB)" : "var(--text-muted,#5F7A91)" }}>{(e.name || "?")[0].toUpperCase()}</span>
                </div>
                <span style={{ fontWeight: 600, color: selectedId === e.id ? "var(--accent,#2563EB)" : "var(--text,#16324A)", fontSize: 14 }}>{e.name}</span>
                {e.role && <span style={{ ...S.badge(e.role === "owner" ? "green" : "gray"), marginLeft: "auto" }}>{e.role === "owner" ? t("settingsStaffOwner") : t("settingsStaffCounter")}</span>}
                {selectedId === e.id && !e.role && <svg style={{ marginLeft: "auto" }} width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="var(--accent,#2563EB)" strokeWidth={3} strokeLinecap="round"><path d="M20 6L9 17l-5-5" /></svg>}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };
  const staffItems = [{ id: "owner", name: (info && info.ownerName) || t("loginOwner"), role: "owner" }, ...staffList.filter(s => s.id !== "owner")];

  return shell(
    <div>
      <button style={{ ...S.btn("ghost"), marginBottom: 24, fontSize: 12 }} onClick={() => { setMode("choose"); setPin(""); setError(""); setSelectedEmp(null); }}><Icon d={icons.arrow_left} size={14} /> {t("back")}</button>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{mode === "admin" ? t("loginAdminTitle") : t("loginCrewTitle")}</h2>
      {mode === "employee" && dropdown(employees, selectedEmp, setSelectedEmp, t("loginSelectAccount"))}
      {mode === "admin" && staffList.length > 0 && dropdown(staffItems, selectedStaff, setSelectedStaff, t("loginSelectAccount"))}
      <div style={{ marginBottom: 16 }}>
        <label style={S.label}>PIN</label>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", alignItems: "center", height: 32, marginBottom: 16 }}>
          {pin.length === 0
            ? <span style={{ fontSize: 12, color: "var(--text-muted,#8CA2B5)", letterSpacing: "0.08em", textTransform: "uppercase" }}>{t("loginPinPrompt")}</span>
            : Array.from({ length: pin.length }).map((_, i) => (
                <div key={i} style={{ width: 11, height: 11, borderRadius: "50%", background: "var(--accent,#2563EB)" }} />
              ))
          }
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          {[1,2,3,4,5,6,7,8,9,"","0","⌫"].map((d, i) => (
            <button key={i} style={{ padding: "14px", borderRadius: 8, border: "1px solid var(--border-color,#D8E1EC)", background: d === "" ? "transparent" : "var(--surface,#FFFFFF)", color: "var(--text,#16324A)", fontSize: 18, fontWeight: 600, cursor: d === "" ? "default" : "pointer" }}
              onClick={() => { if (d === "⌫") del(); else if (d !== "") addDigit(String(d)); }}>
              {d}
            </button>
          ))}
        </div>
      </div>
      {isLocked
        ? <p style={{ color: "#C53030", fontSize: 13, textAlign: "center", marginBottom: 12 }}>{t("loginTooManyAttempts")}{lockSecsLeft}{t("loginSeconds")}</p>
        : error && <p style={{ color: "#C53030", fontSize: 13, textAlign: "center", marginBottom: 12 }}>{error}</p>
      }
      <button style={{ ...S.btn("primary"), width: "100%", justifyContent: "center", padding: "12px", opacity: isLocked || busy ? 0.5 : 1 }} onClick={tryLogin} disabled={isLocked || busy || (mode === "employee" && !selectedEmp)}>
        {isLocked ? `${t("loginLocked")} (${lockSecsLeft}${t("loginSeconds")})` : t("loginUnlock")}
      </button>
      {mode === "employee" && <p style={{ margin: "14px 0 0", fontSize: 12, color: "var(--text-muted,#7B8FA3)", textAlign: "center" }}>{t("loginPinHint")}</p>}
    </div>);
}

// ─── ADMIN TOP BAR ────────────────────────────────────────────────────────────
// ─── CHAT WINDOW ─────────────────────────────────────────────────────────────
function ChatWindow({ user, messages, onSend, onClose, isMobile }) {
  const [text, setText] = useState("");
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const myId = user?.id || (user?.role === "admin" ? "admin" : null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages]);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText("");
    inputRef.current?.focus();
  };

  return (
    <div style={{
      position: "fixed",
      bottom: isMobile ? 84 : 24,
      right: isMobile ? 8 : 24,
      width: isMobile ? "calc(100vw - 16px)" : 340,
      height: 460,
      zIndex: 9998,
      background: "rgba(13,15,20,0.97)",
      border: "1px solid rgba(22,50,74,0.1)",
      borderRadius: 16,
      backdropFilter: "blur(24px)",
      WebkitBackdropFilter: "blur(24px)",
      display: "flex",
      flexDirection: "column",
      boxShadow: "0 20px 60px rgba(22,50,74,0.45)",
      overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid rgba(22,50,74,0.07)", flexShrink: 0, gap: 10 }}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#2F855A", flexShrink: 0 }} />
        <span style={{ fontWeight: 700, fontSize: 14, color: "var(--text,#16324A)", flex: 1, letterSpacing: "0.01em" }}>Team Chat</span>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted,#4E6B84)", cursor: "pointer", padding: "4px 6px", borderRadius: 6, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon d={icons.x} size={14} />
        </button>
      </div>

      {/* Message list */}
      <div ref={listRef} style={{ flex: 1, overflowY: "auto", padding: "14px 14px 6px", display: "flex", flexDirection: "column", gap: 12 }}>
        {messages.length === 0 && (
          <div style={{ textAlign: "center", color: "var(--text-muted,#8CA2B5)", fontSize: 12, marginTop: "auto", paddingTop: 60 }}>
            No messages yet. Say hello!
          </div>
        )}
        {messages.map(msg => {
          const isMe = msg.senderId === myId;
          return (
            <div key={msg.id} style={{ display: "flex", gap: 8, alignItems: "flex-end", flexDirection: isMe ? "row-reverse" : "row" }}>
              {!isMe && (
                <div style={{ width: 28, height: 28, borderRadius: "50%", flexShrink: 0, overflow: "hidden", background: "rgba(var(--accent-rgb,37,99,235),0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {msg.senderAvatar
                    ? <img src={msg.senderAvatar} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    : <span style={{ fontSize: 11, fontWeight: 700, color: "var(--accent,#2563EB)" }}>{(msg.senderName || "?")[0].toUpperCase()}</span>
                  }
                </div>
              )}
              <div style={{ maxWidth: "72%" }}>
                {!isMe && <div style={{ fontSize: 10, color: "var(--text-muted,#5F7A91)", marginBottom: 3, marginLeft: 2 }}>{msg.senderName}</div>}
                <div style={{
                  background: isMe ? "rgba(var(--accent-rgb,37,99,235),0.13)" : "rgba(22,50,74,0.06)",
                  border: isMe ? "1px solid rgba(var(--accent-rgb,37,99,235),0.28)" : "1px solid rgba(22,50,74,0.08)",
                  borderRadius: isMe ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                  padding: "8px 12px",
                  fontSize: 13,
                  color: "var(--text,#16324A)",
                  lineHeight: 1.45,
                  wordBreak: "break-word",
                  whiteSpace: "pre-wrap",
                }}>
                  {msg.text}
                </div>
                <div style={{ fontSize: 9, color: "var(--border-color,#D8E1EC)", marginTop: 3, textAlign: isMe ? "right" : "left" }}>
                  {new Date(msg.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Input bar */}
      <div style={{ padding: "10px 12px", borderTop: "1px solid rgba(22,50,74,0.07)", display: "flex", gap: 8, flexShrink: 0, alignItems: "flex-end" }}>
        <input
          ref={inputRef}
          style={{ flex: 1, background: "rgba(22,50,74,0.06)", border: "1px solid rgba(22,50,74,0.1)", borderRadius: 10, padding: "9px 12px", fontSize: 13, color: "var(--text,#16324A)", outline: "none", fontFamily: "inherit" }}
          placeholder="Message the team…"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
        />
        <button
          onClick={handleSend}
          disabled={!text.trim()}
          style={{ background: text.trim() ? "rgba(var(--accent-rgb,37,99,235),0.18)" : "transparent", border: text.trim() ? "1px solid rgba(var(--accent-rgb,37,99,235),0.35)" : "1px solid rgba(22,50,74,0.08)", borderRadius: 10, padding: "9px 11px", cursor: text.trim() ? "pointer" : "default", color: text.trim() ? "var(--accent,#2563EB)" : "var(--border-color,#D8E1EC)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all .15s" }}
        >
          <Icon d={icons.send} size={15} />
        </button>
      </div>
    </div>
  );
}

function AdminTopBar({ onLogout, saveErr, offlineMode, companyName, onOpenSettings, notifItems, chatEnabled, chatUnread, onOpenChat }) {
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
        <Icon d={icons.film} size={20} color="var(--accent,#2563EB)" />
        <div>
          <div style={S.logoText}>{companyName || "GEAR DESK"}</div>
          <div style={{ ...S.logoSub, marginTop: 0 }}>Pick Shoot Return</div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {offlineMode && <span title="Using cached data, reconnecting" style={{ fontSize: 10, color: "var(--accent,#2563EB)", fontWeight: 700, letterSpacing: "0.04em" }}>⚠ OFFLINE</span>}
        {!offlineMode && saveErr && <span title="Sync error, retrying" style={{ fontSize: 10, color: "#C53030", fontWeight: 700, letterSpacing: "0.04em" }}>⚠ SYNC</span>}

        {/* Chat button */}
        {chatEnabled && (
          <button
            onClick={onOpenChat}
            style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", cursor: "pointer", padding: "6px", borderRadius: 6 }}
            title="Team Chat"
          >
            <Icon d={icons.chat} size={18} color={chatUnread > 0 ? "var(--accent,#2563EB)" : "var(--text-muted,#4E6B84)"} />
            {chatUnread > 0 && (
              <div style={{ position: "absolute", top: 4, right: 4, width: 8, height: 8, borderRadius: "50%", background: "#C53030", border: "1.5px solid var(--bg,#F4F7FB)" }} />
            )}
          </button>
        )}

        {/* Notification bell */}
        <div ref={notifRef} style={{ position: "relative" }}>
          <button
            onClick={() => setNotifOpen(o => !o)}
            style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", background: notifOpen ? "rgba(var(--accent-rgb,37,99,235),0.1)" : "transparent", border: "none", cursor: "pointer", padding: "6px", borderRadius: 6 }}
            title={t("notifTitle")}
          >
            <Icon d={icons.bell} size={18} color={notifCount > 0 ? "var(--accent,#2563EB)" : "var(--text-muted,#4E6B84)"} />
            {notifCount > 0 && (
              <div style={{ position: "absolute", top: 4, right: 4, width: 8, height: 8, borderRadius: "50%", background: "#C53030", border: "1.5px solid var(--bg,#F4F7FB)" }} />
            )}
          </button>
          {notifOpen && (
            <div style={{ position: "absolute", right: 0, top: "calc(100% + 8px)", background: "var(--surface,#FFFFFF)", border: "var(--card-border,1px solid #D8E1EC)", borderRadius: 12, boxShadow: "0 8px 32px rgba(22,50,74,0.21)", width: 270, zIndex: 300 }}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--divider-color,#D8E1EC)" }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "var(--text,#16324A)" }}>
                  {t("notifTitle")} {notifCount > 0 && <span style={{ ...{ padding: "1px 7px", borderRadius: 10, fontSize: 11, fontWeight: 700, background: "#C53030", color: "#fff" } }}>{notifCount}</span>}
                </p>
              </div>
              {notifCount === 0 ? (
                <div style={{ padding: "20px 16px", textAlign: "center" }}>
                  <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted,#5F7A91)" }}>{t("notifAllCaughtUp")}</p>
                </div>
              ) : (
                <div>
                  {(notifItems || []).map((item, i) => (
                    <div
                      key={i}
                      onClick={() => { item.onClick(); setNotifOpen(false); }}
                      style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 16px", cursor: "pointer", borderBottom: i < notifItems.length - 1 ? "1px solid var(--divider-color,#D8E1EC)" : "none", background: "transparent" }}
                    >
                      <div style={{ width: 32, height: 32, borderRadius: 8, background: `${item.color}1a`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <Icon d={item.icon} size={15} color={item.color} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--text,#16324A)" }}>{item.label}</p>
                        <p style={{ margin: "2px 0 0", fontSize: 11, color: item.color }}>{item.count} {t("notifItemsAttention")}</p>
                      </div>
                      <Icon d={icons.arrow_left} size={14} color="var(--text-muted,#7B8FA3)" strokeW={2} style={{ transform: "rotate(180deg)" }} />
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
          <Icon d={icons.gear} size={18} color="var(--text-muted,#4E6B84)" />
        </button>

        {/* Logout */}
        <button
          onClick={onLogout}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", cursor: "pointer", padding: "6px", borderRadius: 6 }}
          title="Log out"
        >
          <Icon d={icons.logout} size={18} color="var(--text-muted,#4E6B84)" />
        </button>
      </div>
    </header>
  );
}

// ─── ADMIN SIDEBAR NAV (desktop) ──────────────────────────────────────────────
function AdminSidebarNav({ activePage, setActivePage, unresolvedCount, navOrder, companyName, onOpenSettings, onLogout, saveErr, offlineMode, notifItems }) {
  const t = useT();
  const navItems = [
    { key: "dashboard", label: t("navDashboard"), icon: icons.film },
    { key: "equipment", label: t("navEquipment"), icon: icons.camera },
    { key: "jobs", label: t("navJobs"), icon: icons.calendar },
    { key: "invoice", label: t("navInvoice"), icon: icons.invoice },
    { key: "team", label: t("navTeam"), icon: icons.user },
    { key: "checkout", label: t("navCheckout"), icon: icons.package },
    { key: "reports", label: t("navReports"), icon: icons.chart },
  ];
  const orderedItems = orderNav(navItems, navOrder);
  const notifCount = (notifItems || []).reduce((s, n) => s + n.count, 0);
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef(null);

  useEffect(() => {
    if (!notifOpen) return;
    const h = (e) => { if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false); };
    document.addEventListener("mousedown", h);
    document.addEventListener("touchstart", h);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("touchstart", h); };
  }, [notifOpen]);

  return (
    <nav style={{
      position: "fixed", top: 0, left: 0, bottom: 0, width: 240,
      background: "var(--nav-bg,var(--topbar-bg,#FFFFFF))",
      borderRight: "var(--nav-border,var(--topbar-border,1px solid #D8E1EC))",
      display: "flex", flexDirection: "column",
      zIndex: 100, overflowY: "auto", overflowX: "hidden",
    }}>
      {/* Logo */}
      <div style={{ padding: "20px 20px 16px", borderBottom: "1px solid var(--divider-color,#D8E1EC)", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        <img src="/logo.png" alt="logo" style={{ width: 32, height: 32, objectFit: "contain", borderRadius: 6, background: "var(--logo-bg,#16324A)" }} onError={e => { e.target.style.display = "none"; }} />
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.04em", color: "var(--accent,#2563EB)", lineHeight: 1.2 }}>{companyName || "GEAR DESK"}</div>
          <div style={{ fontSize: 9, color: "var(--text-muted,#5F7A91)", letterSpacing: "0.12em", textTransform: "uppercase", marginTop: 1 }}>Pick Shoot Return</div>
        </div>
      </div>

      {/* Offline/save-err indicator */}
      {(offlineMode || saveErr) && (
        <div style={{ padding: "6px 14px", background: offlineMode ? "rgba(var(--accent-rgb,37,99,235),0.1)" : "rgba(197,48,48,0.08)", borderBottom: "1px solid var(--divider-color,#D8E1EC)" }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: offlineMode ? "var(--accent,#2563EB)" : "#C53030", letterSpacing: "0.04em" }}>
            {offlineMode ? "⚠ OFFLINE" : "⚠ SYNC ERROR"}
          </span>
        </div>
      )}

      {/* Nav items */}
      <div style={{ flex: 1, paddingTop: 8, paddingBottom: 8 }}>
        {orderedItems.map(n => {
          const active = activePage === n.key;
          return (
            <button
              key={n.key}
              onClick={() => setActivePage(n.key)}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 12,
                padding: "11px 20px", border: "none", cursor: "pointer",
                background: active ? "rgba(var(--accent-rgb,37,99,235),0.08)" : "transparent",
                borderLeft: active ? "3px solid var(--accent,#2563EB)" : "3px solid transparent",
                color: active ? "var(--accent,#2563EB)" : "var(--text-muted,#4E6B84)",
                fontSize: 13, fontWeight: active ? 700 : 500, textAlign: "left",
                transition: "all 0.12s", boxSizing: "border-box",
              }}
            >
              <div style={{ position: "relative", flexShrink: 0 }}>
                <Icon d={n.icon} size={18} color={active ? "var(--accent,#2563EB)" : "var(--text-muted,#4E6B84)"} />

              </div>
              <span>{n.label}</span>
            </button>
          );
        })}
      </div>

      {/* Bottom actions */}
      <div style={{ borderTop: "1px solid var(--divider-color,#D8E1EC)", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 2, flexShrink: 0 }}>
        {/* Notifications */}
        <div ref={notifRef} style={{ position: "relative" }}>
          <button
            onClick={() => setNotifOpen(o => !o)}
            style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "10px", border: "none", cursor: "pointer", background: notifOpen ? "rgba(var(--accent-rgb,37,99,235),0.08)" : "transparent", borderRadius: 8, color: notifCount > 0 ? "var(--accent,#2563EB)" : "var(--text-muted,#4E6B84)", fontSize: 13, fontWeight: 500, textAlign: "left" }}
          >
            <div style={{ position: "relative", flexShrink: 0 }}>
              <Icon d={icons.bell} size={18} color={notifCount > 0 ? "var(--accent,#2563EB)" : "var(--text-muted,#4E6B84)"} />
              {notifCount > 0 && <div style={{ position: "absolute", top: -4, right: -4, width: 8, height: 8, borderRadius: "50%", background: "#C53030", border: "1.5px solid var(--nav-bg,#FFFFFF)" }} />}
            </div>
            <span>{t("notifTitle")} {notifCount > 0 && <span style={{ background: "#C53030", color: "#fff", fontSize: 10, fontWeight: 800, borderRadius: 10, padding: "1px 5px" }}>{notifCount}</span>}</span>
          </button>
          {notifOpen && (
            <div style={{ position: "absolute", bottom: "calc(100% + 6px)", left: 0, right: 0, background: "var(--surface,#FFFFFF)", border: "var(--card-border,1px solid #D8E1EC)", borderRadius: 12, boxShadow: "0 8px 32px rgba(22,50,74,0.21)", zIndex: 300, overflow: "hidden" }}>
              <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--divider-color,#D8E1EC)" }}>
                <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "var(--text,#16324A)" }}>{t("notifTitle")}</p>
              </div>
              {notifCount === 0 ? (
                <div style={{ padding: "16px 14px", textAlign: "center" }}>
                  <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted,#5F7A91)" }}>{t("notifAllCaughtUp")}</p>
                </div>
              ) : (
                <div>
                  {(notifItems || []).map((item, i) => (
                    <div key={i} onClick={() => { item.onClick(); setNotifOpen(false); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", cursor: "pointer", borderBottom: i < notifItems.length - 1 ? "1px solid var(--divider-color,#D8E1EC)" : "none" }}>
                      <div style={{ width: 28, height: 28, borderRadius: 7, background: `${item.color}1a`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <Icon d={item.icon} size={13} color={item.color} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: "var(--text,#16324A)" }}>{item.label}</p>
                        <p style={{ margin: "1px 0 0", fontSize: 10, color: item.color }}>{item.count} {t("notifItemsAttention")}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <button
          onClick={onOpenSettings}
          style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "10px", border: "none", cursor: "pointer", background: "transparent", borderRadius: 8, color: "var(--text-muted,#4E6B84)", fontSize: 13, fontWeight: 500, textAlign: "left" }}
        >
          <Icon d={icons.gear} size={18} color="var(--text-muted,#4E6B84)" />
          <span>Settings</span>
        </button>
        <button
          onClick={onLogout}
          style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "10px", border: "none", cursor: "pointer", background: "transparent", borderRadius: 8, color: "var(--text-muted,#4E6B84)", fontSize: 13, fontWeight: 500, textAlign: "left" }}
        >
          <Icon d={icons.logout} size={18} color="var(--text-muted,#4E6B84)" />
          <span>Log out</span>
        </button>
      </div>
    </nav>
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
    { key: "reports", label: t("navReports"), icon: icons.chart },
  ];
  const orderedItems = orderNav(navItems, navOrder);

  return (
    <nav style={{
      position: "fixed", bottom: 0, left: 0, right: 0,
      height: 62,
      background: "var(--nav-bg,var(--topbar-bg,#FFFFFF))",
      borderTop: "var(--nav-border,var(--topbar-border,1px solid #D8E1EC))",
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
              color: active ? "var(--accent,#2563EB)" : "var(--text-muted,#4E6B84)",
              position: "relative", padding: "8px 2px 6px",
            }}
          >
            {active && <div style={{ position: "absolute", top: 0, left: "25%", right: "25%", height: 2, background: "var(--accent,#2563EB)", borderRadius: "0 0 3px 3px" }} />}
            <div style={{ position: "relative" }}>
              <Icon d={n.icon} size={20} color={active ? "var(--accent,#2563EB)" : "var(--text-muted,#4E6B84)"} />

            </div>
            <span style={{ fontSize: 9.5, fontWeight: active ? 700 : 500, letterSpacing: "0.02em" }}>{n.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

// ─── SESSION PRESENCE HELPERS ─────────────────────────────────────────────────
// Resize a profile photo data-URL to a small square thumbnail for chat avatars.
function resizeAvatar(dataUrl, size = 48) {
  return new Promise((resolve) => {
    if (!dataUrl) return resolve(null);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext("2d");
      const min = Math.min(img.width, img.height);
      const sx = (img.width - min) / 2;
      const sy = (img.height - min) / 2;
      ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);
      resolve(canvas.toDataURL("image/jpeg", 0.7));
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

function getDeviceId() {
  const key = "psr_device_id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(key, id);
  }
  return id;
}

function getDeviceLabel() {
  const ua = navigator.userAgent;
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? "Android Phone" : "Android Tablet";
  if (/Mac/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Windows PC";
  return "Browser";
}

// ─── ROOT APP ─────────────────────────────────────────────────────────────────
export default function App() {
  // The signed-in user = the server session (GET /api/me at boot, P0-2). A
  // refresh keeps the httpOnly cookie, so nothing secret lives in the browser;
  // psr_user only caches { role, id, name } for the offline (cache-only) path.
  const [user, setUser] = useState(null);
  const [booted, setBooted] = useState(false); // session check done (login screen may show before data loads)
  const [loginInfo, setLoginInfo] = useState(null); // GET /api/public: names for the login pickers
  const [bootError, setBootError] = useState("");    // a server-side config error (e.g. SESSION_SECRET missing), shown verbatim
  const [staff, setStaff] = useState([]);           // admin accounts, credential-free (P2-6)
  const [calendarToken, setCalendarToken] = useState(null);
  useEffect(() => {
    setActor(user);
    // Never clear the cached session during boot (user is null until /api/me
    // answers): the offline path needs it when the server is unreachable.
    try {
      if (user) localStorage.setItem(SESSION_KEY, JSON.stringify({ role: user.role, id: user.id, name: user.name || "", staffId: user.staffId, staffRole: user.staffRole }));
      else if (booted) localStorage.removeItem(SESSION_KEY);
    } catch {}
  }, [user, booted]);
  // Admin shell up: warm the page chunks in idle time (P3-8), see prefetchAdminViews.
  useEffect(() => { if (user && user.role === "admin") prefetchAdminViews(); }, [user]);
  const [activePage, setActivePage] = useState("dashboard");
  useEffect(() => { try { window.scrollTo(0, 0); } catch {} }, [activePage]); // page titles start visible (P2-15)
  const [eqInitialTab, setEqInitialTab] = useState(null); // opens Equipment page straight to a tab (e.g. reports)
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

  // Browser tab title: "Pick Shoot Return - {company name}" once data is loaded
  useEffect(() => {
    document.title = "Pick Shoot Return" + (loaded && (companyName || "").trim() ? ` - ${companyName.trim()}` : "");
  }, [companyName, loaded]);
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
  setFormatLang(lang); // date helpers follow the UI language in this same render pass (P1-6)
  const [roleList, setRoleList] = useState([]); // house's own crew roles (P3-4 F18), KV `roleList`
  const [theme, setTheme] = useState(readCachedTheme);
  const themeStyle = theme.style, themePalette = theme.palette;
  const setThemeStyle = (style) => setTheme(t => normalizeTheme({ ...t, style }));
  const setThemePalette = (palette) => setTheme(t => normalizeTheme({ ...t, palette }));
  const [navOrder, setNavOrder] = useState(null);
  const [invoicePresets, setInvoicePresets] = useState([]);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  const saveTimer = useRef(null);

  // Chat state
  const [chatEnabled, setChatEnabled] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatUnread, setChatUnread] = useState(0);
  const chatWsRef = useRef(null);
  const chatReconnectTimerRef = useRef(null);
  const chatReconnectDelayRef = useRef(1000);
  const chatMyPhotoRef = useRef(null);
  const chatOpenRef = useRef(false);
  // kvLoadedRef tracks which fields actually came back non-null from KV on the initial load.
  // postLoadSnapRef holds a reference snapshot of state right after load settles.
  // Together they allow the save effect to skip fields that were never loaded (preventing
  // initial defaults from overwriting real KV data when a field comes back null).
  const kvLoadedRef = useRef(new Set());
  const postLoadSnapRef = useRef(null);
  const snapTakenRef = useRef(false);
  // lastSavedRef: per-field reference of the value last persisted to (or loaded
  // from) KV. The save effect only PUTs a field whose reference differs — so a
  // change no longer re-uploads the whole ~multi-MB dataset, and data pulled from
  // another device (applyData) counts as already-saved (kills the save→broadcast
  // echo). Purely a narrowing filter on top of the existing loaded/cloudSynced +
  // kvLoaded/snapshot guards; it can never cause a write, only skip a redundant one.
  const lastSavedRef = useRef({});
  // versionsRef: per-field version the server handed us on the last GET / PUT
  // (P1-13). Every PUT sends them back; a 409 means another device wrote the
  // field first and putSynced() re-GETs, re-applies our delta and retries once.
  const versionsRef = useRef({});
  // Small bottom toast for sync outcomes (merged after a conflict, save too big,
  // delete failed). { key, vars } is resolved through the dictionary at render.
  const [syncToast, setSyncToast] = useState(null);
  const toastTimer = useRef(null);
  const showToast = (kind, key, vars) => {
    setSyncToast({ kind, key, vars: vars || {} });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setSyncToast(null), kind === "error" ? 9000 : 5000);
  };

  // ── Session presence (Durable Objects WebSocket) ──────────────────────────
  const [concurrentSessions, setConcurrentSessions] = useState([]);
  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const reconnectDelayRef = useRef(1000);
  // lastExternalSyncRef: timestamp of the most recent BC/WS data_saved received.
  // onSuccess skips re-broadcasting within a 5s window to prevent echo loops.
  const lastExternalSyncRef = useRef(0);
  const broadcastChannelRef = useRef(null);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // BroadcastChannel: same-browser tab sync. When another tab saves to KV it posts
  // its full snapshot here so we apply it without a network round-trip.
  // Deps [] is intentional — applyData is a stable useCallback and must not be referenced
  // in the dep array because it is declared later in this function (TDZ).
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel("psr-sync");
    broadcastChannelRef.current = ch;
    ch.onmessage = (e) => {
      const { type, snapshot, sourceDeviceId } = e.data || {};
      if (type !== "data_saved" || !snapshot || sourceDeviceId === getDeviceId()) return;
      lastExternalSyncRef.current = Date.now();
      applyData(snapshot);
      writeCache(snapshot);
    };
    return () => { ch.close(); broadcastChannelRef.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Connect WebSocket for session presence when user logs in; disconnect on logout.
  useEffect(() => {
    if (!user) {
      wsRef.current?.close();
      wsRef.current = null;
      clearTimeout(reconnectTimerRef.current);
      setConcurrentSessions([]);
      return;
    }
    const userId = user.id || (user.role === "admin" ? "admin" : null);
    if (!userId) return;
    const deviceId = getDeviceId();
    const label = getDeviceLabel();
    let active = true;

    function connect() {
      if (!active) return;
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${proto}//${window.location.host}/api/session?userId=${encodeURIComponent(userId)}&deviceId=${encodeURIComponent(deviceId)}&label=${encodeURIComponent(label)}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => { reconnectDelayRef.current = 1000; };

      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.type === "concurrent") {
            setConcurrentSessions(data.sessions.filter(s => s.deviceId !== deviceId));
          } else if (data.type === "session_join" && data.deviceId !== deviceId) {
            setConcurrentSessions(p => [...p.filter(s => s.deviceId !== data.deviceId), { deviceId: data.deviceId, label: data.label }]);
          } else if (data.type === "session_leave") {
            setConcurrentSessions(p => p.filter(s => s.deviceId !== data.deviceId));
          } else if (data.type === "data_saved") {
            // Another device of this user just saved — pull fresh data immediately.
            lastExternalSyncRef.current = Date.now();
            api.getData().then(d => {
              applyData(d);
              writeCache(d);
            }).catch(() => {});
          }
        } catch {}
      };

      ws.onerror = () => ws.close();
      ws.onclose = () => {
        if (!active) return;
        reconnectTimerRef.current = setTimeout(() => {
          reconnectDelayRef.current = Math.min(reconnectDelayRef.current * 2, 30000);
          connect();
        }, reconnectDelayRef.current);
      };
    }

    connect();
    return () => {
      active = false;
      wsRef.current?.close();
      wsRef.current = null;
      clearTimeout(reconnectTimerRef.current);
      setConcurrentSessions([]);
    };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep chatOpenRef in sync so the WS message handler can read it without a stale closure.
  useEffect(() => { chatOpenRef.current = chatOpen; if (chatOpen) setChatUnread(0); }, [chatOpen]);

  // When chatEnabled/user changes, fetch and resize the current user's profile photo for chat.
  useEffect(() => {
    chatMyPhotoRef.current = null;
    if (!chatEnabled || !user || user.role === "admin") return;
    api.getProfile(user.id).then(d => {
      if (d?.photo) resizeAvatar(d.photo, 48).then(thumb => { chatMyPhotoRef.current = thumb; });
    }).catch(() => {});
  }, [chatEnabled, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Chat WebSocket — connects to the global ChatDO when chat is enabled and user is logged in.
  useEffect(() => {
    if (!chatEnabled || !user) {
      chatWsRef.current?.close(); chatWsRef.current = null;
      clearTimeout(chatReconnectTimerRef.current);
      setChatMessages([]);
      return;
    }
    const userId = user.id || (user.role === "admin" ? "admin" : null);
    if (!userId) return;
    const userName = user.name || (user.role === "admin" ? "Admin" : "User");
    let active = true;

    function connectChat() {
      if (!active) return;
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${proto}//${window.location.host}/api/chat?userId=${encodeURIComponent(userId)}&name=${encodeURIComponent(userName)}`;
      const ws = new WebSocket(url);
      chatWsRef.current = ws;
      ws.onopen = () => { chatReconnectDelayRef.current = 1000; };
      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.type === "history") {
            setChatMessages(data.messages || []);
          } else if (data.type === "message" && data.message) {
            setChatMessages(prev => {
              if (prev.some(m => m.id === data.message.id)) return prev;
              return [...prev, data.message];
            });
            if (!chatOpenRef.current) setChatUnread(p => p + 1);
          }
        } catch {}
      };
      ws.onerror = () => ws.close();
      ws.onclose = () => {
        if (!active) return;
        chatReconnectTimerRef.current = setTimeout(() => {
          chatReconnectDelayRef.current = Math.min(chatReconnectDelayRef.current * 2, 30000);
          connectChat();
        }, chatReconnectDelayRef.current);
      };
    }
    connectChat();
    return () => {
      active = false;
      chatWsRef.current?.close(); chatWsRef.current = null;
      clearTimeout(chatReconnectTimerRef.current);
    };
  }, [chatEnabled, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const sendChatMessage = useCallback((text) => {
    if (!chatWsRef.current || chatWsRef.current.readyState !== WebSocket.OPEN) return;
    const myId = user?.id || (user?.role === "admin" ? "admin" : null);
    const myName = user?.name || (user?.role === "admin" ? "Admin" : "User");
    const msg = {
      id: typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      senderId: myId,
      senderName: myName,
      senderAvatar: chatMyPhotoRef.current,
      text,
      ts: Date.now(),
    };
    // Optimistic: add immediately to local state.
    setChatMessages(prev => [...prev, msg]);
    // Send to server; DO will broadcast to all OTHER connections.
    chatWsRef.current.send(JSON.stringify({ type: "message", message: msg }));
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { try { localStorage.setItem("psr_lang", lang); } catch {} }, [lang]);

  // Keep the module-level date/time helpers in sync with admin prefs.
  useEffect(() => { setTimePrefs(timezone, timeFormat); }, [timezone, timeFormat]);

  useEffect(() => {
    const id = "psr-theme-style";
    let el = document.getElementById(id);
    if (!el) { el = document.createElement("style"); el.id = id; document.head.appendChild(el); }
    el.textContent = buildThemeCss(themeStyle, themePalette);
    try { localStorage.setItem("psr_theme", JSON.stringify({ style: themeStyle, palette: themePalette })); } catch {}
  }, [themeStyle, themePalette]);
  // Admin dialogs (portaled to body) pick up the palette through body.psr-admin.
  useEffect(() => {
    const on = !!user && user.role === "admin";
    try { document.body.classList.toggle("psr-admin", on); } catch {}
    return () => { try { document.body.classList.remove("psr-admin"); } catch {} };
  }, [user]);

  // Stable data-apply function — used by both the initial load and the offline reconnect loop.
  // setState functions are guaranteed stable so [] deps is correct.
  const applyData = useCallback((d) => {
    const kl = kvLoadedRef.current;
    const ls = lastSavedRef.current;
    // A remote copy never clobbers a field this device has edited but not yet
    // saved (or whose save failed and waits for the retry): the local edits are
    // re-applied on top of the server copy (src/logic/sync.js adoptRemote). The
    // field then still reads dirty against the new base, so the debounced save
    // PUTs the merged value with the fresh version. On the first load nothing
    // has a base yet, so every field takes the server copy.
    const st = latestStateRef.current || {};
    let anyDirty = false;
    const pick = (f) => {
      const server = d[f];
      if (!(f in ls)) return server;
      const v = adoptRemote({ base: ls[f], local: st[f], server });
      if (v !== server) anyDirty = true;
      return v;
    };
    if (d.equipment) { setEquipment(pick("equipment")); kl.add("equipment"); }
    if (d.jobs) { setJobs(pick("jobs")); kl.add("jobs"); }
    if (d.checkouts) { setCheckouts(pick("checkouts")); kl.add("checkouts"); }
    if (d.employees) { setEmployees(pick("employees")); kl.add("employees"); }
    if (d.reports) { setReports(pick("reports")); kl.add("reports"); }
    if (d.productionCompanies) { setProductionCompanies(pick("productionCompanies")); kl.add("productionCompanies"); }
    if (d.invoices) { setInvoices(pick("invoices")); kl.add("invoices"); }
    if (d.companyName != null) { setCompanyName(pick("companyName")); kl.add("companyName"); }
    if (d.equipmentRequests) { setEquipmentRequests(pick("equipmentRequests")); kl.add("equipmentRequests"); }
    if (d.adminRequests) { setAdminRequests(pick("adminRequests")); kl.add("adminRequests"); }
    if (Array.isArray(d.staff)) setStaff(d.staff);
    if (typeof d.calendarToken === "string") setCalendarToken(d.calendarToken);
    if (d.lineGroupId) { setLineGroupId(pick("lineGroupId")); kl.add("lineGroupId"); }
    if (d.timezone) { setTimezone(pick("timezone")); kl.add("timezone"); }
    if (d.timeFormat) { setTimeFormat(pick("timeFormat")); kl.add("timeFormat"); }
    if (d.kpiConfig) { setKpiConfig(pick("kpiConfig")); kl.add("kpiConfig"); }
    if (d.punishments) { setPunishments(pick("punishments")); kl.add("punishments"); }
    if (d.kpiEvents) { setKpiEvents(pick("kpiEvents")); kl.add("kpiEvents"); }
    if (d.photoVerification != null) { setPhotoVerification(pick("photoVerification")); kl.add("photoVerification"); }
    if (d.navOrder) { setNavOrder(pick("navOrder")); kl.add("navOrder"); }
    if (d.verificationConfig != null) {
      setVerificationConfig(pick("verificationConfig")); kl.add("verificationConfig");
    } else if (d.photoVerification != null) {
      // Migrate legacy boolean: true→photo, false→none
      setVerificationConfig({ mode: d.photoVerification ? "photo" : "none" });
      kl.add("verificationConfig");
    }
    if (d.invoicePresets != null) { setInvoicePresets(pick("invoicePresets")); kl.add("invoicePresets"); }
    if (d.chatEnabled != null) { setChatEnabled(pick("chatEnabled")); kl.add("chatEnabled"); }
    if (d.roleList != null) { setRoleList(pick("roleList")); kl.add("roleList"); }
    if (d.theme && typeof d.theme === "object") {
      // Keep KV's own object when it is already valid, so the reference matches
      // lastSavedRef and the loaded theme is not re-uploaded as a "change".
      const th0 = pick("theme");
      const th = normalizeTheme(th0);
      setTheme(th.style === th0.style && th.palette === th0.palette ? th0 : th);
      kl.add("theme");
    }
    // Mark every applied field as already-persisted (same reference now lives in
    // state, or is the base the merged value is dirty against), so the debounced
    // save effect only re-uploads what this device really changed.
    for (const f of DATA_FIELDS) if (d[f] !== undefined && d[f] !== null) ls[f] = d[f];
    if (d._v && typeof d._v === "object") Object.assign(versionsRef.current, d._v);
    // A failed save whose fields all just arrived from the server is superseded:
    // its edits now live in state on top of the fresh copy (dirty -> the debounced
    // save carries them), or were already there (clean -> nothing left to send).
    const pend = pendingSaveRef.current;
    if (pend && pend.payload && Object.keys(pend.payload).every(f => f === "_v" || f === "_invoiceEmployeeId" || d[f] !== undefined)) {
      pendingSaveRef.current = null;
      if (!anyDirty) setSaveErr(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Animate load progress bar — ramps to ~88% while fetching, snaps to 100 on completion.
  useEffect(() => {
    if (loaded) { setLoadProgress(100); return; }
    const iv = setInterval(() => {
      setLoadProgress(p => {
        if (p >= 95) return p;
        return Math.min(95, p + (p < 45 ? 5 : p < 72 ? 2 : p < 88 ? 0.6 : 0.15));
      });
    }, 100);
    return () => clearInterval(iv);
  }, [loaded]);

  // Boot (P0-2). 1) GET /api/me says whether a session cookie is valid.
  // 2) With a session: load the data (up to 3 attempts with back-off) exactly as
  //    before. 3) Without one: fetch the public login info (names only) and show
  //    the Login screen; the data loads right after a successful login.
  // 4) Server unreachable: the cached session + cached data give the read-only
  //    offline mode (cloudSynced stays false so nothing is written).
  // If all fields come back null, we block auto-save and require the admin
  // to explicitly confirm initialization (prevents mistaking a KV outage
  // for a brand-new empty account and overwriting real data).
  const dataLoadStartedRef = useRef(false);
  const showLoginScreen = useCallback(() => {
    setUser(null);
    setBooted(true);
    api.publicInfo().then(setLoginInfo).catch(() => setLoginInfo({ employees: [], staff: [], pendingRegistrations: [], unreachable: true }));
  }, []);
  const loadCloud = useCallback(async () => {
    if (dataLoadStartedRef.current) return;
    dataLoadStartedRef.current = true;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const d = await api.getData();
        applyData(d);
        // Phase 1: write fresh KV data to localStorage cache on every successful load
        writeCache(d);
        if (kvLoadedRef.current.size === 0) {
          // All fields null — show explicit init screen; do NOT set cloudSynced.
          setNeedsInit(true);
        } else {
          setCloudSynced(true);
        }
        setLoaded(true);
        return;
      } catch (e) {
        if (e && (e.status === 401 || e.status === 403)) {
          // The session ended between /api/me and the data load: back to Login.
          dataLoadStartedRef.current = false;
          showLoginScreen();
          return;
        }
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
  }, [applyData, showLoginScreen]);

  useEffect(() => {
    (async () => {
      let me;
      try { me = await api.me(); }
      catch (e) {
        if (e && e.server) { setBootError(e.message || "server error"); setBooted(true); setLoadError(true); setLoaded(true); return; }
        // Server unreachable. A cached session + cached data = offline read-only;
        // no cached session = the hard error screen (nothing to show safely).
        let cachedUser = null;
        try { cachedUser = JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch {}
        if (cachedUser && cachedUser.role) { setUser(cachedUser); setBooted(true); await loadCloud(); return; }
        setBooted(true); setLoadError(true); setLoaded(true);
        return;
      }
      if (me) { setUser(me); setBooted(true); await loadCloud(); }
      else showLoginScreen();
    })();
  }, [loadCloud, showLoginScreen]);

  // Login screen -> session -> data.
  const onLogin = (u) => { setUser(u); loadCloud(); };
  const refreshLoginInfo = () => { api.publicInfo().then(setLoginInfo).catch(() => {}); };
  // Logout clears the cookie server-side, then reloads so every view starts
  // clean (no state from the previous role lingers in memory).
  const onLogout = () => { api.logout().finally(() => { try { localStorage.removeItem(SESSION_KEY); } catch {} window.location.reload(); }); };

  // Capture a reference snapshot of all state right after the initial KV load settles.
  // Runs once when both loaded and cloudSynced first become true (before the save effect below).
  // The snapshot lets the save effect detect user changes via reference inequality.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!loaded || !cloudSynced || snapTakenRef.current) return;
    snapTakenRef.current = true;
    postLoadSnapRef.current = { equipment, jobs, checkouts, employees, reports, productionCompanies, invoices, companyName, equipmentRequests, adminRequests, timezone, timeFormat, kpiConfig, punishments, kpiEvents, photoVerification, navOrder, lineGroupId, verificationConfig, invoicePresets, chatEnabled, theme, roleList };
  }, [loaded, cloudSynced]); // intentionally omits data deps — captures post-load state once

  // Everything the save rules look at, as one object. latestStateRef mirrors it
  // every render so the offline reconnect (an effect with no data deps) can read
  // the current edits instead of a stale closure.
  const dataState = { equipment, jobs, checkouts, employees, reports, productionCompanies, invoices, companyName, equipmentRequests, adminRequests, timezone, timeFormat, kpiConfig, punishments, kpiEvents, photoVerification, navOrder, lineGroupId, verificationConfig, invoicePresets, chatEnabled, theme, roleList };
  const latestStateRef = useRef(dataState);
  latestStateRef.current = dataState;
  const userRef = useRef(user);
  userRef.current = user;
  const saveRules = () => ({ lastSaved: lastSavedRef.current, kvLoaded: kvLoadedRef.current, snapshot: postLoadSnapRef.current, user });
  // Fields edited while offline (shown in the banner; gates the reconnect reload).
  const offlinePending = offlineMode ? dirtyFields(dataState, { lastSaved: lastSavedRef.current, kvLoaded: kvLoadedRef.current, snapshot: null, user }) : [];

  // Profile PUTs made while offline wait here (P1-14) and drain on reconnect, so a
  // crew member's bank details / positions typed on the road are not lost.
  const profileQueueRef = useRef([]);
  const [profileQueueSize, setProfileQueueSize] = useState(0);
  const putProfileQueued = async (empId, profile) => {
    if (!offlineMode) {
      try {
        const res = await api.putProfile(empId, profile);
        if (res.ok) return res;
        return res; // server error: caller shows it
      } catch {
        // network dropped mid-session: fall through to the queue
      }
    }
    profileQueueRef.current = queueProfile(profileQueueRef.current, empId, profile);
    setProfileQueueSize(profileQueueRef.current.length);
    return { ok: true, queued: true };
  };

  // Offline reconnect (P1-14): poll every 20s and on the browser's "online" event.
  // Once the server answers, first drain the queued profile saves, then PUT the
  // dirty delta (edits made from the cached copy; a 409 rebases them onto whatever
  // changed meanwhile), and only when nothing is pending reload the page so every
  // view starts from KV. Nothing typed offline is discarded any more.
  useEffect(() => {
    if (!offlineMode) return;
    let busy = false;
    const tryReconnect = async () => {
      if (busy) return;
      busy = true;
      try {
        const d = await api.getData();
        if (!d || typeof d !== "object") return;
        // (versionsRef is deliberately NOT refreshed here: the PUT below carries the
        // versions the cache was loaded with, so anything another device wrote while
        // this one was offline surfaces as a 409 and is merged, never overwritten.)
        // 1. queued profile saves
        if (profileQueueRef.current.length) {
          profileQueueRef.current = await drainProfileQueue(profileQueueRef.current, (id, prof) => api.putProfile(id, prof));
          setProfileQueueSize(profileQueueRef.current.length);
          if (profileQueueRef.current.length) return; // still failing: try again next tick
        }
        // 2. the dirty delta (the cache never loaded photos, so nothing here can strip one)
        const state = latestStateRef.current;
        const { payload, sent } = buildSavePayload(state, { lastSaved: lastSavedRef.current, kvLoaded: kvLoadedRef.current, snapshot: null, user: userRef.current });
        if (Object.keys(payload).length) {
          const r = await putSynced(payload);
          if (!r.ok) { if (r.status === 413) showToast("error", ...tooBigToast(r)); return; }
          Object.assign(lastSavedRef.current, sent, r.sent || {});
          try { sessionStorage.setItem("psr_offline_synced", String(Object.keys(sent).length)); } catch {}
        }
        // 3. clean: start fresh from KV (the "synced" toast shows after the reload)
        const fresh = await api.getData();
        writeCache(fresh);
        window.location.reload();
      } catch (e) {
        // The server is back but the session ended while we were offline (P0-2):
        // nothing can be sent with this cookie, so go to the Login screen instead
        // of polling an "offline" that never ends. Any other error: still offline.
        if (e && (e.status === 401 || e.status === 403)) { try { localStorage.removeItem(SESSION_KEY); } catch {} window.location.reload(); }
      } finally { busy = false; }
    };
    window.addEventListener("online", tryReconnect);
    const interval = setInterval(tryReconnect, 20000);
    return () => { window.removeEventListener("online", tryReconnect); clearInterval(interval); };
  }, [offlineMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // After the reconnect reload: tell the user their offline edits made it.
  useEffect(() => {
    if (!loaded) return;
    try {
      const n = sessionStorage.getItem("psr_offline_synced");
      if (n) { sessionStorage.removeItem("psr_offline_synced"); showToast("info", "offlineSynced", { n }); }
    } catch {}
  }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // A profile PUT that failed mid-session (network blip, not boot-time offline)
  // is queued too; drain it on "online" and every 20 s until it lands.
  useEffect(() => {
    if (offlineMode || profileQueueSize === 0) return;
    let busy = false;
    const drain = async () => {
      if (busy || !navigator.onLine) return;
      busy = true;
      try {
        profileQueueRef.current = await drainProfileQueue(profileQueueRef.current, (id, prof) => api.putProfile(id, prof));
        setProfileQueueSize(profileQueueRef.current.length);
      } finally { busy = false; }
    };
    window.addEventListener("online", drain);
    const interval = setInterval(drain, 20000);
    drain();
    return () => { window.removeEventListener("online", drain); clearInterval(interval); };
  }, [offlineMode, profileQueueSize]);

  // Save to cloud whenever data changes (debounced 1.5 s).
  // Triple guard: loaded + cloudSynced + the per-field rules in
  // src/logic/offline.js buildSavePayload (loaded-from-KV OR changed-vs-snapshot,
  // AND reference !== lastSaved; employees send only their own invoices).
  const saveDueRef = useRef(false); // a debounced save is scheduled and has not fired yet
  const saveInFlightRef = useRef(null); // promise of the autosave PUT currently on the wire
  const flushedRef = useRef(false); // a keepalive flush went out on pagehide
  useEffect(() => {
    if (!loaded || !cloudSynced) return;
    clearTimeout(saveTimer.current);
    saveDueRef.current = true;
    saveTimer.current = setTimeout(() => {
      saveDueRef.current = false;
      // kvLoaded.size === 0 means admin just initialized a fresh account (needsInit was
      // shown and they clicked Initialize — initializeAccount() populated it manually).
      const { payload: savePayload, sent } = buildSavePayload(dataState, saveRules());
      if (Object.keys(savePayload).length === 0) return;
      // Versions + bases OF THIS ATTEMPT: the retry after a failure must carry
      // these, not the refs a remote sync may have refreshed in the meantime.
      const attempt = pendingSave(savePayload, versionsRef.current, lastSavedRef.current);
      // Phase 1: build a full-state snapshot for the cache (saved on every success)
      const fullSnapshot = dataState;
      const onSuccess = (r) => {
        setSaveErr(false);
        pendingSaveRef.current = null;
        // Advance the per-field last-saved references so these fields aren't re-sent
        // until they change again (this is what makes saves incremental). After a
        // 409 rebase the persisted values are the merged ones (r.sent).
        Object.assign(lastSavedRef.current, sent, (r && r.sent) || {});
        writeCache(fullSnapshot);
        // Broadcast the saved snapshot to other tabs/devices unless we're within
        // the 5s cooldown from an incoming sync (prevents echo loops).
        if (Date.now() - lastExternalSyncRef.current >= 5000) {
          broadcastChannelRef.current?.postMessage({ type: "data_saved", snapshot: { ...fullSnapshot, _v: { ...versionsRef.current } }, sourceDeviceId: getDeviceId() });
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: "data_saved" }));
          }
        }
      };
      const onFail = (err) => {
        setSaveErr(true);
        if (err && err.status === 413) {
          // The value can never fit (or the server refused the number of new
          // records): do not queue it for the blind retry loop, tell the user.
          pendingSaveRef.current = null;
          showToast("error", ...tooBigToast(err));
          return;
        }
        if (err && err.conflict) showToast("error", "syncConflictFailed");
        // Phase 2: remember the failed attempt (payload + its versions + bases) so
        // the retry effect can drain it without bypassing the server's stale check.
        pendingSaveRef.current = attempt;
      };
      // Retry once after 3s before showing the error — absorbs transient network blips
      // and Cloudflare Worker cold starts without alarming the user. 409 is handled
      // inside putSynced (re-GET, rebase, retry); 413 is final.
      const tryPut = () => putSynced(savePayload, attempt).then(r => { if (!r.ok) throw r; return r; });
      // One PUT at a time: the manual "Save" buttons wait for this chain, so an
      // autosave and a manual save never race on the same field versions (409).
      saveInFlightRef.current = tryPut()
        .then(onSuccess)
        .catch((e1) => (e1 && (e1.status === 413 || e1.conflict)) ? onFail(e1)
          : new Promise(r => setTimeout(r, 3000)).then(tryPut)
            .then(onSuccess)
            .catch(onFail))
        .finally(() => { saveInFlightRef.current = null; });
    }, 1500);
  }, [equipment, jobs, checkouts, employees, reports, productionCompanies, invoices, companyName, equipmentRequests, adminRequests, timezone, timeFormat, kpiConfig, punishments, kpiEvents, photoVerification, navOrder, lineGroupId, verificationConfig, invoicePresets, chatEnabled, theme, roleList, loaded, cloudSynced]); // eslint-disable-line react-hooks/exhaustive-deps

  // Leaving the page inside the debounce window (tab closed / app switched right
  // after a tap) used to lose the edit. On pagehide the pending delta is flushed
  // with a keepalive PUT, which the browser completes after the page is gone.
  useEffect(() => {
    const flush = () => {
      if (!saveDueRef.current || !loaded || !cloudSynced || offlineMode || !userRef.current) return;
      const { payload } = buildSavePayload(latestStateRef.current, { lastSaved: lastSavedRef.current, kvLoaded: kvLoadedRef.current, snapshot: postLoadSnapRef.current, user: userRef.current });
      if (Object.keys(payload).length === 0) return;
      const body = { ...payload, _v: versionsFor(payload, versionsRef.current) };
      if (JSON.stringify(body).length > 60000) return; // keepalive bodies are capped at 64 KiB: a photo-sized delta stays on the normal path
      clearTimeout(saveTimer.current);
      saveDueRef.current = false;
      flushedRef.current = true;
      try { api.putData(body, { keepalive: true }).catch(() => {}); } catch {}
    };
    // If the page comes back (app switch, bfcache) after a flush, re-read KV so the
    // versions and bases match what the keepalive PUT wrote.
    const resume = () => {
      if (!flushedRef.current || document.visibilityState === "hidden") return;
      flushedRef.current = false;
      api.getData().then(d => { lastExternalSyncRef.current = Date.now(); applyData(d); writeCache(d); }).catch(() => {});
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    window.addEventListener("pageshow", resume);
    document.addEventListener("visibilitychange", resume);
    return () => { window.removeEventListener("pagehide", flush); window.removeEventListener("beforeunload", flush); window.removeEventListener("pageshow", resume); document.removeEventListener("visibilitychange", resume); };
  }, [loaded, cloudSynced, offlineMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Phase 2: when a save has failed, retry automatically when the browser comes back online
  // or every 30 seconds. This drains without user action and clears the ⚠ SYNC indicator.
  useEffect(() => {
    if (!saveErr) return;
    const retryPending = () => {
      const pend = pendingSaveRef.current;
      if (!pend || !pend.payload || !navigator.onLine) return;
      // The attempt's own versions: a field another device wrote since then 409s
      // and is rebased with the attempt's bases (never overwritten).
      putSynced(pend.payload, pend)
        .then(r => { if (!r.ok) throw r; Object.assign(lastSavedRef.current, r.sent || {}); })
        .then(() => { setSaveErr(false); if (pendingSaveRef.current === pend) pendingSaveRef.current = null; })
        .catch(() => {}); // will retry on next event or interval
    };
    window.addEventListener("online", retryPending);
    const interval = setInterval(retryPending, 30000);
    return () => { window.removeEventListener("online", retryPending); clearInterval(interval); };
  }, [saveErr]);

  // Setters the conflict path needs to drop a merged field back into state.
  const FIELD_SETTERS = { roleList: setRoleList, equipment: setEquipment, jobs: setJobs, employees: setEmployees, reports: setReports, productionCompanies: setProductionCompanies, companyName: setCompanyName, timezone: setTimezone, timeFormat: setTimeFormat, kpiConfig: setKpiConfig, punishments: setPunishments, kpiEvents: setKpiEvents, photoVerification: setPhotoVerification, navOrder: setNavOrder, verificationConfig: setVerificationConfig, invoicePresets: setInvoicePresets, chatEnabled: setChatEnabled, theme: setTheme };

  // PUT with optimistic versions (P1-13). Sends `_v` for the whole-value fields in
  // the payload; on 409 (another device wrote one of them first) it re-GETs, keeps
  // everything the server has, re-applies only what THIS client changed on top
  // (src/logic/sync.js rebase), drops the merged fields into state and retries
  // ONCE. Resolves { ok, sent } (sent = values actually persisted) or
  // { ok:false, status, error, conflict?, field?, bytes? }. Never throws on HTTP
  // errors; network errors reject like before.
  //   attempt: { versions, bases } snapshot of the save attempt (src/logic/sync.js
  //   pendingSave); when omitted the current refs are used.
  // Toast for a 413: the value can never fit (syncTooBig), or a crew payload
  // tried to add more new records than the server allows at once (syncTooMany).
  const tooBigToast = (r) => r && r.error === "too many new records"
    ? ["syncTooMany", { field: r.field || "", n: r.count ?? "?", limit: r.limit ?? "?" }]
    : ["syncTooBig", { field: (r && r.field) || "", mb: r && r.bytes ? (r.bytes / 1048576).toFixed(1) : "?" }];
  const putSynced = async (payload, attempt = null) => {
    const body = { ...payload, _v: (attempt && attempt.versions) || versionsFor(payload, versionsRef.current) };
    let res = await api.putData(body);
    let sent = null;
    if (res.status === 409) {
      const info = await res.json().catch(() => ({}));
      const conflicts = (Array.isArray(info.conflicts) && info.conflicts.length) ? info.conflicts : Object.keys(body._v);
      const fresh = await api.getData();
      const bases = (attempt && attempt.bases) ? { ...lastSavedRef.current, ...attempt.bases } : lastSavedRef.current;
      const { payload: retry, merged } = rebasePayload(body, bases, fresh, conflicts);
      // Adopt the server's copy of every field we were NOT saving (a normal
      // remote sync), then our merged copy of the conflicting ones.
      const others = { ...fresh };
      for (const f of Object.keys(payload)) delete others[f];
      lastExternalSyncRef.current = Date.now();
      applyData(others);
      for (const f of conflicts) {
        if (merged[f] === undefined) continue;
        if (FIELD_SETTERS[f]) FIELD_SETTERS[f](merged[f]);
        lastSavedRef.current[f] = fresh[f]; // base for the next delta until the retry lands
      }
      res = await api.putData(retry);
      if (res.status === 409) return { ok: false, status: 409, conflict: true, error: "stale" };
      if (res.ok) { sent = { ...payload, ...merged }; delete sent._v; delete sent._invoiceEmployeeId; showToast("info", "syncMerged"); }
    }
    if (!res.ok) {
      const info = await res.json().catch(() => ({}));
      if (res.status === 401) showToast("error", "authSessionEnded");
      else if (res.status === 403) showToast("error", "authForbidden");
      return { ok: false, status: res.status, error: info.error || `HTTP ${res.status}`, field: info.field, bytes: info.bytes, count: info.count, limit: info.limit };
    }
    const jr = await res.json().catch(() => ({}));
    if (jr && jr._v) Object.assign(versionsRef.current, jr._v);
    // The server re-numbered a document that collided with another device's
    // (P0-6). Adopt its number locally so the screen and KV agree.
    if (jr && Array.isArray(jr.renumbered) && jr.renumbered.length) {
      const map = new Map(jr.renumbered.map(r => [r.id, r.to]));
      setInvoices(prev => prev.map(i => map.has(i.id) ? { ...i, invoiceNo: map.get(i.id) } : i));
      const first = jr.renumbered[0];
      showToast("info", "docRenumbered", { from: first.from || "?", to: first.to, n: jr.renumbered.length });
    }
    return { ok: true, sent: sent || undefined };
  };

  // Immediate, awaitable save for the "Save" buttons (Settings + checkout completion).
  // Sends only fields changed since the last save/load — so a checkout on a phone no
  // longer re-uploads the whole dataset (equipment, history, …). Returns {ok} or
  // {ok:false,error}. The loaded/cloudSynced guard is unchanged.
  const saveSettingsNow = async () => {
    if (!loaded || !cloudSynced) return { ok: false, error: "Still syncing with the cloud. Wait a moment, then try again." };
    // Take over from the debounced autosave: cancel a pending one and let an
    // in-flight one land first, so the two never PUT the same field versions.
    clearTimeout(saveTimer.current);
    saveDueRef.current = false;
    if (saveInFlightRef.current) { try { await saveInFlightRef.current; } catch {} }
    const ls = lastSavedRef.current;
    // Same rules as the debounced save (src/logic/offline.js): loaded-or-changed
    // guard, employees only their own invoices and only crew-writable fields. A
    // plain "!== lastSaved" scan used to PUT the never-loaded `theme` from a crew
    // session, and the server's role check 403'd the whole save.
    const { payload, sent } = buildSavePayload(dataState, saveRules());
    if (Object.keys(payload).length === 0) return { ok: true }; // nothing changed since last save
    try {
      const res = await putSynced(payload);
      if (!res.ok) {
        setSaveErr(true);
        if (res.status === 413) { const [key, vars] = tooBigToast(res); return { ok: false, error: Object.entries(vars).reduce((txt, [k, v]) => txt.replace(`{${k}}`, String(v)), _tRoot(key)) }; }
        if (res.conflict) return { ok: false, error: _tRoot("syncConflictFailed") };
        return { ok: false, error: `Server error ${res.status}, changes not saved.` };
      }
      Object.assign(ls, sent, res.sent || {});
      setSaveErr(false);
      return { ok: true };
    } catch (e) {
      setSaveErr(true);
      return { ok: false, error: (e && e.message) ? e.message : "Network error. Check your connection and try again." };
    }
  };

  // Explicit account initialization — called when admin clicks "Initialize Account"
  // on the needsInit screen. Writes the current (empty) state to KV, marks every
  // field as loaded, then enables normal auto-save.
  const initializeAccount = async () => {
    const kl = kvLoadedRef.current;
    const payload = {
      equipment, jobs, checkouts, employees, reports, productionCompanies, invoices,
      companyName, equipmentRequests, adminRequests,
      timezone, timeFormat, kpiConfig, punishments, kpiEvents, photoVerification, verificationConfig, invoicePresets, theme,
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
    // Server-side snapshot: the backup endpoint reads full KV (photos included) and
    // profiles directly, storing them per-field so it fits under the 25 MiB per-key
    // limit and never silently succeeds on failure. Only stamp "done" on a real ok.
    api.putBackupAuto().then(res => {
      if (res && res.ok) { try { localStorage.setItem("psr_last_auto_backup", String(Date.now())); } catch {} }
      else autoBackupDoneRef.current = false; // let it retry next session
    }).catch(() => { autoBackupDoneRef.current = false; });
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
  // The ONE "needs action" list (P2-11): overdue gear, gear due back today, admin
  // approvals, crew gear requests, open damage reports. It feeds the bell in the
  // sidebar / top bar and the Dashboard rail shows the same cards, so an item is
  // never listed in one place and missing from the other.
  const stillOutNow = stillOutList({ checkouts, jobs, equipment, equipmentRequests, today: today(), tz: APP_TZ });
  const overdueCount = stillOutNow.filter(i => i.overdue).length;
  const dueTodayCount = stillOutNow.filter(i => i.dueToday && !i.overdue).length;
  const goDashboard = (cardId) => () => { setActivePage("dashboard"); setTimeout(() => document.getElementById(cardId)?.scrollIntoView({ behavior: "smooth", block: "start" }), 120); };
  const openDamageReports = () => { setEqInitialTab("reports"); setActivePage("equipment"); };
  const notifItems = [
    overdueCount > 0 && { key: "overdue", label: _tRoot("notifOverdue"), count: overdueCount, color: "#C53030", icon: icons.alert, onClick: goDashboard("stillout-card") },
    dueTodayCount > 0 && { key: "dueToday", label: _tRoot("notifDueToday"), count: dueTodayCount, color: "var(--accent,#2563EB)", icon: icons.package, onClick: goDashboard("stillout-card") },
    pendingAdminRequests.length > 0 && { key: "approvals", label: _tRoot("notifAdminApprovals"), count: pendingAdminRequests.length, color: "var(--accent,#2563EB)", icon: icons.check, onClick: goDashboard("approvals-card") },
    pendingEquipReqCount > 0 && { key: "gearRequests", label: _tRoot("notifEquipRequests"), count: pendingEquipReqCount, color: "#2563EB", icon: icons.gear, onClick: goDashboard("gear-requests-card") },
    unresolvedCount > 0 && { key: "damage", label: _tRoot("notifDamageReports"), count: unresolvedCount, color: "#C53030", icon: icons.alert, onClick: openDamageReports },
  ].filter(Boolean);

  // Member registration is resolved SERVER-side (P2-8): the requested PIN only
  // ever exists as a hash on the request, so the employee has to be created by
  // /api/approve-member. The response carries the fresh employees +
  // adminRequests arrays and their versions; applyData adopts them as saved.
  const resolveMember = async (req, approve) => {
    const r = await api.approveMember(req.id, approve);
    if (!r.ok) {
      if (r.status === 409) { // already resolved elsewhere: pull the truth
        api.getData().then(d => { applyData(d); writeCache(d); }).catch(() => {});
        return;
      }
      showToast("error", r.status === 401 ? "authSessionEnded" : "approveFailed");
      return;
    }
    applyData({ employees: r.employees, adminRequests: r.adminRequests, _v: r._v });
    notifyOthers();
  };

  const approveAdminRequest = (req) => {
    const by = actorName();
    if (req.type === "member-register") { resolveMember(req, true); return; }
    if (req.type === "production-house") {
      setProductionCompanies(p => [...p, { id: "co" + Date.now(), name: req.name.trim(), address: req.address || "", approvedBy: by }]);
    } else if (req.type === "equipment") {
      setEquipment(p => [...p, { id: "eq" + Date.now(), name: req.name.trim(), category: req.category || "", total: +req.total || 1, photo: req.photo || null, notes: req.notes || "" }]);
    } else if (req.type === "geo-return") {
      // Partial returns (P1-1): the request carries the units coming back + condition + note.
      const qty = Number.isFinite(+req.qty) ? +req.qty : 1;
      setCheckouts(p => [...p, { id: "co" + Date.now() + req.eqId, jobId: req.jobId, requestId: req.requestId || null, jobName: req.jobName, eqId: req.eqId, qty, employeeId: req.employeeId, employeeName: req.employeeName, type: "return", ts: Date.now(), photo: req.photo || null, location: req.returnLocation || null, adminApproved: true, by, condition: req.condition || "ok", ...(req.note ? { note: req.note } : {}) }]);
    }
    setAdminRequests(p => p.map(r => r.id === req.id ? { ...r, status: "approved", resolvedAt: new Date().toISOString(), approvedBy: by } : r));
    notifyRequester(req, "approved");
  };

  const rejectAdminRequest = (req) => {
    if (req.type === "member-register") { resolveMember(req, false); return; }
    setAdminRequests(p => p.map(r => r.id === req.id ? { ...r, status: "rejected", resolvedAt: new Date().toISOString(), approvedBy: actorName() } : r));
    notifyRequester(req, "rejected");
  };

  // Team > Add Member / Reset PIN (P0-2): the PIN goes straight to the server
  // (hashed there), never through the employees array or React state. The
  // server answers with the credential-free list + version, adopted as saved.
  const setEmployeePinAndAdopt = async (id, pin, name) => {
    const r = await api.setEmployeePin(id, pin, name);
    if (!r.ok) return { ok: false, status: r.status, error: r.error };
    if (Array.isArray(r.employees)) { applyData({ employees: r.employees, _v: r._v }); notifyOthers(); }
    return { ok: true, created: !!r.created };
  };

  const isLineLinked = (empId) => (employees || []).some(e => e && e.id === empId && e.lineLinked); // P3-6: GET exposes only the flag
  // Tell the crew member the outcome of a geo-gated return (P1-5): LINE push to the
  // group when one is connected and to the requester's own LINE when linked
  // (P3-6), plus the in-app status on their "Returns waiting for approval" card.
  const notifyRequester = (req, outcome) => {
    if (req.type !== "geo-return" || lineNotifyMuted) return;
    if (!lineGroupId && !isLineLinked(req.employeeId)) return; // nobody to reach
    const ok = outcome === "approved";
    const dist = req.distance == null ? "" : req.distance < 1000 ? ` (${req.distance} m)` : ` (${(req.distance / 1000).toFixed(1)} km)`;
    // Group when connected, plus the requester's own LINE when linked (P3-6, resolved server-side).
    api.notify({ userIds: lineGroupId ? [lineGroupId] : [], employeeIds: req.employeeId ? [req.employeeId] : [], message: `${ok ? "✅" : "❌"} [${_tRoot(ok ? "notifyReturnApproved" : "notifyReturnRejected")}] ${req.employeeName}\n📦 ${req.eqName || req.name || req.eqId}${req.qty > 1 ? ` ×${req.qty}` : ""}\n🎬 ${req.jobName || ""}${dist}\n🔗 https://pickshootreturn.pages.dev` });
  };

  // Tell other tabs / devices to re-GET after a server-side change that did not
  // go through the save effect (restore, clear history, tombstone).
  const notifyOthers = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({ type: "data_saved" }));
  };

  // Dashboard "Receive" on a Not Returned row (P1-11): the admin books the gear back
  // in with the same append-only return write a geo-return approval makes. Closes
  // every open verification lane so the unit really reads as returned. The checkout
  // track may replace this with its own receive UI; the prop contract is
  // onReceive(jobId, eqId, { requestId, qty, lanes, jobName, eqName, employeeId, employeeName }).
  const receiveStillOut = (jobId, eqId, extra = {}) => {
    const eq = equipment.find(e => e.id === eqId);
    const item = (eq && eq.name) || extra.eqName || eqId;
    const qty = Math.max(1, +extra.qty || 1);
    if (!window.confirm(_tRoot("dashReceiveConfirm").replace("{n}", qty).replace("{item}", item).replace("{job}", extra.jobName || jobId || ""))) return;
    const by = actorName();
    const events = buildReceiveEvents({ jobId, requestId: extra.requestId, jobName: extra.jobName, eqId, qty, lanes: extra.lanes, receivedFor: extra.employeeName || null, employeeName: by }).map(ev => ({ ...ev, by }));
    setCheckouts(p => [...p, ...events]);
  };

  const createBackup = async (label) => {
    // Server snapshots full KV (photos + all profiles) into a new dated version,
    // so nothing is uploaded from the client and no single key nears the 25 MiB limit.
    const res = await api.putBackup(label ? { label } : {});
    if (res?.ok) { try { localStorage.setItem("psr_last_backup", new Date().toISOString()); } catch {} }
    return res;
  };

  // Server-side restore (P2-7): the server takes a safety snapshot of the live
  // data, then writes every field / photo / profile of the chosen version with
  // fresh versions. Nothing goes through React state or the debounced save (a
  // stale device can no longer re-save over the restore: it gets a 409 and
  // re-syncs). The page reloads afterwards so every view starts from KV.
  const restoreBackup = async (id) => {
    if (!id) return null;
    const r = await api.restoreBackup(id);
    if (r.status === 401 || r.status === 403) throw new Error(_tRoot(r.status === 401 ? "authSessionEnded" : "authOwnerOnly"));
    if (!r.ok) throw new Error(r.error || `HTTP ${r.status}`);
    notifyOthers();
    return r.savedAt || Date.now();
  };

  // Server-side "Clear pickup/return history" (P0-5): safety backup first, then
  // KV checkouts = [] and every checkout photo key removed. Local state adopts
  // the empty list as already-saved so the save effect does not re-send.
  const clearHistory = async () => {
    const r = await api.clearHistory();
    if (r.status === 401 || r.status === 403) throw new Error(_tRoot(r.status === 401 ? "authSessionEnded" : "authForbidden"));
    if (!r.ok) throw new Error(r.error || `HTTP ${r.status}`);
    const empty = [];
    setCheckouts(empty);
    lastSavedRef.current.checkouts = empty;
    if (r._v) Object.assign(versionsRef.current, r._v);
    notifyOthers();
    return r;
  };

  // Server-side delete for id-merged arrays (P0-5): writes a tombstone so the
  // merge can never bring the record back from a stale device. Returns true when
  // the caller may drop it from local state.
  const deleteRecord = async (field, id) => {
    try {
      const r = await api.deleteRecord(field, id);
      if (!r.ok) throw new Error(r.error || `HTTP ${r.status}`);
      if (r._v) Object.assign(versionsRef.current, r._v);
      notifyOthers();
      return true;
    } catch (e) {
      showToast("error", "deleteFailed");
      return false;
    }
  };

  // Photo storage migration (P0-1): drives POST /api/migrate-photos in batches
  // until nothing is left inline. onProgress(moved, remaining) per batch.
  const migratePhotos = async (onProgress) => {
    let total = 0;
    for (let i = 0; i < 200; i++) {
      const r = await api.migratePhotos(20);
      if (r.status === 401 || r.status === 403) throw new Error(_tRoot(r.status === 401 ? "authSessionEnded" : "authForbidden"));
      if (!r.ok) throw new Error(r.error || `HTTP ${r.status}`);
      total += r.moved || 0;
      if (onProgress) onProgress(total, r.remaining || 0);
      if (!r.remaining) break;
      if (!r.moved && !r.retry) break; // nothing moves any more: stop rather than loop
      // r.retry: a PUT landed mid-batch and the server yielded; the next call continues.
    }
    return total;
  };

  return (
    <LangCtx.Provider value={lang}>
    <RolesCtx.Provider value={roleList}>
    <ToastProvider bottom={isMobile ? 92 : 24}>
      {!booted || (user && !loaded) ? (
        <div style={{ minHeight: "100vh", background: "var(--bg,#F4F7FB)", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 32 }}>
          {/* Logo spins in following the circular-arrow direction of the mark */}
          <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ position: "absolute", width: 260, height: 260, borderRadius: "50%", background: "radial-gradient(circle, rgba(var(--accent-rgb,37,99,235),0.10) 0%, transparent 68%)", animation: "psrGlow 2.4s ease-in-out infinite alternate" }} />
            <img src="/logo.png" alt="Pick Shoot Return" style={{ width: "min(72vw, 320px)", height: "auto", position: "relative", zIndex: 1, background: "var(--logo-bg,#16324A)", borderRadius: 32, animation: "psrSpinIn 0.85s cubic-bezier(0.34,1.56,0.64,1) forwards" }} />
          </div>
          {/* Thin progress bar */}
          <div style={{ width: "min(72vw, 300px)", display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ height: 2, background: "#E3EAF2", borderRadius: 2, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${loadProgress}%`, background: "linear-gradient(90deg, #1D4ED8, var(--accent,#2563EB))", borderRadius: 2, transition: "width 0.15s ease-out", boxShadow: "0 0 8px #2563EB55" }} />
            </div>
            <p style={{ margin: 0, textAlign: "right", fontSize: 10, color: "#8CA2B5", letterSpacing: "0.10em", fontFamily: "monospace" }}>{Math.round(loadProgress)}%</p>
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
        <div style={{ minHeight: "100vh", background: "var(--bg,#F4F7FB)", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16, padding: 32 }}>
          <Icon d={icons.alert} size={40} color="#C53030" />
          <p style={{ color: "#C53030", fontSize: 17, fontWeight: 700, textAlign: "center" }}>{bootError ? "Server configuration error" : "Could Not Connect to Cloud Storage"}</p>
          <p style={{ color: "var(--text-muted,#5F7A91)", fontSize: 13, textAlign: "center", maxWidth: 320, lineHeight: 1.6 }}>
            {bootError
              ? <>{bootError}</>
              : <>The app tried 3 times and could not reach the server. Your data has <strong style={{ color: "var(--accent,#2563EB)" }}>not been changed</strong>. Check your internet connection and try again.</>}
          </p>
          <button onClick={() => window.location.reload()} style={{ marginTop: 8, padding: "12px 28px", background: "var(--accent,#2563EB)", color: "#0e0e08", border: "none", borderRadius: 10, fontWeight: 700, fontSize: 15, cursor: "pointer" }}>Retry</button>
        </div>
      ) : !user ? (
        <Login onLogin={onLogin} info={loginInfo} refreshInfo={refreshLoginInfo} setLang={setLang} />
      ) : needsInit && user?.role === "admin" ? (
        <div style={{ minHeight: "100vh", background: "var(--bg,#F4F7FB)", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16, padding: 32 }}>
          <Icon d={icons.package} size={40} color="var(--text-muted,#5F7A91)" />
          <p style={{ color: "#f0f0dc", fontSize: 17, fontWeight: 700, textAlign: "center" }}>No Data Found in Cloud Storage</p>
          <p style={{ color: "#8a8a68", fontSize: 13, textAlign: "center", maxWidth: 340, lineHeight: 1.6 }}>
            All cloud storage fields came back empty. This is expected for a <strong style={{ color: "var(--accent,#2563EB)" }}>brand-new account</strong>.<br /><br />
            If you <strong style={{ color: "#C53030" }}>previously had data</strong>, this may be a temporary connection issue. Try reloading before clicking Initialize.
          </p>
          <button onClick={() => window.location.reload()} style={{ padding: "10px 24px", background: "transparent", color: "#8a8a68", border: "1px solid #353520", borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>Reload First</button>
          <button onClick={initializeAccount} style={{ padding: "12px 28px", background: "var(--accent,#2563EB)", color: "#0e0e08", border: "none", borderRadius: 10, fontWeight: 700, fontSize: 15, cursor: "pointer" }}>Initialize Fresh Account</button>
          {saveErr && <p style={{ color: "#C53030", fontSize: 12 }}>Save failed. Check your connection and try again.</p>}
        </div>
      ) : user.role === "employee" ? (
        <ViewBoundary><Suspense fallback={<ViewLoading />}>
          <EmployeeView employee={user} jobs={jobs} equipment={equipment} checkouts={checkouts} setCheckouts={setCheckouts} reports={reports} setReports={setReports} invoices={invoices} setInvoices={setInvoices} productionCompanies={productionCompanies} setProductionCompanies={setProductionCompanies} companyName={companyName} setLang={setLang} onLogout={onLogout} calendarToken={calendarToken} employees={employees} equipmentRequests={equipmentRequests} setEquipmentRequests={setEquipmentRequests} adminRequests={adminRequests} setAdminRequests={setAdminRequests} lineGroupId={lineGroupId} lineNotifyMuted={lineNotifyMuted} kpiConfig={kpiConfig} kpiEvents={kpiEvents} punishments={punishments} verificationConfig={verificationConfig} saveNow={saveSettingsNow} offlineMode={offlineMode} offlinePendingCount={offlinePending.length + profileQueueSize} putProfile={putProfileQueued} invoicePresets={invoicePresets} chatEnabled={chatEnabled} chatUnread={chatUnread} onOpenChat={() => setChatOpen(true)} />
        </Suspense></ViewBoundary>
      ) : (
        <div id="admin-layout" style={S.app}>
          {isMobile ? (
            <AdminTopBar
              onLogout={onLogout}
              saveErr={saveErr}
              offlineMode={offlineMode}
              companyName={companyName}
              onOpenSettings={() => setSettingsPanelOpen(true)}
              notifItems={notifItems}
              chatEnabled={chatEnabled}
              chatUnread={chatUnread}
              onOpenChat={() => setChatOpen(true)}
            />
          ) : (
            <AdminSidebarNav
              activePage={activePage}
              setActivePage={setActivePage}
              unresolvedCount={unresolvedCount}
              navOrder={navOrder}
              companyName={companyName}
              onOpenSettings={() => setSettingsPanelOpen(true)}
              onLogout={onLogout}
              saveErr={saveErr}
              offlineMode={offlineMode}
              notifItems={notifItems}
            />
          )}
          {offlineMode && isMobile && (
            <div style={{ background: "rgba(var(--accent-rgb,37,99,235),0.12)", borderBottom: "1px solid rgba(var(--accent-rgb,37,99,235),0.25)", padding: "8px 16px", display: "flex", alignItems: "center", gap: 8 }}>
              <Icon d={icons.alert} size={14} color="var(--accent,#2563EB)" style={{ flexShrink: 0 }} />
              <p style={{ margin: 0, fontSize: 12, color: "var(--accent,#2563EB)", lineHeight: 1.4 }}>
                <strong>{_tRoot("offlineTitle")}</strong> {_tRoot("offlineBody")} {offlinePending.length + profileQueueSize > 0 ? _tRoot("offlinePendingN").replace("{n}", offlinePending.length + profileQueueSize) : _tRoot("offlineClean")}
              </p>
            </div>
          )}
          <main style={{ ...S.main, paddingBottom: isMobile ? 80 : 20, marginLeft: isMobile ? 0 : 240, minHeight: isMobile ? "calc(100vh - 54px)" : "100vh" }}>
            {!isMobile && offlineMode && (
              <div style={{ background: "rgba(var(--accent-rgb,37,99,235),0.12)", border: "1px solid rgba(var(--accent-rgb,37,99,235),0.25)", borderRadius: 8, padding: "8px 14px", display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                <Icon d={icons.alert} size={14} color="var(--accent,#2563EB)" style={{ flexShrink: 0 }} />
                <p style={{ margin: 0, fontSize: 12, color: "var(--accent,#2563EB)", lineHeight: 1.4 }}>
                  <strong>{_tRoot("offlineTitle")}</strong> {_tRoot("offlineBody")} {offlinePending.length + profileQueueSize > 0 ? _tRoot("offlinePendingN").replace("{n}", offlinePending.length + profileQueueSize) : _tRoot("offlineClean")}
                </p>
              </div>
            )}
            <ViewBoundary><Suspense fallback={<ViewLoading />}>
            {activePage === "dashboard" && <DashboardPage jobs={jobs} setJobs={setJobs} equipment={equipment} checkouts={checkouts} setCheckouts={setCheckouts} productionCompanies={productionCompanies} employees={employees} equipmentRequests={equipmentRequests} setEquipmentRequests={setEquipmentRequests} adminRequests={adminRequests} approveAdminRequest={approveAdminRequest} rejectAdminRequest={rejectAdminRequest} pendingAdminCount={pendingAdminRequests.length} lineGroupId={lineGroupId} lineNotifyMuted={lineNotifyMuted} deleteRecord={deleteRecord} reports={reports} onReceive={receiveStillOut} onOpenReports={openDamageReports} />}
            {activePage === "equipment" && <EquipmentPage equipment={equipment} setEquipment={setEquipment} jobs={jobs} checkouts={checkouts} reports={reports} setReports={setReports} equipmentRequests={equipmentRequests} productionCompanies={productionCompanies} initialTab={eqInitialTab} onConsumeInitialTab={() => setEqInitialTab(null)} />}
            {activePage === "jobs" && <JobsPage jobs={jobs} setJobs={setJobs} equipment={equipment} checkouts={checkouts} productionCompanies={productionCompanies} employees={employees} lineGroupId={lineGroupId} lineNotifyMuted={lineNotifyMuted} verificationConfig={verificationConfig} equipmentRequests={equipmentRequests} reports={reports} />}
            {activePage === "invoice" && <InvoicePage productionCompanies={productionCompanies} setProductionCompanies={setProductionCompanies} invoices={invoices} setInvoices={setInvoices} employees={employees} companyName={companyName} user={user} invoicePresets={invoicePresets} setInvoicePresets={setInvoicePresets} jobs={jobs} setJobs={setJobs} adminRequests={adminRequests} saveNow={saveSettingsNow} />}
            {activePage === "team" && <TeamPage employees={employees} setEmployees={setEmployees} setEmployeePin={setEmployeePinAndAdopt} equipmentRequests={equipmentRequests} setEquipmentRequests={setEquipmentRequests} checkouts={checkouts} setCheckouts={setCheckouts} equipment={equipment} kpiConfig={kpiConfig} setKpiConfig={setKpiConfig} kpiEvents={kpiEvents} setKpiEvents={setKpiEvents} punishments={punishments} setPunishments={setPunishments} deleteRecord={deleteRecord} onOpenRequests={goDashboard("gear-requests-card")} />}
            {activePage === "checkout" && <AdminCheckoutPage jobs={jobs} equipment={equipment} checkouts={checkouts} setCheckouts={setCheckouts} verificationConfig={verificationConfig} employees={employees} equipmentRequests={equipmentRequests} reports={reports} />}
            {activePage === "reports" && <ReportsPage equipment={equipment} checkouts={checkouts} jobs={jobs} equipmentRequests={equipmentRequests} productionCompanies={productionCompanies} invoices={invoices} employees={employees} />}
            </Suspense></ViewBoundary>
          </main>
          {isMobile && <AdminBottomNav activePage={activePage} setActivePage={setActivePage} unresolvedCount={unresolvedCount} navOrder={navOrder} />}
          {settingsPanelOpen && <ViewBoundary overlay><Suspense fallback={<ViewLoading overlay />}><SettingsPage companyName={companyName} setCompanyName={setCompanyName} roleList={roleList} setRoleList={setRoleList} user={user} onUserUpdate={setUser} staff={staff} setStaff={setStaff} calendarToken={calendarToken} setCalendarToken={setCalendarToken} lineGroupId={lineGroupId} setLineGroupId={setLineGroupId} lineNotifyMuted={lineNotifyMuted} setLineNotifyMuted={setLineNotifyMuted} createBackup={createBackup} restoreBackup={restoreBackup} clearHistory={clearHistory} migratePhotos={migratePhotos} timezone={timezone} setTimezone={setTimezone} timeFormat={timeFormat} setTimeFormat={setTimeFormat} saveSettingsNow={saveSettingsNow} verificationConfig={verificationConfig} setVerificationConfig={setVerificationConfig} themeStyle={themeStyle} setThemeStyle={setThemeStyle} themePalette={themePalette} setThemePalette={setThemePalette} lang={lang} setLang={setLang} navOrder={navOrder} setNavOrder={setNavOrder} checkoutsCount={checkouts.length} setCheckouts={setCheckouts} invoicePresets={invoicePresets} setInvoicePresets={setInvoicePresets} chatEnabled={chatEnabled} setChatEnabled={setChatEnabled} onClose={() => setSettingsPanelOpen(false)} /></Suspense></ViewBoundary>}
        </div>
      )}
      {/* Global chat window — visible across admin and employee views */}
      {chatEnabled && chatOpen && user && (
        <ChatWindow
          user={user}
          messages={chatMessages}
          onSend={sendChatMessage}
          onClose={() => setChatOpen(false)}
          isMobile={isMobile}
        />
      )}

      {syncToast && (
        <div role="status" style={{
          position: "fixed", bottom: isMobile ? (concurrentSessions.length > 0 && user ? 170 : 90) : (concurrentSessions.length > 0 && user ? 100 : 20),
          left: "50%", transform: "translateX(-50%)", zIndex: 9999,
          background: "var(--surface,#FFFFFF)", color: "var(--text,#16324A)",
          border: `1px solid ${syncToast.kind === "error" ? "#C53030" : "var(--accent,#2563EB)"}`,
          borderLeft: `4px solid ${syncToast.kind === "error" ? "#C53030" : "var(--accent,#2563EB)"}`,
          borderRadius: 12, padding: "10px 14px", maxWidth: 420, width: "calc(100vw - 48px)",
          display: "flex", alignItems: "center", gap: 10, boxShadow: "0 8px 32px rgba(22,50,74,0.17)", fontSize: 13, lineHeight: 1.4,
        }}>
          <span style={{ flex: 1 }}>{Object.entries(syncToast.vars).reduce((txt, [k, v]) => txt.replace(`{${k}}`, String(v)), _tRoot(syncToast.key))}</span>
          <button onClick={() => setSyncToast(null)} style={{ background: "none", border: "none", color: "var(--text-muted,#4E6B84)", cursor: "pointer", padding: "4px 6px", borderRadius: 6, flexShrink: 0, lineHeight: 1 }}>
            <Icon d={icons.x} size={14} />
          </button>
        </div>
      )}

      {concurrentSessions.length > 0 && user && (
        <div style={{
          position: "fixed",
          bottom: isMobile ? 90 : 20,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 9999,
          background: "rgba(15,17,23,0.92)",
          border: "1px solid rgba(251,191,36,0.45)",
          borderRadius: 14,
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          padding: "10px 14px 10px 16px",
          maxWidth: 380,
          width: "calc(100vw - 48px)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          boxShadow: "0 8px 32px rgba(22,50,74,0.17)",
        }}>
          <Icon d={icons.alert} size={20} color="#B7791F" style={{ flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#B7791F", lineHeight: 1.3 }}>
              Another device is active
            </p>
            <p style={{ margin: "3px 0 0", fontSize: 11, color: "#9ca3af", lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {concurrentSessions.map(s => s.label).join(", ")}, edits may conflict
            </p>
          </div>
          <button
            onClick={() => setConcurrentSessions([])}
            style={{ background: "none", border: "none", color: "var(--text-muted,#4E6B84)", cursor: "pointer", padding: "4px 6px", borderRadius: 6, flexShrink: 0, lineHeight: 1 }}
          >
            <Icon d={icons.x} size={14} />
          </button>
        </div>
      )}
    </ToastProvider>
    </RolesCtx.Provider>
    </LangCtx.Provider>
  );
}
