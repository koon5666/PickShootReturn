// Settings panel (P3-8 code split): lazy chunk, opened from the admin shell.
import { useState, useEffect, useRef } from "react";
import { DEFAULT_DAY_START_HOUR, DEFAULT_GEO_THRESHOLD_M } from "../logic/checkoutState.js";
import { parseRoleList, roleListText } from "../logic/positions.js";
import { tCount } from "../i18n/format.js";
import { api, Icon, icons, TIMEZONES, S, orderNav, useT, calendarUrl } from "../ui/shared.jsx";

// ─── SETTINGS PANEL ───────────────────────────────────────────────────────────
export function SettingsPage({ companyName, setCompanyName, roleList, setRoleList, user, onUserUpdate, staff, setStaff, calendarToken, setCalendarToken, lineGroupId, setLineGroupId, lineNotifyMuted, setLineNotifyMuted, createBackup, restoreBackup, clearHistory, migratePhotos, timezone, setTimezone, timeFormat, setTimeFormat, saveSettingsNow, verificationConfig, setVerificationConfig, themeStyle, setThemeStyle, themePalette, setThemePalette, lang, setLang, navOrder, setNavOrder, checkoutsCount, setCheckouts, invoicePresets, setInvoicePresets, chatEnabled, setChatEnabled, onClose }) {
  useEffect(() => { document.body.style.overflow = "hidden"; return () => { document.body.style.overflow = ""; }; }, []);
  const t = useT();
  const [rolesText, setRolesText] = useState(() => roleListText(roleList)); // edited as text, saved as lines (P3-4)
  const [apForm, setApForm] = useState({ oldPin: "", newPin: "", confirmPin: "" });
  const [apMsg, setApMsg] = useState(null);
  const [apBusy, setApBusy] = useState(false);
  const isOwner = !user || (user.staffRole || "owner") === "owner";
  // Staff accounts (P2-6): owner-only management; PINs are set / reset server-side, never displayed.
  const [staffForm, setStaffForm] = useState({ name: "", role: "counter", pin: "", confirm: "" });
  const [staffMsg, setStaffMsg] = useState(null);
  const [staffBusy, setStaffBusy] = useState(false);
  const [staffPinTarget, setStaffPinTarget] = useState(null); // { id, name } being reset
  const [ownerName, setOwnerName] = useState(() => (staff || []).find(x => x.id === "owner")?.name || "");
  useEffect(() => { setOwnerName((staff || []).find(x => x.id === "owner")?.name || ""); }, [staff]);
  const [calBusy, setCalBusy] = useState(false);
  const [lineTest, setLineTest] = useState(null); // null | "sending" | { ok, text }
  const [backupStatus, setBackupStatus] = useState(null);
  const [lastBackupAt, setLastBackupAt] = useState(() => { try { return localStorage.getItem("psr_last_backup"); } catch { return null; } });
  const [saveState, setSaveState] = useState(null);

  const [confirmClear, setConfirmClear] = useState(false);
  const [clearDone, setClearDone] = useState(false);
  const [clearState, setClearState] = useState(null); // null | "working" | { error }

  // Backup versions (P2-7): list from the server, pick one to restore/download.
  const [backups, setBackups] = useState(null);      // null = loading
  const [restoreTarget, setRestoreTarget] = useState(null); // backup id awaiting confirm
  const refreshBackups = () => api.listBackups().then(setBackups).catch(() => setBackups([]));
  useEffect(() => { refreshBackups(); }, []);
  // Photo storage (P0-1): how many photos still sit inline in the field arrays.
  const [photoStatus, setPhotoStatus] = useState(null); // null | { inline, bytes, fields }
  const [migrateState, setMigrateState] = useState(null); // null | { moved, remaining } | { error } | "done"
  const refreshPhotoStatus = () => api.migrateStatus().then(d => {
    if (!d || !d.fields) { setPhotoStatus(null); return; }
    const inline = Object.values(d.fields).reduce((n, f) => n + f.inline, 0);
    const bytes = Object.values(d.fields).reduce((n, f) => n + f.bytes, 0);
    setPhotoStatus({ inline, bytes, fields: d.fields });
  });
  useEffect(() => { refreshPhotoStatus(); }, []);
  const kindLabel = (k) => k === "auto" ? t("backupKindAuto") : k === "safety" ? t("backupKindSafety") : t("backupKindManual");


  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "var(--bg,#F4F7FB)", display: "flex", flexDirection: "column", overflowY: "hidden" }}>
      {/* Panel header */}
      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 12, padding: "13px 16px", background: "var(--bg,#F4F7FB)", borderBottom: "1px solid var(--divider-color,#D8E1EC)" }}>
        <button onClick={onClose} style={{ display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", cursor: "pointer", padding: 6, borderRadius: 6 }}>
          <Icon d={icons.x} size={20} color="var(--text-muted,#4E6B84)" />
        </button>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "var(--text,#16324A)" }}>{t("settingsTitle")}</h1>
      </div>
      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 16px 32px", maxWidth: 600, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>

      {/* Language card */}
      <div style={{ ...S.card, marginBottom: 20 }}>
        <p style={S.sectionTitle}>{t("settingsLanguage")}</p>
        <div style={{ display: "flex", gap: 8 }}>
          {[{ id: "en", label: "EN · English" }, { id: "th", label: "TH · ภาษาไทย" }].map(l => (
            <button key={l.id} onClick={() => setLang(l.id)} style={{ flex: 1, padding: "10px 4px", borderRadius: 8, border: lang === l.id ? "2px solid var(--accent,#2563EB)" : "1px solid var(--border-color,#D8E1EC)", background: lang === l.id ? "rgba(var(--accent-rgb,37,99,235),0.08)" : "transparent", color: lang === l.id ? "var(--accent,#2563EB)" : "var(--text-muted,#5F7A91)", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{l.label}</button>
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
          { key: "reports", label: t("navReports"), icon: icons.chart },
        ];
        const currentOrder = orderNav(baseItems, navOrder);
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
                <button onClick={() => setNavOrder(null)} style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 12, color: "var(--accent,#2563EB)", fontWeight: 600, padding: "4px 0" }}>
                  {t("settingsNavOrderReset")}
                </button>
              )}
            </div>
            <p style={{ ...S.label, marginBottom: 12 }}>{t("settingsNavOrderDesc")}</p>
            {currentOrder.map((item, idx) => (
              <div key={item.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: idx < currentOrder.length - 1 ? "1px solid var(--border-color,#D8E1EC)" : "none" }}>
                <Icon d={item.icon} size={18} color="var(--text-muted,#4E6B84)" />
                <span style={{ flex: 1, fontSize: 14, color: "var(--text,#16324A)", fontWeight: 500 }}>{item.label}</span>
                <button
                  onClick={() => move(idx, -1)}
                  disabled={idx === 0}
                  style={{ background: "transparent", border: "1px solid var(--border-color,#D8E1EC)", borderRadius: 6, padding: "4px 10px", cursor: idx === 0 ? "default" : "pointer", color: idx === 0 ? "var(--text-muted,#8CA2B5)" : "var(--text,#16324A)", fontSize: 13, lineHeight: 1 }}
                >▲</button>
                <button
                  onClick={() => move(idx, 1)}
                  disabled={idx === currentOrder.length - 1}
                  style={{ background: "transparent", border: "1px solid var(--border-color,#D8E1EC)", borderRadius: 6, padding: "4px 10px", cursor: idx === currentOrder.length - 1 ? "default" : "pointer", color: idx === currentOrder.length - 1 ? "var(--text-muted,#8CA2B5)" : "var(--text,#16324A)", fontSize: 13, lineHeight: 1 }}
                >▼</button>
              </div>
            ))}
          </div>
        );
      })()}

      <div style={{ ...S.card, marginBottom: 20 }}>
        <p style={S.sectionTitle}>{t("settingsTheme")}</p>
        <p style={{ margin: "0 0 12px", fontSize: 11, color: "var(--text-muted,#5F7A91)" }}>{t("settingsThemeTenantHint")}</p>
        <div style={{ marginBottom: 14 }}>
          <p style={{ ...S.label, marginBottom: 8 }}>{t("settingsThemeStyle")}</p>
          <div style={{ display: "flex", gap: 6 }}>
            {[{ id: "flat", label: "Flat" }, { id: "neumorphism", label: "Neumorphism" }, { id: "glassmorphism", label: "Glassmorphism" }, { id: "skeuomorphism", label: "Skeuomorphism" }].map(s => (
              <button key={s.id} onClick={() => setThemeStyle(s.id)} style={{ flex: 1, padding: "8px 4px", borderRadius: 8, border: themeStyle === s.id ? "2px solid var(--accent,#2563EB)" : "1px solid var(--border-color,#D8E1EC)", background: themeStyle === s.id ? "rgba(var(--accent-rgb,37,99,235),0.08)" : "transparent", color: themeStyle === s.id ? "var(--accent,#2563EB)" : "var(--text-muted,#5F7A91)", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>{s.label}</button>
            ))}
          </div>
        </div>
        <div>
          <p style={{ ...S.label, marginBottom: 8 }}>{t("settingsThemeColor")}</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 6 }}>
            {[{ id: "black-white", dot: "#e0e0e0", label: "B&W" }, { id: "teal-orange", dot: "#ff6a2a", label: "Teal" }, { id: "black-red", dot: "#dd3333", label: "Red" }, { id: "white-blue", dot: "#1a60d0", label: "Blue" }, { id: "black-yellow", dot: "#e8b84b", label: "Amber" }, { id: "black-blue", dot: "#3a80e8", label: "Navy" }].map(pal => (
              <button key={pal.id} onClick={() => setThemePalette(pal.id)} style={{ padding: "8px 2px", borderRadius: 8, border: themePalette === pal.id ? `2px solid ${pal.dot}` : "1px solid var(--border-color,#D8E1EC)", background: "transparent", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <div style={{ width: 18, height: 18, borderRadius: "50%", background: pal.dot }} />
                <span style={{ fontSize: 9, color: "var(--text-muted,#5F7A91)", fontWeight: 600, textTransform: "uppercase" }}>{pal.label}</span>
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
            <span style={{ fontSize: 11, color: "var(--text-muted,#5F7A91)", flexShrink: 0 }}>{t("settingsUsesDefault")}</span>
          )}
        </div>
        <p style={{ fontSize: 11, color: "var(--text-muted,#5F7A91)", marginTop: 6 }}>{t("settingsCompanyHint")}</p>
      </div>

      {/* Crew roles (P3-4 F18): the house's own list replaces the built-in departments everywhere. */}
      <div style={{ ...S.card, marginBottom: 20 }} data-testid="settings-roles">
        <p style={S.sectionTitle}>{t("settingsRoles")}</p>
        <p style={{ fontSize: 12, color: "var(--text-muted,#5F7A91)", margin: "0 0 8px", lineHeight: 1.6 }}>{t("settingsRolesHint")}</p>
        <textarea
          style={{ ...S.input, height: 140, resize: "vertical", lineHeight: 1.6 }}
          data-testid="roles-input"
          value={rolesText}
          onChange={e => setRolesText(e.target.value)}
          onBlur={() => setRoleList(parseRoleList(rolesText).map(r => `${r.en}${r.th && r.th !== r.en ? " / " + r.th : ""}${r.dept ? " | " + r.dept : ""}`))}
          placeholder={"Gaffer / \u0e2b\u0e31\u0e27\u0e2b\u0e19\u0e49\u0e32\u0e44\u0e1f | Lighting\n1st AC | Camera\nDriver"}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: "var(--text-muted,#5F7A91)" }} data-testid="roles-count">{parseRoleList(rolesText).length ? tCount(t, "countRoles", parseRoleList(rolesText).length) : t("settingsRolesDefault")}</span>
          {parseRoleList(rolesText).length > 0 && (
            <button style={{ ...S.btn("ghost"), padding: "4px 10px", fontSize: 11 }} onClick={() => { setRolesText(""); setRoleList([]); }}>{t("settingsRolesReset")}</button>
          )}
        </div>
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
            <p style={{ fontSize: 11, color: "var(--text-muted,#5F7A91)", marginTop: 6 }}>{t("settingsTimezoneHint")}</p>
          </div>
          <div>
            <label style={S.label}>{t("settingsTimeFormat")}</label>
            <div style={{ display: "flex", gap: 8 }}>
              {[{ v: "24", l: "24-hour (21:00)" }, { v: "12", l: "12-hour (9:00 PM)" }].map(o => (
                <button key={o.v} onClick={() => setTimeFormat(o.v)} style={{ ...S.btn(timeFormat === o.v ? "primary" : "ghost"), flex: 1, justifyContent: "center" }}>{o.l}</button>
              ))}
            </div>
            <p style={{ fontSize: 11, color: "var(--text-muted,#5F7A91)", marginTop: 6 }}>{t("settingsTimeFormatHint")}</p>
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
              <div key={id} onClick={() => setVerificationConfig(v => ({ ...(v || {}), mode: id }))}
                style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "10px 14px", borderRadius: 8,
                  background: active ? "rgba(var(--accent-rgb,37,99,235),0.07)" : "rgba(22,50,74,0.04)",
                  border: `1px solid ${active ? "rgba(var(--accent-rgb,37,99,235),0.35)" : "var(--divider-color,#D8E1EC)"}`,
                  cursor: "pointer", userSelect: "none" }}>
                <div style={{ width: 18, height: 18, borderRadius: "50%", flexShrink: 0, marginTop: 1,
                  background: active ? "var(--accent,#2563EB)" : "transparent",
                  border: `2px solid ${active ? "var(--accent,#2563EB)" : "var(--text-muted,#7B8FA3)"}`,
                  display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {active && <div style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--surface2,#EAF0F7)" }} />}
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: active ? "var(--accent,#2563EB)" : "var(--text,#16324A)" }}>{t(labelKey)}</p>
                  <p style={{ margin: "3px 0 0", fontSize: 11, color: "var(--text-muted,#5F7A91)", lineHeight: 1.5 }}>{t(descKey)}</p>
                </div>
              </div>
            );
          })}
        </div>
        {/* Production day + geo gate tuning (P1-2 / P1-5) */}
        {(() => {
          const vc = verificationConfig || {};
          const patch = (x) => setVerificationConfig(v => ({ ...(v || {}), ...x }));
          const hb = vc.homeBase;
          return (
            <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 14 }}>
              <div>
                <label style={S.label}>{t("settingsDayStart")}</label>
                <select value={vc.dayStartHour ?? DEFAULT_DAY_START_HOUR} onChange={e => patch({ dayStartHour: +e.target.value })} style={S.select} data-testid="day-start">
                  {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
                </select>
                <p style={{ fontSize: 11, color: "var(--text-muted,#5F7A91)", marginTop: 6, lineHeight: 1.5 }}>{t("settingsDayStartHint")}</p>
              </div>
              <div>
                <label style={S.label}>{t("settingsGeoRadius")}</label>
                <input type="number" min={10} step={10} value={vc.geoThresholdM ?? DEFAULT_GEO_THRESHOLD_M} onChange={e => patch({ geoThresholdM: Math.max(10, +e.target.value || DEFAULT_GEO_THRESHOLD_M) })} style={S.input} data-testid="geo-radius" />
                <p style={{ fontSize: 11, color: "var(--text-muted,#5F7A91)", marginTop: 6, lineHeight: 1.5 }}>{t("settingsGeoRadiusHint")}</p>
              </div>
              <div>
                <label style={S.label}>{t("settingsHomeBase")}</label>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12, color: hb ? "var(--text,#16324A)" : "var(--text-muted,#7B8FA3)", fontVariantNumeric: "tabular-nums" }} data-testid="home-base">{hb ? `${hb.lat}, ${hb.lng}` : t("settingsHomeBaseUnset")}</span>
                  <button style={{ ...S.btn("ghost"), padding: "5px 10px", fontSize: 11 }} onClick={() => {
                    if (!navigator.geolocation) return;
                    navigator.geolocation.getCurrentPosition(pos => patch({ homeBase: { lat: +pos.coords.latitude.toFixed(5), lng: +pos.coords.longitude.toFixed(5), acc: Math.round(pos.coords.accuracy) } }), () => {}, { enableHighAccuracy: true, timeout: 10000 });
                  }}><Icon d={icons.map} size={12} /> {t("settingsUseMyLocation")}</button>
                  {hb && <button style={{ ...S.btn("ghost"), padding: "5px 10px", fontSize: 11 }} onClick={() => patch({ homeBase: null })}>{t("settingsHomeBaseClear")}</button>}
                </div>
                <p style={{ fontSize: 11, color: "var(--text-muted,#5F7A91)", marginTop: 6, lineHeight: 1.5 }}>{t("settingsHomeBaseHint")}</p>
              </div>
            </div>
          );
        })()}
      </div>

      <div style={{ ...S.card, marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: 1 }}>
            <p style={{ ...S.sectionTitle, margin: 0 }}>{t("settingsClearHistory")}</p>
            <p style={{ fontSize: 11, color: "var(--text-muted,#5F7A91)", margin: "6px 0 0", lineHeight: 1.6 }}>{t("settingsClearHistoryDesc")}</p>
            {checkoutsCount > 0 && <p style={{ fontSize: 11, color: "var(--text-muted,#7B8FA3)", margin: "4px 0 0" }}>{t("settingsClearHistoryCount").replace("{n}", checkoutsCount)}</p>}
          </div>
          <div style={{ flexShrink: 0 }}>
            {clearDone ? (
              <span style={{ fontSize: 13, color: "#2F855A", fontWeight: 600 }}>{t("settingsClearHistoryDone")} {t("settingsClearHistorySafety")}</span>
            ) : confirmClear ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
                <p style={{ margin: 0, fontSize: 12, color: "#C53030", maxWidth: 240, textAlign: "right", lineHeight: 1.5 }}>{t("settingsClearHistoryConfirm")}</p>
                <div style={{ display: "flex", gap: 8 }}>
                  <button style={{ ...S.btn("ghost"), fontSize: 12, padding: "6px 12px" }} onClick={() => setConfirmClear(false)}>Cancel</button>
                  <button style={{ ...S.btn("danger"), fontSize: 12, padding: "6px 12px", opacity: clearState === "working" ? 0.6 : 1 }} disabled={clearState === "working"} onClick={async () => {
                    // Server-side: safety backup first, then KV checkouts = [] (P0-5).
                    setClearState("working");
                    try {
                      await clearHistory();
                      setClearState(null); setConfirmClear(false); setClearDone(true);
                      refreshBackups();
                      setTimeout(() => setClearDone(false), 4000);
                    } catch (e) { setClearState({ error: (e && e.message) || t("settingsClearHistoryFailed") }); }
                  }}>
                    {clearState === "working" ? t("settingsClearHistoryWorking") : t("settingsClearHistoryYes")}
                  </button>
                </div>
                {clearState && clearState.error && <p style={{ margin: 0, fontSize: 12, color: "#C53030", maxWidth: 240, textAlign: "right" }}>{clearState.error}</p>}
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
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, padding: "10px 14px", borderRadius: 8, background: lineGroupId ? "rgba(47,133,90,0.07)" : "rgba(22,50,74,0.04)", border: `1px solid ${lineGroupId ? "rgba(47,133,90,0.25)" : "var(--divider-color,#D8E1EC)"}` }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: lineGroupId ? "#2F855A" : "var(--text-muted,#8CA2B5)", flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: lineGroupId ? "#2F855A" : "var(--text-muted,#5F7A91)" }}>
              {lineGroupId ? t("settingsLineConnected") : t("settingsLineNotConnected")}
            </p>
            {lineGroupId && <p style={{ margin: "2px 0 0", fontSize: 10, color: "var(--text-muted,#7B8FA3)", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lineGroupId}</p>}
          </div>
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <button style={{ ...S.btn("ghost"), padding: "5px 10px", fontSize: 11 }} onClick={() => api.getData().then(d => { if (d.lineGroupId && d.lineGroupId !== lineGroupId) { setLineGroupId(d.lineGroupId); setLineTest(null); } })}>{t("settingsLineRefresh")}</button>
            {lineGroupId && (<>
              <button style={{ ...S.btn("ghost"), padding: "5px 10px", fontSize: 11 }} disabled={lineTest === "sending"} onClick={async () => {
                setLineTest("sending");
                try {
                  const res = await fetch("/api/notify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userIds: [lineGroupId], message: "Test from Pick Shoot Return: notifications are working" }) });
                  const d = await res.json().catch(() => null);
                  setLineTest(d?.ok ? { ok: true, text: "Delivered, check the group chat" } : { ok: false, text: (d?.errors && d.errors[0]) || `Failed (HTTP ${res.status})` });
                } catch {
                  setLineTest({ ok: false, text: "Network error, could not reach the server" });
                }
              }}>{lineTest === "sending" ? "Sending…" : "Send test"}</button>
              <button style={{ ...S.btn("danger"), padding: "5px 10px", fontSize: 11 }} onClick={async () => { const r = await api.putData({ lineGroupId: null }); if (r?.ok) { setLineGroupId(null); setLineTest(null); } }}>{t("settingsLineDisconnect")}</button>
            </>)}
          </div>
        </div>
        {lineTest && lineTest !== "sending" && (
          <div style={{ marginBottom: 14, padding: "10px 14px", borderRadius: 8, fontSize: 12, background: lineTest.ok ? "rgba(47,133,90,0.07)" : "rgba(197,48,48,0.07)", border: `1px solid ${lineTest.ok ? "rgba(47,133,90,0.25)" : "rgba(197,48,48,0.25)"}`, color: lineTest.ok ? "#2F855A" : "#C53030" }}>
            <Icon d={lineTest.ok ? icons.check : icons.alert} size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />{lineTest.text}
            {!lineTest.ok && /Failed to send messages/i.test(lineTest.text) && (
              <p style={{ margin: "6px 0 0", color: "var(--text-muted,#4E6B84)" }}>
                The OA is probably no longer in this group (or the group was recreated). Re-invite the OA to the group, send any message there, then tap Refresh here to pick up the new group ID and test again.
              </p>
            )}
          </div>
        )}
        <div
          onClick={() => { const next = !lineNotifyMuted; setLineNotifyMuted(next); try { localStorage.setItem("psr_notify_muted", next ? "1" : "0"); } catch {} }}
          style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 8, background: lineNotifyMuted ? "rgba(197,48,48,0.07)" : "rgba(47,133,90,0.05)", border: `1px solid ${lineNotifyMuted ? "rgba(197,48,48,0.25)" : "rgba(47,133,90,0.15)"}`, cursor: "pointer", userSelect: "none" }}>
          <div style={{ width: 36, height: 20, borderRadius: 10, background: lineNotifyMuted ? "#C53030" : "#2F855A", position: "relative", flexShrink: 0, transition: "background .2s" }}>
            <div style={{ position: "absolute", top: 2, left: lineNotifyMuted ? 2 : 18, width: 16, height: 16, borderRadius: "50%", background: "#fff", transition: "left .2s", boxShadow: "0 1px 3px rgba(22,50,74,0.1)" }} />
          </div>
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: lineNotifyMuted ? "#C53030" : "#2F855A" }}>
              {lineNotifyMuted ? t("settingsLineMuted") : t("settingsLineActive")}
            </p>
            <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-muted,#7B8FA3)" }}>
              {lineNotifyMuted ? t("settingsLineMutedDesc") : t("settingsLineActiveDesc")}
            </p>
          </div>
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted,#5F7A91)", lineHeight: 1.8, marginTop: 14 }}>
          <strong style={{ color: "var(--text,#16324A)", display: "block", marginBottom: 6 }}>Connect a Group Chat (one-time):</strong>
          1. Add your LINE OA to the group chat<br />
          2. In <strong>LINE Developers Console</strong> → Messaging API → Webhook URL, set:<br />
          <code style={{ background: "rgba(var(--accent-rgb,37,99,235),0.1)", color: "var(--accent,#2563EB)", padding: "2px 8px", borderRadius: 4, display: "inline-block", margin: "4px 0", fontSize: 11 }}>https://pickshootreturn.pages.dev/api/webhook</code><br />
          3. Enable <strong>Use webhook</strong> and click <strong>Verify</strong><br />
          4. The group ID is captured automatically when the OA joins or receives a message in the group
        </div>
        <p style={{ fontSize: 11, color: "var(--text-muted,#7B8FA3)", marginTop: 10 }}>
          {lineGroupId ? t("settingsLineGroupConnected") : t("settingsLineGroupNotConnected")}
        </p>
      </div>

      {/* Internal Chat toggle */}
      <div style={{ ...S.card, marginBottom: 20 }}>
        <p style={S.sectionTitle}>Internal Chat</p>
        <div
          onClick={() => setChatEnabled(v => !v)}
          style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 8, background: chatEnabled ? "rgba(47,133,90,0.05)" : "rgba(22,50,74,0.04)", border: `1px solid ${chatEnabled ? "rgba(47,133,90,0.2)" : "var(--divider-color,#D8E1EC)"}`, cursor: "pointer", userSelect: "none" }}
        >
          <div style={{ width: 36, height: 20, borderRadius: 10, background: chatEnabled ? "#2F855A" : "#C9D4DF", position: "relative", flexShrink: 0, transition: "background .2s" }}>
            <div style={{ position: "absolute", top: 2, left: chatEnabled ? 18 : 2, width: 16, height: 16, borderRadius: "50%", background: "#fff", transition: "left .2s", boxShadow: "0 1px 3px rgba(22,50,74,0.1)" }} />
          </div>
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: chatEnabled ? "#2F855A" : "var(--text-muted,#5F7A91)" }}>
              {chatEnabled ? "Chat Enabled" : "Chat Disabled"}
            </p>
            <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-muted,#7B8FA3)" }}>
              {chatEnabled ? "Team members can send real-time messages" : "Enable real-time group chat for the whole team"}
            </p>
          </div>
          <Icon d={icons.chat} size={16} color={chatEnabled ? "#2F855A" : "#C9D4DF"} />
        </div>
        {chatEnabled && (
          <p style={{ fontSize: 11, color: "var(--text-muted,#7B8FA3)", marginTop: 10, lineHeight: 1.6 }}>
            Messages appear instantly on all devices. Chat history is stored per-session (last 200 messages).
          </p>
        )}
      </div>

      <div style={{ ...S.card, marginBottom: 20 }}>
        <p style={S.sectionTitle}>{t("settingsCalSync")}</p>
        <div style={S.col}>
          <p style={{ fontSize: 13, color: "var(--text-muted,#5F7A91)", margin: 0, lineHeight: 1.7 }}>
            Subscribe to the job schedule in your iPhone Calendar. Pencil jobs appear as <strong style={{ color: "var(--text,#16324A)" }}>tentative (striped)</strong>, Confirmed as <strong style={{ color: "#2F855A" }}>solid</strong>. Auto-refreshes hourly.
          </p>
          <div style={{ fontSize: 12, color: "var(--text-muted,#5F7A91)", lineHeight: 1.8 }}>
            <strong style={{ color: "var(--text,#16324A)", display: "block", marginBottom: 6 }}>{t("settingsCalDescTitle")}</strong>
            1. Open <strong>Settings → Calendar → Accounts → Add Account → Other</strong><br />
            2. Tap <strong>Add Subscribed Calendar</strong><br />
            3. Paste this URL:<br />
            <code style={{ background: "rgba(var(--accent-rgb,37,99,235),0.1)", color: "var(--accent,#2563EB)", padding: "2px 8px", borderRadius: 4, display: "inline-block", margin: "4px 0", fontSize: 11, wordBreak: "break-all" }}>{calendarToken ? calendarUrl(calendarToken) : "…"}</code><br />
            4. Tap <strong>Next</strong> → <strong>Save</strong>
          </div>
          <p style={{ fontSize: 12, color: "var(--text-muted,#5F7A91)", margin: 0 }}>{t("settingsCalTokenHint")}</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button style={{ ...S.btn("ghost"), fontSize: 12 }} disabled={!calendarToken} onClick={() => { navigator.clipboard?.writeText(calendarUrl(calendarToken)); }}>
              {t("settingsCopyCalUrl")}
            </button>
            <button style={{ ...S.btn("ghost"), fontSize: 12, opacity: calBusy ? 0.6 : 1 }} disabled={calBusy} onClick={async () => {
              if (!window.confirm(t("settingsCalRotateConfirm"))) return;
              setCalBusy(true);
              const r = await api.calendarToken(true).catch(() => ({}));
              setCalBusy(false);
              if (r && r.ok && r.token) setCalendarToken(r.token);
            }}>{t("settingsCalRotate")}</button>
          </div>
        </div>
      </div>

      <div style={{ ...S.card, marginBottom: 20 }}>
        <p style={S.sectionTitle}>{t("settingsMyPin")}</p>
        <div style={S.col}>
          <p style={{ fontSize: 13, color: "var(--text-muted,#5F7A91)", margin: 0 }}>{user && user.name ? `${user.name} · ` : ""}{isOwner ? t("settingsStaffOwner") : t("settingsStaffCounter")} · {t("settingsPinHintNoShow")}</p>
          <div style={S.row}>
            <div style={{ flex: 1 }}>
              <label style={S.label}>{t("settingsCurrentPinLabel")}</label>
              <input style={S.input} type="password" inputMode="numeric" maxLength={6} value={apForm.oldPin} onChange={e => setApForm(p => ({ ...p, oldPin: e.target.value.replace(/\D/g, "") }))} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={S.label}>{t("settingsNewPin")}</label>
              <input style={S.input} type="password" inputMode="numeric" maxLength={6} value={apForm.newPin} onChange={e => setApForm(p => ({ ...p, newPin: e.target.value.replace(/\D/g, "") }))} placeholder="e.g. 9999" />
            </div>
            <div style={{ flex: 1 }}>
              <label style={S.label}>{t("settingsConfirmPin")}</label>
              <input style={S.input} type="password" inputMode="numeric" maxLength={6} value={apForm.confirmPin} onChange={e => setApForm(p => ({ ...p, confirmPin: e.target.value.replace(/\D/g, "") }))} placeholder={t("settingsPinReEnter")} />
            </div>
          </div>
          {apMsg && <p style={{ fontSize: 12, color: apMsg.ok ? "#2F855A" : "#C53030", margin: 0 }}>{apMsg.text}</p>}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button style={{ ...S.btn("primary"), opacity: apBusy ? 0.6 : 1 }} disabled={apBusy} onClick={async () => {
              const { oldPin, newPin, confirmPin } = apForm;
              if (!/^\d{4,6}$/.test(oldPin)) { setApMsg({ ok: false, text: t("settingsPinWrong") }); return; }
              if (!/^\d{4,6}$/.test(newPin)) { setApMsg({ ok: false, text: t("settingsPinInvalid") }); return; }
              if (newPin !== confirmPin) { setApMsg({ ok: false, text: t("settingsPinMismatch") }); return; }
              setApBusy(true);
              const r = await api.changePin(oldPin, newPin).catch(() => ({ status: 0 }));
              setApBusy(false);
              if (r.ok) { setApForm({ oldPin: "", newPin: "", confirmPin: "" }); setApMsg({ ok: true, text: t("settingsPinUpdated") }); setTimeout(() => setApMsg(null), 3000); return; }
              if (r.status === 401) { setApMsg({ ok: false, text: t("settingsPinWrong") }); return; }
              if (r.status === 429) { setApMsg({ ok: false, text: t("loginTooManyAttempts") + (r.retryAfter || 60) + t("loginSeconds") }); return; }
              setApMsg({ ok: false, text: r.error || t("pinSaveFailed") });
            }}>{t("settingsChangePin")}</button>
          </div>
        </div>
      </div>

      <div style={{ ...S.card, marginBottom: 20 }}>
        <p style={S.sectionTitle}>{t("settingsStaff")}</p>
        <div style={S.col}>
          <p style={{ fontSize: 13, color: "var(--text-muted,#5F7A91)", margin: 0, lineHeight: 1.6 }}>{t("settingsStaffDesc")}</p>
          {!isOwner && <p style={{ fontSize: 12, color: "var(--text-muted,#7B8FA3)", margin: 0 }}>{t("settingsStaffOnlyOwner")}</p>}
          <div style={S.col}>
            {[{ id: "owner", name: ownerName || t("loginOwner"), role: "owner" }, ...(staff || []).filter(x => x.id !== "owner")].map((st, i, arr) => (
              <div key={st.id} style={{ display: "flex", alignItems: "center", gap: 10, paddingBottom: i < arr.length - 1 ? 10 : 0, borderBottom: i < arr.length - 1 ? "1px solid var(--divider-color,#D8E1EC)" : "none" }}>
                <span style={S.badge(st.role === "owner" ? "green" : "gray")}>{st.role === "owner" ? t("settingsStaffOwner") : t("settingsStaffCounter")}</span>
                <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{st.name}{user && user.staffId === st.id ? <span style={{ fontSize: 11, color: "var(--text-muted,#7B8FA3)", fontWeight: 400 }}> · {t("settingsStaffYou")}</span> : null}</span>
                {isOwner && (
                  <div style={{ display: "flex", gap: 6 }}>
                    <button style={{ ...S.btn("ghost"), padding: "5px 9px", fontSize: 12 }} onClick={() => { setStaffPinTarget(st); setStaffForm(f => ({ ...f, pin: "", confirm: "" })); setStaffMsg(null); }}>{t("settingsStaffResetPin")}</button>
                    {st.id !== "owner" && <button style={{ ...S.btn("danger"), padding: "5px 9px" }} title={t("settingsStaffRemove")} onClick={async () => {
                      if (!window.confirm(t("settingsStaffRemoveConfirm"))) return;
                      const r = await api.staffRemove(st.id).catch(() => ({}));
                      if (r && r.ok) setStaff(r.staff || []); else setStaffMsg({ ok: false, text: r.error || t("pinSaveFailed") });
                    }}><Icon d={icons.trash} size={13} /></button>}
                  </div>
                )}
              </div>
            ))}
          </div>
          {isOwner && staffPinTarget && (
            <div style={{ ...S.card, background: "var(--surface2,#EAF0F7)", padding: 12 }}>
              <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 700 }}>{t("pinResetFor").replace("{name}", staffPinTarget.name)}</p>
              <div style={S.row}>
                <input style={{ ...S.input, flex: 1 }} type="password" inputMode="numeric" maxLength={6} value={staffForm.pin} onChange={e => setStaffForm(f => ({ ...f, pin: e.target.value.replace(/\D/g, "") }))} placeholder={t("teamPinLabel")} />
                <input style={{ ...S.input, flex: 1 }} type="password" inputMode="numeric" maxLength={6} value={staffForm.confirm} onChange={e => setStaffForm(f => ({ ...f, confirm: e.target.value.replace(/\D/g, "") }))} placeholder={t("settingsPinReEnter")} />
                <button style={{ ...S.btn("primary"), opacity: staffBusy ? 0.6 : 1 }} disabled={staffBusy} onClick={async () => {
                  if (!/^\d{4,6}$/.test(staffForm.pin)) { setStaffMsg({ ok: false, text: t("settingsPinInvalid") }); return; }
                  if (staffForm.pin !== staffForm.confirm) { setStaffMsg({ ok: false, text: t("settingsPinMismatch") }); return; }
                  setStaffBusy(true);
                  const r = await api.staffPin(staffPinTarget.id, staffForm.pin).catch(() => ({}));
                  setStaffBusy(false);
                  if (r && r.ok) { setStaffPinTarget(null); setStaffForm(f => ({ ...f, pin: "", confirm: "" })); setStaffMsg({ ok: true, text: t("pinResetDone") }); setTimeout(() => setStaffMsg(null), 3000); }
                  else setStaffMsg({ ok: false, text: (r && r.error) || t("pinSaveFailed") });
                }}>{t("pinResetTitle")}</button>
                <button style={S.btn("ghost")} onClick={() => setStaffPinTarget(null)}>{t("cancel")}</button>
              </div>
            </div>
          )}
          {isOwner && (<>
            <div style={S.row}>
              <div style={{ flex: 2 }}>
                <label style={S.label}>{t("settingsOwnerName")}</label>
                <input style={S.input} value={ownerName} onChange={e => setOwnerName(e.target.value)} placeholder={t("loginOwner")} onBlur={async () => {
                  const nm = ownerName.trim();
                  const cur = (staff || []).find(x => x.id === "owner")?.name || "";
                  if (!nm || nm === cur) return;
                  const r = await api.staffRename("owner", nm).catch(() => ({}));
                  if (r && r.ok) { setStaff(r.staff || []); if (r.user && onUserUpdate) onUserUpdate(r.user); }
                }} />
                <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--text-muted,#7B8FA3)" }}>{t("settingsOwnerNameHint")}</p>
              </div>
            </div>
            <p style={{ ...S.label, marginTop: 4 }}>{t("settingsStaffAdd")}</p>
            <div style={{ ...S.row, flexWrap: "wrap" }}>
              <input style={{ ...S.input, flex: 2, minWidth: 140 }} value={staffForm.name} onChange={e => setStaffForm(f => ({ ...f, name: e.target.value }))} placeholder={t("settingsStaffName")} />
              <select style={{ ...S.select, flex: 1, minWidth: 120 }} value={staffForm.role} onChange={e => setStaffForm(f => ({ ...f, role: e.target.value }))}>
                <option value="counter">{t("settingsStaffCounter")}</option>
                <option value="owner">{t("settingsStaffOwner")}</option>
              </select>
              <input style={{ ...S.input, flex: 1, minWidth: 110 }} type="password" inputMode="numeric" maxLength={6} value={staffPinTarget ? "" : staffForm.pin} onChange={e => setStaffForm(f => ({ ...f, pin: e.target.value.replace(/\D/g, "") }))} placeholder={t("teamPinLabel")} disabled={!!staffPinTarget} />
              <input style={{ ...S.input, flex: 1, minWidth: 110 }} type="password" inputMode="numeric" maxLength={6} value={staffPinTarget ? "" : staffForm.confirm} onChange={e => setStaffForm(f => ({ ...f, confirm: e.target.value.replace(/\D/g, "") }))} placeholder={t("settingsPinReEnter")} disabled={!!staffPinTarget} />
              <button style={{ ...S.btn("primary"), opacity: staffBusy ? 0.6 : 1 }} disabled={staffBusy || !!staffPinTarget} onClick={async () => {
                if (!staffForm.name.trim()) { setStaffMsg({ ok: false, text: t("teamNameRequired") }); return; }
                if (!/^\d{4,6}$/.test(staffForm.pin)) { setStaffMsg({ ok: false, text: t("settingsPinInvalid") }); return; }
                if (staffForm.pin !== staffForm.confirm) { setStaffMsg({ ok: false, text: t("settingsPinMismatch") }); return; }
                setStaffBusy(true);
                const r = await api.staffAdd({ name: staffForm.name.trim(), role: staffForm.role, pin: staffForm.pin }).catch(() => ({}));
                setStaffBusy(false);
                if (r && r.ok) { setStaff(r.staff || []); setStaffForm({ name: "", role: "counter", pin: "", confirm: "" }); setStaffMsg({ ok: true, text: t("settingsStaffAdded") }); setTimeout(() => setStaffMsg(null), 3000); }
                else setStaffMsg({ ok: false, text: (r && r.error) || t("pinSaveFailed") });
              }}><Icon d={icons.plus} size={14} /> {t("settingsStaffAdd")}</button>
            </div>
          </>)}
          {staffMsg && <p style={{ fontSize: 12, color: staffMsg.ok ? "#2F855A" : "#C53030", margin: 0 }}>{staffMsg.text}</p>}
        </div>
      </div>

      <div style={S.card}>
        <p style={S.sectionTitle}>{t("settingsBackup")}</p>
        <div style={S.col}>
          <p style={{ fontSize: 13, color: "var(--text-muted,#5F7A91)", margin: 0, lineHeight: 1.6 }}>{t("settingsBackupDesc2")}</p>
          {lastBackupAt && (
            <p style={{ fontSize: 12, color: "var(--text-muted,#5F7A91)", margin: 0 }}>
              {t("settingsLastBackup")}: <strong style={{ color: "var(--text,#16324A)" }}>{new Date(lastBackupAt).toLocaleString()}</strong>
            </p>
          )}
          {backupStatus === "saved" && <p style={{ fontSize: 12, color: "#2F855A", margin: 0 }}>{t("settingsBackupSaved")}</p>}
          {backupStatus === "error" && <p style={{ fontSize: 12, color: "#C53030", margin: 0 }}>{t("settingsBackupError")}</p>}
          {backupStatus === "restored" && <p style={{ fontSize: 12, color: "#2F855A", margin: 0 }}>{t("settingsBackupRestored")} {t("settingsReloading")}</p>}
          {backupStatus && backupStatus.error && <p style={{ fontSize: 12, color: "#C53030", margin: 0 }}>{t("settingsRestoreFailed")}: {backupStatus.error}</p>}
          <button
            style={{ ...S.btn("primary"), justifyContent: "center", opacity: backupStatus === "saving" ? 0.7 : 1 }}
            disabled={backupStatus === "saving" || backupStatus === "restoring"}
            onClick={async () => {
              setBackupStatus("saving");
              try {
                const res = await createBackup();
                if (!res?.ok) throw new Error();
                const ts = new Date().toISOString();
                setLastBackupAt(ts);
                setBackupStatus("saved");
                refreshBackups();
              } catch { setBackupStatus("error"); }
              setTimeout(() => setBackupStatus(s => (s === "saved" || s === "error") ? null : s), 4000);
            }}>
            {backupStatus === "saving" ? t("settingsSavingBackup") : t("settingsCreateBackup")}
          </button>

          {/* Version list: newest first, manual / auto / safety, pick one to restore or download */}
          <div id="backup-list" style={{ border: "1px solid var(--border-color,#D8E1EC)", borderRadius: 10, overflow: "hidden" }}>
            <div style={{ padding: "8px 12px", background: "var(--surface2,#EAF0F7)", fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", color: "var(--text-muted,#5F7A91)", textTransform: "uppercase" }}>{t("backupVersions")}</div>
            {backups === null && <p style={{ margin: 0, padding: "12px", fontSize: 12, color: "var(--text-muted,#7B8FA3)" }}>{t("backupLoading")}</p>}
            {backups && backups.length === 0 && <p style={{ margin: 0, padding: "12px", fontSize: 12, color: "var(--text-muted,#7B8FA3)" }}>{t("backupNone")}</p>}
            {backups && backups.map(b => (
              <div key={b.id} style={{ padding: "10px 12px", borderTop: "1px solid var(--border-color,#D8E1EC)", display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={S.badge(b.kind === "auto" ? "blue" : b.kind === "safety" ? "amber" : "green")}>{kindLabel(b.kind)}</span>
                  <strong style={{ fontSize: 13, color: "var(--text,#16324A)" }}>{new Date(b.savedAt).toLocaleString()}</strong>
                  {b.label && <span style={{ fontSize: 11, color: "var(--text-muted,#7B8FA3)" }}>{b.label}</span>}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted,#7B8FA3)" }}>
                  {t("backupCounts").replace("{jobs}", b.counts?.jobs ?? "?").replace("{gear}", b.counts?.equipment ?? "?").replace("{checkouts}", b.counts?.checkouts ?? "?").replace("{photos}", b.photoCount ?? "?")}
                </div>
                {restoreTarget === b.id ? (
                  <div style={{ background: "rgba(197,48,48,0.06)", border: "1px solid #C53030", borderRadius: 8, padding: "10px 12px" }}>
                    <p style={{ fontSize: 12, color: "#C53030", margin: "0 0 8px 0", fontWeight: 600 }}>{t("settingsRestoreConfirmMsg")} {t("backupRestoreSafetyNote")}</p>
                    <div style={S.row}>
                      <button style={{ ...S.btn("danger"), flex: 1, justifyContent: "center", fontSize: 12 }} disabled={backupStatus === "restoring"} onClick={async () => {
                        setBackupStatus("restoring");
                        try {
                          const savedAt = await restoreBackup(b.id);
                          if (!savedAt) { setBackupStatus("no-backup"); setTimeout(() => setBackupStatus(null), 4000); return; }
                          setBackupStatus("restored");
                          setRestoreTarget(null);
                          setTimeout(() => window.location.reload(), 1500);
                        } catch (e) { setBackupStatus({ error: (e && e.message) || "" }); setTimeout(() => setBackupStatus(null), 6000); }
                      }}>
                        {backupStatus === "restoring" ? t("settingsRestoring") : t("settingsYesRestore")}
                      </button>
                      <button style={{ ...S.btn("ghost"), flex: 1, justifyContent: "center", fontSize: 12 }} onClick={() => setRestoreTarget(null)}>{t("cancel")}</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 8 }}>
                    <button style={{ ...S.btn("ghost"), fontSize: 12, padding: "5px 10px", borderColor: "#C53030", color: "#C53030" }} disabled={backupStatus === "saving" || backupStatus === "restoring"} onClick={() => setRestoreTarget(b.id)}>
                      {t("backupRestoreThis")}
                    </button>
                    <button style={{ ...S.btn("ghost"), fontSize: 12, padding: "5px 10px" }} onClick={async () => {
                      const d = await api.getBackupById(b.id);
                      if (!d) return;
                      const url = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: "application/json" }));
                      const a = document.createElement("a");
                      a.href = url; a.download = `psr_backup_${new Date(b.savedAt).toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`;
                      a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
                    }}>
                      {t("settingsDownloadJson")}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
          <p style={{ fontSize: 11, color: "var(--text-muted,#7B8FA3)", margin: 0, lineHeight: 1.5 }}>{t("backupRetentionNote")}</p>
        </div>
      </div>

      {/* Photo storage (P0-1): move inline base64 photos into their own keys */}
      <div id="photo-storage" style={{ ...S.card, marginTop: 20 }}>
        <p style={S.sectionTitle}>{t("photoStorageTitle")}</p>
        <div style={S.col}>
          <p style={{ fontSize: 13, color: "var(--text-muted,#5F7A91)", margin: 0, lineHeight: 1.6 }}>{t("photoStorageDesc")}</p>
          {photoStatus === null && <p style={{ fontSize: 12, color: "var(--text-muted,#7B8FA3)", margin: 0 }}>{t("backupLoading")}</p>}
          {photoStatus && photoStatus.inline === 0 && migrateState !== "done" && (
            <p style={{ fontSize: 12, color: "#2F855A", margin: 0, fontWeight: 600 }}>{t("photoStorageAllMoved")}</p>
          )}
          {photoStatus && photoStatus.inline > 0 && (
            <p style={{ fontSize: 12, color: "#B7791F", margin: 0, fontWeight: 600 }}>
              {t("photoStoragePending").replace("{n}", photoStatus.inline).replace("{mb}", (photoStatus.bytes / 1048576).toFixed(1))}
            </p>
          )}
          {migrateState && migrateState.remaining !== undefined && (
            <p style={{ fontSize: 12, color: "var(--text,#16324A)", margin: 0 }}>{t("photoStorageProgress").replace("{moved}", migrateState.moved).replace("{left}", migrateState.remaining)}</p>
          )}
          {migrateState === "done" && <p style={{ fontSize: 12, color: "#2F855A", margin: 0, fontWeight: 600 }}>{t("photoStorageDone")}</p>}
          {migrateState && migrateState.error && <p style={{ fontSize: 12, color: "#C53030", margin: 0 }}>{migrateState.error}</p>}
          {photoStatus && photoStatus.inline > 0 && (
            <button
              style={{ ...S.btn("primary"), alignSelf: "flex-start", opacity: migrateState && migrateState.remaining !== undefined ? 0.7 : 1 }}
              disabled={!!(migrateState && migrateState.remaining !== undefined)}
              onClick={async () => {
                setMigrateState({ moved: 0, remaining: photoStatus.inline });
                try {
                  await migratePhotos((moved, remaining) => setMigrateState({ moved, remaining }));
                  setMigrateState("done");
                  refreshPhotoStatus();
                } catch (e) { setMigrateState({ error: (e && e.message) || t("photoStorageFailed") }); }
              }}>
              {t("photoStorageRun")}
            </button>
          )}
        </div>
      </div>

      <div style={{ ...S.card, marginTop: 20 }}>
        <p style={S.sectionTitle}>{t("settingsSystemInfo")}</p>
        <p style={{ fontSize: 13, color: "var(--text-muted,#5F7A91)" }}>{t("settingsSysDesc1")}</p>
        <p style={{ fontSize: 13, color: "var(--text-muted,#5F7A91)", marginTop: 8 }}>{t("settingsSysDesc2")}</p>
      </div>

      </div>
      {/* Save all settings: a fixed footer of the panel, never floating over the content (P1-3) */}
      <div data-sticky-primary="settings-save" style={{ flexShrink: 0, background: "var(--surface,#FFFFFF)", borderTop: "1px solid var(--divider-color,#D8E1EC)", padding: "12px 16px", paddingBottom: "calc(12px + env(safe-area-inset-bottom, 0px))", boxShadow: "0 -4px 16px rgba(22,50,74,0.06)" }}>
        <div style={{ maxWidth: 600, margin: "0 auto" }}>
        <button
          style={{ ...S.btn(saveState === "saved" ? "success" : saveState && saveState.error ? "danger" : "primary", "lg"), width: "100%", padding: "14px", fontSize: 15, fontWeight: 700, opacity: saveState === "saving" ? 0.75 : 1 }}
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
            : <><Icon d={icons.save} size={17} /> {t("settingsSaveAll")}</>}
        </button>
        {saveState && saveState.error && (
          <p style={{ fontSize: 12, color: "#C53030", textAlign: "center", margin: "8px 0 0", lineHeight: 1.5 }}>⚠ {saveState.error}</p>
        )}
        {saveState === "saved" && (
          <p style={{ fontSize: 11, color: "#2F855A", textAlign: "center", margin: "8px 0 0" }}>{t("settingsSavedAt")} {new Date().toLocaleTimeString()}</p>
        )}
        <p style={{ fontSize: 11, color: "var(--text-muted,#5F7A91)", textAlign: "center", margin: "6px 0 0", lineHeight: 1.4 }}>{t("settingsSaveHint")}</p>
        </div>
      </div>
    </div>
  );
}

// ─── ADMIN THEME SELECTOR ────────────────────────────────────────────────────
export function ThemeSelector({ themeStyle, setThemeStyle, themePalette, setThemePalette }) {
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
    { id: "flat", label: "Flat" },
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
  const activeDot = PALETTE_OPTS.find(p => p.id === themePalette)?.dot || "var(--accent,#2563EB)";

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ display: "flex", alignItems: "center", gap: 5, background: open ? "rgba(var(--accent-rgb,37,99,235),0.1)" : "transparent", border: `1px solid ${open ? "var(--accent,#2563EB)" : "var(--border-color,#D8E1EC)"}`, borderRadius: "var(--btn-radius,7px)", padding: "5px 10px", cursor: "pointer", color: "var(--text-muted,#4E6B84)" }}
        title="Theme"
      >
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: activeDot, flexShrink: 0 }} />
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="var(--accent,#2563EB)" strokeWidth={1.8} strokeLinecap="round">
          <path d="M12 2a10 10 0 1 0 0 20c1.1 0 2-.9 2-2v-.5c0-.55.45-1 1-1h1.5a2 2 0 0 0 2-2 10 10 0 0 0-6.5-9.5M8 12a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM12 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM16 12a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" />
        </svg>
      </button>

      {open && (
        <div style={{ position: "absolute", right: 0, top: "calc(100% + 8px)", background: "var(--surface,#FFFFFF)", border: "var(--card-border,1px solid #D8E1EC)", borderRadius: "var(--card-radius,10px)", boxShadow: "0 8px 32px rgba(22,50,74,0.17)", backdropFilter: "var(--card-backdrop,none)", padding: 16, width: 210, zIndex: 300 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", color: "var(--text-muted,#5F7A91)", marginBottom: 8, textTransform: "uppercase" }}>Style</div>
          <div style={{ display: "flex", gap: 5, marginBottom: 14 }}>
            {STYLE_OPTS.map(s => (
              <button
                key={s.id}
                onClick={() => setThemeStyle(s.id)}
                style={{ flex: 1, padding: "7px 4px", borderRadius: 6, border: themeStyle === s.id ? "2px solid var(--accent,#2563EB)" : "1px solid var(--border-color,#D8E1EC)", background: themeStyle === s.id ? "rgba(var(--accent-rgb,37,99,235),0.08)" : "transparent", color: themeStyle === s.id ? "var(--accent,#2563EB)" : "var(--text-muted,#5F7A91)", fontSize: 10, fontWeight: 700, cursor: "pointer", letterSpacing: "0.04em" }}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", color: "var(--text-muted,#5F7A91)", marginBottom: 8, textTransform: "uppercase" }}>Color</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 5 }}>
            {PALETTE_OPTS.map(pal => (
              <button
                key={pal.id}
                onClick={() => setThemePalette(pal.id)}
                style={{ padding: "7px 4px", borderRadius: 6, border: themePalette === pal.id ? `2px solid ${pal.dot}` : "1px solid var(--border-color,#D8E1EC)", background: "transparent", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}
              >
                <div style={{ width: 16, height: 16, borderRadius: "50%", background: pal.dot }} />
                <span style={{ fontSize: 9, color: "var(--text-muted,#5F7A91)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.03em" }}>{pal.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
