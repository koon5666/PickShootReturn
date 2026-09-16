// Admin pages (P3-8 code split): Dashboard, Equipment, Jobs, Team, Checkout,
// Reports, damage reports. Lazy chunk loaded after admin login; App.jsx prefetches
// it when idle so navigation (and the offline path) never waits.
import { useState, useEffect, useRef, useContext } from "react";
import { stillOutList, jobConflicts, unitsOutForEquipment, unitsOutForJob, jobLastDate, effPickupDate, effReturnDate, isOpenReport, unreconciledLost, reconcileLost } from "../logic/availability.js";
import { filterHistory, historyCsv, downloadText } from "../logic/history.js";
import { isPickEvt, isReturnEvt, isLostEvt, isVoidEvt, jobCheckoutState, outstandingQty, laneDone, conditionKey, DEFAULT_DAY_START_HOUR } from "../logic/checkoutState.js";
import { formatDate, formatDateTime, tCount, statusLabel } from "../i18n/format.js";
import { kpiMax, kpiStars, isKpiAdd, buildKpiEvent } from "../logic/kpi.js";
import { normalizeCrew, hasRoster, defaultCheckoutRoles, crewNames, jobChangeSet, shouldNotify, pushRecipients, pushEmployeeIds, buildJobMessage, EMPTY_CREW_ROW } from "../logic/roster.js";
import { utilisation, utilisationCsv, overdueCsv, customerHistory, customerHistoryCsv, customerNames, crewStatement, crewStatementCsv, periodPreset, monthOf } from "../logic/reports.js";
import { JOB_STATUSES, JOB_STATUS_BADGE, SHOOT_TIMES, LOCATIONS, j, api, actorName, Icon, icons, APP_TZ, today, addDaysStr, kpiPeriod, kpiScore, kpiEventsInPeriod, StarRating, compressImage, S, useMinWidth, Modal, LazyPhoto, AvailBar, usePhotoCapture, GeoPhoto, ReturnDetailsFields, QRScanner, LangCtx, useRoleList, useT, calcAvailable, jobHoldDatesOf, calcAvailableSpan, describeReasons, AvChip, AvReasons, printQRForItems, EQ_SORT_OPTIONS } from "../ui/shared.jsx";
import { DashboardCalendar } from "./calendar.jsx";

export function EquipmentPage({ equipment, setEquipment, jobs, checkouts, reports, setReports, equipmentRequests, productionCompanies, initialTab, onConsumeInitialTab }) {
  const t = useT();
  const [eqTab, setEqTab] = useState(initialTab || "equipment"); // equipment | reports
  const [modal, setModal] = useState(null);
  const [editTarget, setEditTarget] = useState(null);
  const [form, setForm] = useState({ name: "", category: "", total: 1, notes: "", photo: null });
  const [newCatInput, setNewCatInput] = useState("");
  const [histTarget, setHistTarget] = useState(null);
  const [histLimit, setHistLimit] = useState(20);
  const [histRange, setHistRange] = useState({ from: "", to: "" });
  const [sortBy, setSortBy] = useState("name_az");
  const [filterCat, setFilterCat] = useState(null);
  const [search, setSearch] = useState("");
  const [eqFormErr, setEqFormErr] = useState("");
  // Deep-link (e.g. Damage-Reports notification) → jump to a specific tab once.
  useEffect(() => {
    if (initialTab) { setEqTab(initialTab); onConsumeInitialTab && onConsumeInitialTab(); }
  }, [initialTab]); // eslint-disable-line react-hooks/exhaustive-deps
  const [qrTarget, setQrTarget] = useState(null); // equipment item to show single QR
  const [selectedIds, setSelectedIds] = useState(new Set()); // for multi-select print
  const [selectMode, setSelectMode] = useState(false);
  const fileRef = useRef(null);

  const availableList = calcAvailable(equipment, today(), { jobs, checkouts, equipmentRequests, reports });
  const existingCategories = [...new Set(equipment.map(e => e.category).filter(Boolean))].sort();

  const openAdd = () => { setForm({ name: "", category: "", total: 1, notes: "", photo: null }); setNewCatInput(""); setEqFormErr(""); setModal("add"); };
  const openEdit = (eq) => { setEditTarget(eq); setForm({ ...eq }); setNewCatInput(""); setEqFormErr(""); setModal("edit"); };
  const openHistory = (eq) => { setHistTarget(eq); setHistLimit(20); setHistRange({ from: "", to: "" }); setModal("history"); };

  const handlePhoto = (e) => {
    const f = e.target.files[0]; if (!f) return;
    compressImage(f, { maxDim: 1200, quality: 0.72 }).then(d => d && setForm(p => ({ ...p, photo: d })));
  };

  const save = () => {
    if (!form.name.trim()) { setEqFormErr(t("eqErrName")); return; }
    const cat = form.category === "__new__" ? newCatInput.trim() : form.category;
    if (!cat) { setEqFormErr(t("eqErrCategory")); return; }
    setEqFormErr("");
    const saved = { ...form, category: cat, total: +form.total };
    if (modal === "add") {
      setEquipment(p => [...p, { ...saved, id: "eq" + Date.now() }]);
    } else {
      setEquipment(p => p.map(e => e.id === editTarget.id ? { ...e, ...saved } : e));
    }
    setModal(null);
  };

  const del = (id) => {
    // P1-12: refuse while units are still out (picked, not returned). Deleting would
    // erase the only record that this gear is unaccounted for.
    const out = unitsOutForEquipment(checkouts, id);
    if (out > 0) { window.alert(t("eqDeleteBlocked").replace("{n}", out)); return; }
    if (window.confirm(t("eqDeleteConfirm"))) {
      const eq = equipment.find(e => e.id === id);
      setEquipment(p => p.filter(e => e.id !== id));
      api.audit({ action: "equipment.delete", recordId: id, name: eq ? eq.name : "" }); // actor stamp (P2-6)
    }
  };

  // P3-5: full per-item log, newest first, date-filterable, paged 20 at a time.
  const getHistory = (eqId) => filterHistory(checkouts, eqId, { from: histRange.from, to: histRange.to, limit: histLimit, tz: APP_TZ });

  // Printable A4 sheet of QR labels for every item (same renderer as the
  // selection print; inline SVG, no network).
  const printQRLabels = () => printQRForItems(equipment, true, "Pick Shoot Return QR Labels");

  const AvStatus = ({ av }) => <AvChip av={av} t={t} />;

  // Sort + filter
  const _q = search.trim().toLowerCase();
  const filtered = availableList.filter(e =>
    (!filterCat || e.category === filterCat) &&
    (!_q || (e.name || "").toLowerCase().includes(_q) || (e.category || "").toLowerCase().includes(_q) || (e.notes || "").toLowerCase().includes(_q))
  );
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
          <div style={{ position: "relative", width: "100%", aspectRatio: "1 / 1", overflow: "hidden", background: "var(--surface2,#EAF0F7)", flexShrink: 0 }}>
            {eq.photo
              ? <img src={eq.photo} alt={eq.name} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
              : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon d={icons.camera} size={36} color="var(--divider-color,#D8E1EC)" />
                </div>
            }
            <div style={{ position: "absolute", top: 5, left: 5 }}><AvStatus av={eq} /></div>
          </div>
          {/* Info */}
          <div style={{ padding: "8px 10px 8px", flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={S.tag}>{eq.category}</span>
            <p style={{ margin: 0, fontWeight: 700, fontSize: 12, lineHeight: 1.3, color: "var(--text,#16324A)" }}>{eq.name}</p>
            {eq.notes && <p style={{ margin: 0, fontSize: 10, color: "var(--text-muted,#7B8FA3)", lineHeight: 1.3 }}>{eq.notes}</p>}
            <div style={{ marginTop: 3 }}><AvailBar available={Math.max(0, eq.available)} total={eq.total} /></div>
            {eq.available < 0 && <p style={{ margin: "2px 0 0", fontSize: 10, fontWeight: 700, color: "#C53030" }}>{t("avOverbooked").replace("{n}", -eq.available)}</p>}
            <AvReasons av={eq} t={t} style={{ marginTop: 2 }} />
            {(() => {
              // P0-4: units the admin marked lost / written off stay off the shelf
              // (subtracted above) until they are taken out of stock or found.
              const open = unreconciledLost(eq, checkouts);
              if (!open) return null;
              const to = Math.max(0, (+eq.total || 0) - open);
              return (
                <div data-testid={`lost-open-${eq.id}`} style={{ marginTop: 4, padding: "6px 8px", borderRadius: 6, background: "rgba(197,48,48,0.07)", border: "1px solid rgba(197,48,48,0.25)" }}>
                  <p style={{ margin: 0, fontSize: 10, fontWeight: 700, color: "#C53030", lineHeight: 1.35 }}>{t("eqLostOpen").replace("{n}", open).replace("{total}", eq.total)}</p>
                  <div style={{ display: "flex", gap: 4, marginTop: 5, flexWrap: "wrap" }}>
                    <button style={{ ...S.btn("danger"), padding: "3px 7px", fontSize: 10 }} data-testid={`lost-remove-${eq.id}`}
                      onClick={() => { if (window.confirm(t("eqLostRemoveConfirm").replace("{n}", open).replace("{to}", to))) { setEquipment(p => p.map(e => e.id === eq.id ? reconcileLost(e, checkouts, "remove", open) : e)); api.audit({ action: "equipment.lost_remove", recordId: eq.id, name: eq.name, detail: `${open} of ${eq.total}` }); } }}>
                      {t("eqLostRemove").replace("{from}", eq.total).replace("{to}", to)}
                    </button>
                    <button style={{ ...S.btn("ghost"), padding: "3px 7px", fontSize: 10 }} data-testid={`lost-found-${eq.id}`}
                      onClick={() => { setEquipment(p => p.map(e => e.id === eq.id ? reconcileLost(e, checkouts, "found", open) : e)); api.audit({ action: "equipment.lost_found", recordId: eq.id, name: eq.name, detail: String(open) }); }}>
                      {t("eqLostFound")}
                    </button>
                  </div>
                </div>
              );
            })()}
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

      {eqTab === "reports" && <AdminReportsPage reports={reports} setReports={setReports} equipment={equipment} jobs={jobs} productionCompanies={productionCompanies} />}

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


      {/* Search */}
      <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t("eqSearchPlaceholder")} style={{ ...S.input, marginBottom: 10 }} />

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
            {eqFormErr && <p style={{ color: "#C53030", fontSize: 12, margin: "10px 0 0", fontWeight: 600 }}>{eqFormErr}</p>}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
              <button style={S.btn("ghost")} onClick={() => setModal(null)}>{t("cancel")}</button>
              <button style={S.btn("primary")} onClick={save}>{t("eqSaveEquipment")}</button>
            </div>
          </div>
        </Modal>
      )}

      {/* History Modal (P3-5: showing N of total, date filter, load more, CSV) */}
      {modal === "history" && histTarget && (() => {
        const h = getHistory(histTarget.id);
        const exportCsv = () => {
          const all = filterHistory(checkouts, histTarget.id, { from: histRange.from, to: histRange.to, limit: 0, tz: APP_TZ }).rows;
          downloadText(`history-${(histTarget.name || histTarget.id).replace(/[^\w.-]+/g, "_")}.csv`, historyCsv(all, { eqName: histTarget.name, tz: APP_TZ }));
        };
        return (
        <Modal title={`${t("eqHistoryTitle")}: ${histTarget.name}`} onClose={() => setModal(null)} wide>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 12 }}>
            <div><label style={S.label}>{t("histFrom")}</label><input type="date" style={{ ...S.input, width: 150 }} value={histRange.from} max={histRange.to || undefined} onChange={e => { setHistRange(r => ({ ...r, from: e.target.value })); setHistLimit(20); }} /></div>
            <div><label style={S.label}>{t("histTo")}</label><input type="date" style={{ ...S.input, width: 150 }} value={histRange.to} min={histRange.from || undefined} onChange={e => { setHistRange(r => ({ ...r, to: e.target.value })); setHistLimit(20); }} /></div>
            {(histRange.from || histRange.to) && <button style={{ ...S.btn("ghost"), padding: "8px 10px" }} onClick={() => { setHistRange({ from: "", to: "" }); setHistLimit(20); }}>{t("histClear")}</button>}
            <div style={{ flex: 1 }} />
            <span data-testid="hist-count" style={{ fontSize: 12, color: "var(--text-muted,#5F7A91)" }}>{t("histShowing").replace("{n}", Math.min(h.rows.length, h.total)).replace("{total}", h.total)}</span>
            {h.total > 0 && <button style={{ ...S.btn("ghost"), padding: "8px 10px", fontSize: 12 }} onClick={exportCsv}>{t("histCsv")}</button>}
          </div>
          {h.all === 0 ? (
            <p style={{ color: "var(--text-muted,#5F7A91)", fontSize: 13 }}>{t("eqNoHistory")}</p>
          ) : h.total === 0 ? (
            <p style={{ color: "var(--text-muted,#5F7A91)", fontSize: 13 }}>{t("histNoMatch")}</p>
          ) : (
            <div style={S.col}>
              {h.rows.map((c, i) => (
                <div key={c.id || i} style={{ ...S.card, background: "var(--surface2,#EAF0F7)", display: "flex", gap: 16, alignItems: "flex-start" }}>
                  <span style={{ ...S.badge(isPickEvt(c.type) ? "amber" : isLostEvt(c.type) ? "red" : "green"), flexShrink: 0 }}>{isPickEvt(c.type) ? "PICK" : isLostEvt(c.type) ? "LOST" : "RETURN"}</span>
                  <div style={{ flex: 1 }}>
                    <p style={{ margin: 0, fontWeight: 600, fontSize: 13 }}>{c.jobName}</p>
                    <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--text-muted,#5F7A91)" }}>{formatDateTime(c.ts)} · {c.employeeName} · Qty: {c.qty}{c.condition && c.condition !== "ok" && conditionKey(c.condition) ? ` · ${t(conditionKey(c.condition))}` : ""}</p>
                    {c.note && <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--text,#16324A)" }}>“{c.note}”</p>}
                    <LazyPhoto field="checkouts" id={c.id} photo={c.photo} hasPhoto={c.hasPhoto} alt="evidence" style={{ width: 120, borderRadius: 6, marginTop: 8 }} />
                    {c.location && <p style={{ fontSize: 11, color: "#2563EB", margin: "4px 0 0" }}>GPS: {c.location.lat}, {c.location.lng}</p>}
                  </div>
                </div>
              ))}
              {h.total > h.rows.length && (
                <button style={{ ...S.btn("ghost"), alignSelf: "center" }} onClick={() => setHistLimit(n => n + 20)}>{t("histLoadMore")} ({h.total - h.rows.length})</button>
              )}
            </div>
          )}
        </Modal>
        );
      })()}
      </>}
    </div>
  );
}

// ─── PRODUCTION COMBOBOX ─────────────────────────────────────────────────────
export function ProductionCombobox({ value, onChange, companies }) {
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
        <div style={{ position: "absolute", top: "calc(100% + 3px)", left: 0, right: 0, zIndex: 300, background: "var(--surface,#FFFFFF)", border: "var(--card-border,1px solid #D8E1EC)", borderRadius: "var(--btn-radius,7px)", boxShadow: "0 8px 24px rgba(22,50,74,0.14)", overflow: "hidden", maxHeight: 200, overflowY: "auto" }}>
          {filtered.map((co, i) => (
            <div
              key={co.id}
              onMouseDown={() => select(co.name)}
              style={{ padding: "10px 14px", cursor: "pointer", fontSize: 13, color: "var(--text,#16324A)", borderBottom: i < filtered.length - 1 ? "1px solid var(--divider-color,#D8E1EC)" : "none", background: co.name === value ? "rgba(var(--accent-rgb,37,99,235),0.08)" : "transparent" }}
            >
              <div style={{ fontWeight: co.name === value ? 700 : 400 }}>{co.name}</div>
              {co.address && <div style={{ fontSize: 11, color: "var(--text-muted,#5F7A91)", marginTop: 2 }}>{co.address.split("\n")[0]}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── SHARED JOB FORM MODAL ────────────────────────────────────────────────────
export function JobFormModal({ editTarget, jobs, setJobs, productionCompanies, employees, lineGroupId, lineNotifyMuted, onClose, equipment, checkouts, equipmentRequests, reports }) {
  const t = useT();
  const [conflicts, setConflicts] = useState(null); // P1-9: gear conflicts found on save
  const conflictRef = useRef(null);
  useEffect(() => { if (conflicts && conflictRef.current) conflictRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [conflicts]);
  const CONTACT_PLATFORMS = ["Line", "Facebook", "WhatsApp", "Instagram", "Phone"];
  const EMPTY = { name: "", production: "", dates: [], status: "Pencil", shootTime: "Day", location: "Local (Bangkok)", locationCity: "", contactPerson: "", contactPlatform: "Line", dateOverrides: {}, pickupDate: "", returnDate: "", crew: [] };
  const [form, setForm] = useState(editTarget ? { ...editTarget, dateOverrides: editTarget.dateOverrides || {}, crew: Array.isArray(editTarget.crew) ? editTarget.crew.map(r => ({ ...EMPTY_CREW_ROW, ...r })) : [] } : EMPTY);
  const lang = useContext(LangCtx);
  const roleList = useRoleList(lang);
  // Crew roster rows (P1-10): employee + role + pickup / call time. Rows are kept
  // loose while editing; normalizeCrew() drops blank / duplicate ones on save.
  const setCrewRow = (idx, patch) => setForm(p => ({ ...p, crew: (p.crew || []).map((r, i) => i === idx ? { ...r, ...patch } : r) }));
  const addCrewRow = () => setForm(p => ({ ...p, crew: [...(p.crew || []), { ...EMPTY_CREW_ROW }] }));
  const removeCrewRow = (idx) => setForm(p => ({ ...p, crew: (p.crew || []).filter((_, i) => i !== idx) }));
  const [jobErr, setJobErr] = useState("");
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const d = editTarget?.dates?.[0] ? new Date(editTarget.dates[0] + "T00:00:00") : new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  const toggleDate = (ds) => setForm(p => {
    const removing = p.dates.includes(ds);
    const newDates = removing ? p.dates.filter(d => d !== ds) : [...p.dates, ds].sort();
    const newOv = { ...(p.dateOverrides || {}) };
    if (removing) delete newOv[ds];
    return { ...p, dates: newDates, dateOverrides: newOv };
  });

  const setDateOverride = (ds, field, value) => setForm(p => {
    const ovs = { ...(p.dateOverrides || {}) };
    const cur = { ...(ovs[ds] || {}) };
    if (value) {
      cur[field] = value;
      if (field === "location" && value === "Local (Bangkok)") delete cur.locationCity;
    } else {
      delete cur[field];
    }
    if (Object.keys(cur).length === 0) delete ovs[ds]; else ovs[ds] = cur;
    return { ...p, dateOverrides: ovs };
  });

  const saveJob = (force = false) => {
    if (!form.name.trim()) { setJobErr(t("jobErrName")); return; }
    if (form.dates.length === 0) { setJobErr(t("jobErrDates")); return; }
    setJobErr("");
    const isNew = !editTarget;
    const statusChanged = editTarget && editTarget.status !== form.status;
    // Pickup day only counts before the first shoot day; return day only after the last
    const sorted = [...form.dates].sort();
    const clean = {
      ...form,
      pickupDate: form.pickupDate && form.pickupDate < sorted[0] ? form.pickupDate : "",
      returnDate: form.returnDate && form.returnDate > sorted[sorted.length - 1] ? form.returnDate : "",
      crew: normalizeCrew(form.crew),
    };
    // The roster is the default for the checkout lanes: a new roster (or a changed
    // one) re-derives checkoutRoles; the Assign Gear modal can still override it.
    const changes = jobChangeSet(editTarget, clean);
    if (isNew || changes.includes("roster")) clean.checkoutRoles = defaultCheckoutRoles(clean);
    // P1-9: a date / status / window edit re-checks the job's OWN gear against
    // everything else (other Confirmed jobs across their windows, gear still out,
    // loans, open damage) and names the colliding jobs before anything is saved.
    if (editTarget && !force && (editTarget.assignedEquipment || []).length > 0 && (clean.status === "Confirmed" || clean.status === "Pencil")) {
      const windowChanged = statusChanged
        || JSON.stringify([...(editTarget.dates || [])].sort()) !== JSON.stringify(sorted)
        || (editTarget.pickupDate || "") !== clean.pickupDate || (editTarget.returnDate || "") !== clean.returnDate;
      if (windowChanged) {
        const candidate = { ...editTarget, ...clean };
        const found = jobConflicts(candidate, equipment || [], { jobs: jobs || [], checkouts: checkouts || [], equipmentRequests: equipmentRequests || [], reports: reports || [], today: today() });
        if (found.length) { setConflicts(found); return; }
      }
    }
    setConflicts(null);
    if (editTarget) {
      setJobs(p => p.map(j => j.id === editTarget.id ? { ...j, ...clean } : j));
    } else {
      setJobs(p => [...p, { ...clean, id: "job" + Date.now(), assignedEquipment: [] }]);
    }
    // LINE push only when something the crew cares about changed (new job, dates,
    // status, location, roster); a contact-person tweak stays silent (P1-10).
    if (!lineNotifyMuted && shouldNotify(changes)) {
      const formatDates = (dates) => {
        const groups = {};
        [...(dates || [])].sort().forEach(d => {
          const dt = new Date(d + "T00:00:00");
          const key = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}`;
          const label = dt.toLocaleString("en-GB", { month: "short" });
          if (!groups[key]) groups[key] = { label, days: [] };
          groups[key].days.push(dt.getDate());
        });
        return Object.keys(groups).sort().map(k => `${groups[k].label} ${groups[k].days.join(",")}`).join(". ");
      };
      const msg = buildJobMessage(clean, { changes, employees: employees || [], formatDates });
      const to = pushRecipients(clean, employees || [], lineGroupId);
      // No group connected: the roster (or everyone) on their own LINE, resolved server-side (P3-6).
      const employeeIds = to.length ? [] : pushEmployeeIds(clean, employees || []).filter(id => (employees || []).some(e => e && e.id === id && e.lineLinked));
      if (to.length > 0 || employeeIds.length > 0) api.notify({ userIds: to, employeeIds, message: msg });
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
        <div data-testid="job-calendar" style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
          {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map(d => <div key={d} style={{ textAlign: "center", fontSize: 10, color: "var(--text-muted,#5F7A91)", fontWeight: 600, paddingBottom: 4 }}>{d}</div>)}
          {cells.map((d, i) => {
            if (!d) return <div key={"e" + i} />;
            const ds = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
            const selected = form.dates.includes(ds);
            const isToday = ds === todayStr;
            return (
              <div key={d} onClick={() => toggleDate(ds)} style={{ textAlign: "center", padding: "7px 0", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: selected ? 700 : 400, background: selected ? "var(--accent,#2563EB)" : isToday ? "rgba(var(--accent-rgb,37,99,235),0.1)" : "transparent", color: selected ? "var(--accent-text,#FFFFFF)" : isToday ? "var(--accent,#2563EB)" : "var(--text,#16324A)", border: isToday && !selected ? "1px solid rgba(var(--accent-rgb,37,99,235),0.3)" : "1px solid transparent" }}>
                {d}
              </div>
            );
          })}
        </div>
        {form.dates.length > 0 && (
          <p style={{ fontSize: 11, color: "var(--accent,#2563EB)", marginTop: 10 }}>{tCount(t, "datesSelected", form.dates.length)} {form.dates.map(formatDate).join(", ")}</p>
        )}
      </div>
    );
  };

  return (
    <Modal title={editTarget ? t("editJob") : t("newJob")} onClose={onClose} wide>
      <div style={S.col}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div style={{ gridColumn: "1/-1" }}><label style={S.label}>{t("jobNameField")}</label><input style={S.input} value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. TVC Toyota Hero Film" /></div>
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

        {/* Pickup / return window around the shoot days */}
        {form.dates.length > 0 && (() => {
          const sorted = [...form.dates].sort();
          const first = sorted[0], last = sorted[sorted.length - 1];
          return (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={S.label}>Pickup day <span style={{ color: "var(--text-muted,#5F7A91)", fontWeight: 400 }}>(optional, before job day)</span></label>
                <input type="date" style={S.input} value={form.pickupDate || ""} max={addDaysStr(first, -1)} onChange={e => setForm(p => ({ ...p, pickupDate: e.target.value }))} />
                <p style={{ margin: "4px 0 0", fontSize: 10, color: "var(--text-muted,#5F7A91)" }}>Crew can pick up from this day. Default: first shoot day ({formatDate(first)}).</p>
              </div>
              <div>
                <label style={S.label}>Return day <span style={{ color: "var(--text-muted,#5F7A91)", fontWeight: 400 }}>(optional, after job day)</span></label>
                <input type="date" style={S.input} value={form.returnDate || ""} min={addDaysStr(last, 1)} onChange={e => setForm(p => ({ ...p, returnDate: e.target.value }))} />
                <p style={{ margin: "4px 0 0", fontSize: 10, color: "var(--text-muted,#5F7A91)" }}>Gear due back by this day. Default: last shoot day ({formatDate(last)}).</p>
              </div>
            </div>
          );
        })()}

        {/* Crew roster (P1-10): who is on this job, their role and times */}
        <div data-testid="job-crew">
          <label style={S.label}>{t("jobCrewField")} <span style={{ color: "var(--text-muted,#5F7A91)", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>({t("jobCrewHint")})</span></label>
          {(form.crew || []).length === 0 && <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--text-muted,#5F7A91)" }}>{t("jobCrewEmpty")}</p>}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {(form.crew || []).map((row, idx) => {
              const taken = new Set((form.crew || []).filter((_, i) => i !== idx).map(r => r.employeeId));
              return (
                <div key={idx} data-testid="crew-row" style={{ display: "grid", gridTemplateColumns: "minmax(120px,1.3fr) minmax(110px,1.2fr) 92px 92px 32px", gap: 6, alignItems: "center", padding: "7px 10px", borderRadius: 8, border: "1px solid var(--border-color,#D8E1EC)", background: "var(--surface2,#EAF0F7)" }}>
                  <select style={{ ...S.select, fontSize: 12, padding: "7px 8px" }} value={row.employeeId || ""} onChange={e => setCrewRow(idx, { employeeId: e.target.value })} aria-label={t("jobCrewMember")}>
                    <option value="">{t("jobCrewPick")}</option>
                    {(employees || []).filter(emp => !taken.has(emp.id) || emp.id === row.employeeId).map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
                  </select>
                  <input style={{ ...S.input, fontSize: 12, padding: "7px 8px" }} list={"crew-roles-" + idx} value={row.role || ""} onChange={e => setCrewRow(idx, { role: e.target.value })} placeholder={t("jobCrewRole")} aria-label={t("jobCrewRole")} />
                  <datalist id={"crew-roles-" + idx}>{roleList.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}</datalist>
                  <input type="time" style={{ ...S.input, fontSize: 12, padding: "7px 6px" }} value={row.pickupTime || ""} onChange={e => setCrewRow(idx, { pickupTime: e.target.value })} title={t("jobCrewPickupTime")} aria-label={t("jobCrewPickupTime")} />
                  <input type="time" style={{ ...S.input, fontSize: 12, padding: "7px 6px" }} value={row.callTime || ""} onChange={e => setCrewRow(idx, { callTime: e.target.value })} title={t("jobCrewCallTime")} aria-label={t("jobCrewCallTime")} />
                  <button style={{ ...S.btn("ghost"), padding: "5px 7px", fontSize: 12, justifyContent: "center" }} onClick={() => removeCrewRow(idx)} title={t("jobCrewRemove")}>✕</button>
                </div>
              );
            })}
          </div>
          {(form.crew || []).length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "minmax(120px,1.3fr) minmax(110px,1.2fr) 92px 92px 32px", gap: 6, padding: "2px 10px 0", fontSize: 10, color: "var(--text-muted,#5F7A91)" }}>
              <span>{t("jobCrewMember")}</span><span>{t("jobCrewRole")}</span><span>{t("jobCrewPickupTime")}</span><span>{t("jobCrewCallTime")}</span><span />
            </div>
          )}
          <button style={{ ...S.btn("ghost"), fontSize: 12, marginTop: 8 }} onClick={addCrewRow} disabled={(employees || []).length === 0} data-testid="add-crew">
            <Icon d={icons.plus} size={13} /> {t("jobCrewAdd")}
          </button>
        </div>

        {/* Per-date location / time overrides */}
        {form.dates.length > 0 && (
          <div>
            <label style={S.label}>Per-date overrides <span style={{ color: "var(--text-muted,#5F7A91)", fontWeight: 400 }}>(optional, overrides the defaults above for specific dates)</span></label>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {[...form.dates].sort().map(ds => {
                const ov = (form.dateOverrides || {})[ds] || {};
                const effLoc = ov.location || form.location;
                const hasOv = !!(ov.location || ov.shootTime);
                return (
                  <div key={ds} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 10px", borderRadius: 8, background: hasOv ? "rgba(var(--accent-rgb,37,99,235),0.05)" : "transparent", border: `1px solid ${hasOv ? "rgba(var(--accent-rgb,37,99,235),0.2)" : "var(--border-color,#D8E1EC)"}`, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12, color: "var(--text,#16324A)", minWidth: 70, fontWeight: hasOv ? 600 : 400 }}>{formatDate(ds)}</span>
                    <select style={{ ...S.select, flex: 1, minWidth: 120, fontSize: 11 }} value={ov.location || ""} onChange={e => setDateOverride(ds, "location", e.target.value)}>
                      <option value="">Default ({form.location})</option>
                      {LOCATIONS.map(l => <option key={l} value={l}>{l}</option>)}
                    </select>
                    {effLoc !== "Local (Bangkok)" && (
                      <input style={{ ...S.input, flex: 1, minWidth: 100, fontSize: 11, padding: "6px 10px" }} value={ov.locationCity || ""} onChange={e => setDateOverride(ds, "locationCity", e.target.value)} placeholder={effLoc === "Overseas" ? "Country / City" : "Province / City"} />
                    )}
                    <select style={{ ...S.select, flex: 1, minWidth: 120, fontSize: 11 }} value={ov.shootTime || ""} onChange={e => setDateOverride(ds, "shootTime", e.target.value)}>
                      <option value="">Default ({form.shootTime})</option>
                      {SHOOT_TIMES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    {hasOv && (
                      <button style={{ ...S.btn("ghost"), padding: "3px 7px", fontSize: 11, flexShrink: 0 }} onClick={() => setForm(p => { const o = { ...(p.dateOverrides || {}) }; delete o[ds]; return { ...p, dateOverrides: o }; })}>✕</button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {jobErr && <p style={{ color: "#C53030", fontSize: 12, margin: "0 0 6px", fontWeight: 600, textAlign: "right" }}>{jobErr}</p>}
        {conflicts && conflicts.length > 0 && (() => {
          const hard = conflicts.filter(c => !c.soft), soft = conflicts.filter(c => c.soft);
          const row = (c) => (
            <div key={c.eqId} style={{ padding: "8px 10px", borderRadius: 8, background: "var(--surface,#FFFFFF)", border: "1px solid var(--border-color,#D8E1EC)", marginBottom: 6 }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: c.soft ? "var(--accent,#2563EB)" : "#C53030" }}>
                {c.eq.name} · {t("jobConflictNeed").replace("{n}", c.need).replace("{a}", c.available).replace("{date}", c.worstDate ? formatDate(c.worstDate) : "")}
              </p>
              {describeReasons(c.reasons, t).map((l, i) => <p key={i} style={{ margin: "3px 0 0", fontSize: 12, color: "var(--text,#16324A)" }}>· {l}</p>)}
            </div>
          );
          return (
            <div ref={conflictRef} data-testid="job-conflict" style={{ padding: "12px 14px", borderRadius: 10, background: hard.length ? "rgba(197,48,48,0.06)" : "rgba(var(--accent-rgb,37,99,235),0.06)", border: `1px solid ${hard.length ? "rgba(197,48,48,0.35)" : "rgba(var(--accent-rgb,37,99,235),0.3)"}` }}>
              <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 800, color: hard.length ? "#C53030" : "var(--accent,#2563EB)" }}>⚠ {t("jobConflictTitle")}</p>
              {hard.length > 0 && <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--text,#16324A)" }}>{t("jobConflictIntro")}</p>}
              {hard.map(row)}
              {soft.length > 0 && <p style={{ margin: "6px 0 8px", fontSize: 12, color: "var(--text,#16324A)" }}>{t("jobConflictSoftIntro")}</p>}
              {soft.map(row)}
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 10 }}>
                <button style={S.btn("ghost")} onClick={() => setConflicts(null)}>{t("jobConflictBack")}</button>
                <button style={S.btn(hard.length ? "danger" : "primary")} onClick={() => saveJob(true)}>{t("jobConflictSaveAnyway")}</button>
              </div>
            </div>
          );
        })()}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button style={S.btn("ghost")} onClick={onClose}>{t("cancel")}</button>
          <button style={S.btn("primary")} onClick={() => saveJob(false)}>{t("saveJob")}</button>
        </div>
      </div>
    </Modal>
  );
}

export function JobsPage({ jobs, setJobs, equipment, checkouts, productionCompanies, employees, lineGroupId, lineNotifyMuted, verificationConfig, equipmentRequests, reports }) {
  const t = useT();
  const [modal, setModal] = useState(null);
  const [editTarget, setEditTarget] = useState(null);
  const [assignTarget, setAssignTarget] = useState(null);
  const [selectedJob, setSelectedJob] = useState(null);
  const [assignForm, setAssignForm] = useState({});
  const [assignCheckoutMode, setAssignCheckoutMode] = useState("span");
  // checkoutRoles: { barcode: "anyone"|[id,...], photo: "anyone"|[id,...] }
  const [assignRoles, setAssignRoles] = useState({ barcode: "anyone", photo: "anyone" });

  const [statusTab, setStatusTab] = useState("Pencil");

  const openAdd = () => { setEditTarget(null); setModal("form"); };
  const openEdit = (job) => { setEditTarget(job); setModal("form"); };
  const del = (id) => {
    // P1-12: never delete a job whose gear is still out. The Not Returned list is
    // computed from the checkout log (survives a deleted job), but the record
    // itself (dates, crew, client) should stay: steer to Cancelled instead.
    const out = unitsOutForJob(checkouts, id);
    if (out > 0) {
      if (window.confirm(t("jobDeleteBlocked").replace("{n}", out) + "\n\n" + t("jobDeleteCancelInstead"))) {
        setJobs(p => p.map(j => j.id === id ? { ...j, status: "Cancelled" } : j));
      }
      return;
    }
    if (window.confirm(t("jobDeleteConfirm"))) {
      const job = jobs.find(j => j.id === id);
      setJobs(p => p.filter(j => j.id !== id));
      api.audit({ action: "job.delete", recordId: id, name: job ? job.name : "", detail: job ? (job.dates || []).join(",") : "" }); // actor stamp (P2-6)
    }
  };

  const openAssign = (job) => {
    const init = {};
    (job.assignedEquipment || []).forEach(ae => { init[ae.eqId] = ae.qty; });
    setAssignForm(init);
    setAssignTarget(job);
    setAssignCheckoutMode(job.checkoutMode || "span");
    setAssignRoles(job.checkoutRoles || defaultCheckoutRoles(job)); // roster = default lanes (P1-10)
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

  const statusColor = JOB_STATUS_BADGE;
  const locationColor = { "Local (Bangkok)": "green", "Out of Town": "amber", "Overseas": "blue" };

  const getCheckoutSummary = (job) => {
    const jobCheckouts = checkouts.filter(c => c.jobId === job.id);
    const outCount = (job.assignedEquipment || []).length;
    const picked = new Set(jobCheckouts.filter(c => isPickEvt(c.type)).map(c => c.eqId)).size;
    const returned = new Set(jobCheckouts.filter(c => isReturnEvt(c.type)).map(c => c.eqId)).size;
    return { outCount, picked, returned };
  };

  const tabJobs = statusTab === "all" ? jobs.filter(j => j.status !== "Declined") : jobs.filter(j => j.status === statusTab);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <h1 style={S.pageTitle}>{t("jobBookings")}</h1>
          <p style={S.pageSubtitle}>{jobs.filter(j => j.status === "Confirmed").length} {t("dashConfirmedLabel")} · {jobs.filter(j => j.status === "Pencil").length} {t("dashPencilLabel")}</p>
        </div>
        <button style={S.btn("primary")} onClick={openAdd}><Icon d={icons.plus} size={15} /> {t("jobNewJob")}</button>
      </div>

      {/* Status tabs */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        {[["Pencil", "amber"], ["Confirmed", "green"], ["Cancelled", "red"], ["all", null]].map(([key, color]) => {
          const count = key === "all" ? jobs.filter(j => j.status !== "Declined").length : jobs.filter(j => j.status === key).length;
          const isActive = statusTab === key;
          return (
            <button key={key} onClick={() => setStatusTab(key)}
              style={{ ...S.btn(isActive ? "primary" : "ghost"), padding: "7px 14px", fontSize: 12 }}>
              {key === "all" ? `All (${count})` : `${key} (${count})`}
            </button>
          );
        })}
        {(() => {
          const count = jobs.filter(j => j.status === "Declined").length;
          if (count === 0 && statusTab !== "Declined") return null;
          return (
            <button onClick={() => setStatusTab("Declined")}
              style={{ ...S.btn(statusTab === "Declined" ? "danger" : "ghost"), padding: "7px 14px", fontSize: 12 }}>
              Declined ({count})
            </button>
          );
        })()}
      </div>

      {/* Job list */}
      <div style={S.col}>
        {tabJobs.length === 0 && <p style={{ color: "var(--text-muted,#5F7A91)", fontSize: 13 }}>{t("jobNoJobs")}</p>}
        {tabJobs.sort((a, b) => (b.dates[0] || "") > (a.dates[0] || "") ? 1 : -1).map(job => {
          const { outCount, picked, returned } = getCheckoutSummary(job);
          const todayDates = job.dates.filter(d => d >= today());
          return (
            <div key={job.id} style={{ ...S.card, cursor: "pointer" }} onClick={() => setSelectedJob(selectedJob?.id === job.id ? null : job)}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  {(() => {
                    const ovCount = Object.keys(job.dateOverrides || {}).length;
                    return (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                        <span style={S.badge(statusColor[job.status] || "gray")}>{job.status}</span>
                        <span style={S.badge(locationColor[job.location] || "gray")}>{job.location}{job.locationCity ? ` · ${job.locationCity}` : ""}{ovCount > 0 ? " ±" : ""}</span>
                        <span style={S.badge("gray")}>{job.shootTime}{ovCount > 0 ? " ±" : ""}</span>
                        {job.checkoutMode === "daily" && <span style={S.badge("blue")}>{t("jobDailyReturn")}</span>}
                      </div>
                    );
                  })()}
                  <h3 style={{ margin: "0 0 2px", fontSize: 16, fontWeight: 700 }}>{job.name}</h3>
                  <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted,#5F7A91)" }}>{job.production}</p>
                  <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--text-muted,#4E6B84)" }}>
                    {tCount(t, "countDays", job.dates.length)} · {job.dates[0] ? formatDate(job.dates[0]) : "No date"}{job.dates.length > 1 ? ` → ${formatDate(job.dates[job.dates.length - 1])}` : ""}
                  </p>
                  {outCount > 0 && <p style={{ margin: "4px 0 0", fontSize: 11, color: "#2563EB" }}>{outCount} assigned · {picked} picked · {returned} returned</p>}
                  {hasRoster(job)
                    ? <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--text-muted,#4E6B84)" }} data-testid="job-crew-line"><Icon d={icons.user} size={11} style={{ verticalAlign: "-2px", marginRight: 3 }} />{crewNames(job, employees).join(", ")}</p>
                    : <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--text-muted,#8CA2B5)" }}><Icon d={icons.user} size={11} style={{ verticalAlign: "-2px", marginRight: 3 }} />{t("jobNoCrewYet")}</p>}
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                  {(job.status === "Confirmed" || job.status === "Pencil") && <button style={{ ...S.btn(job.status === "Confirmed" ? "success" : "ghost"), padding: "6px 10px", fontSize: 12 }} onClick={() => openAssign(job)}><Icon d={icons.gear} size={13} /> {t("jobAssignGear")}</button>}
                  <button style={{ ...S.btn("ghost"), padding: "6px 8px" }} onClick={() => openEdit(job)} data-testid={"job-edit-" + job.id} title={t("editJob")}><Icon d={icons.edit} size={14} /></button>
                  <button style={{ ...S.btn("danger"), padding: "6px 8px" }} onClick={() => del(job.id)}><Icon d={icons.trash} size={14} /></button>
                </div>
              </div>

              {selectedJob?.id === job.id && (
                <div style={{ marginTop: 16 }}>
                  <div style={S.divider} />
                  <p style={S.sectionTitle}>{t("jobProductionDates")}</p>
                  {(() => {
                    const todayStr = today();
                    const ovs = job.dateOverrides || {};
                    // Group dates by effective (location, shootTime)
                    const groups = {};
                    [...job.dates].sort().forEach(d => {
                      const ov = ovs[d] || {};
                      const loc = ov.location || job.location;
                      const locCity = ov.locationCity || (ov.location ? "" : job.locationCity);
                      const time = ov.shootTime || job.shootTime;
                      const key = `${loc}||${locCity}||${time}`;
                      if (!groups[key]) groups[key] = { loc, locCity, time, dates: [] };
                      groups[key].dates.push(d);
                    });
                    const groupList = Object.values(groups);
                    const multiGroup = groupList.length > 1;
                    return groupList.map((g, gi) => (
                      <div key={gi} style={{ marginBottom: multiGroup ? 10 : 0 }}>
                        {multiGroup && (
                          <div style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
                            <span style={S.badge(locationColor[g.loc] || "gray")}>{g.loc}{g.locCity ? ` · ${g.locCity}` : ""}</span>
                            <span style={S.badge("gray")}>{g.time}</span>
                          </div>
                        )}
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {g.dates.map(d => (
                            <span key={d} style={S.badge("gray")}>{formatDate(d)}{d === todayStr ? " ★" : ""}</span>
                          ))}
                        </div>
                      </div>
                    ));
                  })()}
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
        <JobFormModal editTarget={editTarget} jobs={jobs} setJobs={setJobs} productionCompanies={productionCompanies} employees={employees} lineGroupId={lineGroupId} lineNotifyMuted={lineNotifyMuted} onClose={() => setModal(null)} equipment={equipment} checkouts={checkouts} equipmentRequests={equipmentRequests} reports={reports} />
      )}

      {/* Assign Equipment Modal — kanban style */}
      {modal === "assign" && assignTarget && (
        <Modal title={`${t("jobAssignGear")}: ${assignTarget.name}`} onClose={() => setModal(null)} wide>
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
                    border: assignCheckoutMode === id ? "1.5px solid var(--accent,#2563EB)" : "1.5px solid var(--border-color,#D8E1EC)",
                    background: assignCheckoutMode === id ? "rgba(var(--accent-rgb,37,99,235),0.07)" : "var(--surface2,#EAF0F7)",
                    transition: "all 0.12s" }}>
                  <p style={{ margin: 0, fontWeight: 700, fontSize: 12, color: assignCheckoutMode === id ? "var(--accent,#2563EB)" : "var(--text,#16324A)" }}>{label}</p>
                  <p style={{ margin: "3px 0 0", fontSize: 10, color: "var(--text-muted,#5F7A91)", lineHeight: 1.4 }}>{desc}</p>
                </div>
              ))}
            </div>
          </div>
          <p style={{ fontSize: 12, color: "var(--text-muted,#4E6B84)", marginBottom: assignTarget.status === "Pencil" ? 8 : 16 }}>{t("jobTapAssign")}</p>
          {assignTarget.status === "Pencil" && (
            <p style={{ fontSize: 12, color: "var(--accent,#2563EB)", margin: "0 0 14px", padding: "8px 12px", borderRadius: 8, background: "rgba(var(--accent-rgb,37,99,235),0.07)", border: "1px solid rgba(var(--accent-rgb,37,99,235),0.2)" }}>✏️ {t("assignPencilNote")}</p>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {(() => {
              // Availability across the job's WHOLE gear window (pickup..return, worst
              // day), from the one shared model: other Confirmed jobs, gear still out,
              // approved loans and open damage reports all subtract; Pencil holds are
              // shown separately; a negative number is a red conflict, never clamped.
              const spanDates = jobHoldDatesOf(assignTarget);
              const avMap = Object.fromEntries(
                calcAvailableSpan(equipment, spanDates, { jobs, checkouts, equipmentRequests, reports }, { excludeJobId: assignTarget.id }).map(a => [a.id, a])
              );
              return equipment.map(eq => {
              const avForEq = avMap[eq.id] || { available: eq.total, total: eq.total, pencil: 0, reasons: [], hard: {} };
              const currentQty = +assignForm[eq.id] || 0;
              const maxAvail = avForEq.available;      // signed: < 0 means already over-booked
              const cap = Math.max(0, maxAvail);        // how many this job can still take
              const isAssigned = currentQty > 0;
              const isMulti = eq.total > 1;
              const hasDamage = (avForEq.hard && avForEq.hard.damage > 0);
              const reasonLines = describeReasons(avForEq.reasons, t);

              return (
                <div key={eq.id}
                  onClick={() => {
                    if (!isAssigned && cap === 0) return; // can't assign, none available
                    if (!isAssigned) setAssignForm(p => ({ ...p, [eq.id]: 1 }));
                    else setAssignForm(p => ({ ...p, [eq.id]: 0 }));
                  }}
                  style={{
                    display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 10,
                    border: isAssigned ? "1.5px solid var(--accent,#2563EB)" : maxAvail < 0 ? "1.5px solid rgba(197,48,48,0.5)" : cap === 0 ? "1.5px solid var(--divider-color,#D8E1EC)" : "1.5px solid var(--border-color,#D8E1EC)",
                    background: isAssigned ? "rgba(var(--accent-rgb,37,99,235),0.07)" : maxAvail < 0 ? "rgba(197,48,48,0.06)" : cap === 0 ? "rgba(22,50,74,0.07)" : "var(--surface2,#EAF0F7)",
                    cursor: cap === 0 && !isAssigned ? "not-allowed" : "pointer",
                    opacity: cap === 0 && !isAssigned && maxAvail >= 0 ? 0.45 : 1,
                    transition: "all 0.12s",
                  }}>

                  {/* Checkbox-style indicator */}
                  <div style={{ width: 22, height: 22, borderRadius: 6, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                    background: isAssigned ? "var(--accent,#2563EB)" : "var(--surface,#FFFFFF)", border: isAssigned ? "none" : "1.5px solid var(--border-color,#D8E1EC)" }}>
                    {isAssigned && <Icon d={icons.check} size={13} color="var(--accent-text,#FFFFFF)" strokeW={3} />}
                  </div>

                  {/* Thumbnail */}
                  {eq.photo
                    ? <img src={eq.photo} alt="" style={{ width: 40, height: 36, objectFit: "cover", borderRadius: 6, flexShrink: 0 }} />
                    : <div style={{ width: 40, height: 36, borderRadius: 6, background: "var(--divider-color,#D8E1EC)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <Icon d={icons.camera} size={14} color="var(--text-muted,#8CA2B5)" />
                      </div>
                  }

                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontWeight: 600, fontSize: 13, color: isAssigned ? "var(--accent,#2563EB)" : "var(--text,#16324A)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{eq.name}</p>
                    <p style={{ margin: "2px 0 0", fontSize: 11, color: maxAvail < 0 ? "#C53030" : "var(--text-muted,#5F7A91)", fontWeight: maxAvail < 0 ? 700 : 400 }}>
                      {eq.category}
                      {maxAvail < 0 ? ` · ${t("avConflict")} · ${t("avOverbooked").replace("{n}", -maxAvail)}` : isMulti ? ` · ${t("avFree").replace("{a}", maxAvail).replace("{t}", eq.total)}` : maxAvail === 0 ? ` · ${t("jobUnavailable")}` : ` · ${t("jobAvailable")}`}
                      {avForEq.worstDate && spanDates.length > 1 && maxAvail < eq.total ? ` · ${t("avWorstDay").replace("{date}", formatDate(avForEq.worstDate))}` : ""}
                    </p>
                    {hasDamage && <p style={{ margin: "3px 0 0", fontSize: 11, fontWeight: 700, color: "#C53030" }}>⚠ {t("assignDamageBanner")}</p>}
                    {reasonLines.length > 0 && (
                      <div style={{ marginTop: 3 }}>
                        {reasonLines.map((l, i) => <p key={i} style={{ margin: 0, fontSize: 10, lineHeight: 1.35, color: (avForEq.reasons[i] || {}).kind === "pencil" ? "var(--accent,#2563EB)" : "var(--text-muted,#5F7A91)" }}>· {l}</p>)}
                      </div>
                    )}
                  </div>

                  {/* Qty stepper — only for multi-unit items when assigned */}
                  {isMulti && isAssigned && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}
                      onClick={e => e.stopPropagation()}>
                      <button
                        style={{ width: 28, height: 28, borderRadius: 6, border: "1px solid var(--border-color,#D8E1EC)", background: "var(--surface,#FFFFFF)", color: "var(--text,#16324A)", fontSize: 16, lineHeight: 1, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                        onClick={() => setAssignForm(p => { const n = Math.max(1, (p[eq.id] || 1) - 1); return { ...p, [eq.id]: n }; })}>−</button>
                      <span style={{ minWidth: 20, textAlign: "center", fontWeight: 700, fontSize: 14, color: currentQty > cap ? "#C53030" : "var(--accent,#2563EB)" }}>{currentQty}</span>
                      <button
                        style={{ width: 28, height: 28, borderRadius: 6, border: "1px solid var(--border-color,#D8E1EC)", background: "var(--surface,#FFFFFF)", color: "var(--text,#16324A)", fontSize: 16, lineHeight: 1, cursor: currentQty >= cap ? "not-allowed" : "pointer", opacity: currentQty >= cap ? 0.4 : 1, display: "flex", alignItems: "center", justifyContent: "center" }}
                        onClick={() => setAssignForm(p => ({ ...p, [eq.id]: Math.min(Math.max(cap, p[eq.id] || 0), (p[eq.id] || 1) + 1) }))}>+</button>
                    </div>
                  )}
                </div>
              );
              });
            })()}
          </div>

          {/* Verification roles — only shown when mode is barcode or both */}
          {(vMode === "barcode" || vMode === "both") && (
            <div style={{ marginTop: 18, padding: "14px", background: "rgba(var(--accent-rgb,37,99,235),0.04)", border: "1px solid rgba(var(--accent-rgb,37,99,235),0.15)", borderRadius: 10 }}>
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
                    <p style={{ fontSize: 12, color: "var(--text-muted,#4E6B84)", marginBottom: 6 }}>{label}</p>
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
                              style={{ fontSize: 11, padding: "5px 12px", borderRadius: 16, border: `1px solid ${selected ? "var(--accent,#2563EB)" : "var(--border-color,#D8E1EC)"}`, background: selected ? "rgba(var(--accent-rgb,37,99,235),0.15)" : "var(--surface2,#EAF0F7)", color: selected ? "var(--accent,#2563EB)" : "var(--text-muted,#4E6B84)", cursor: "pointer" }}>
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
            <div style={{ marginTop: 14, padding: "10px 14px", background: "rgba(var(--accent-rgb,37,99,235),0.06)", border: "1px solid rgba(var(--accent-rgb,37,99,235),0.15)", borderRadius: 8 }}>
              <p style={{ margin: 0, fontSize: 11, color: "var(--accent,#2563EB)", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>{t("jobAssigned")}</p>
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

// ─── DASHBOARD PAGE ───────────────────────────────────────────────────────────
export function DashboardPage({ jobs, setJobs, equipment, checkouts, setCheckouts, productionCompanies, employees, equipmentRequests, setEquipmentRequests, adminRequests, approveAdminRequest, rejectAdminRequest, pendingAdminCount, lineGroupId, lineNotifyMuted, deleteRecord, reports, onReceive, onOpenReports }) {
  const t = useT();
  const wide = useMinWidth(1024);   // 2-column layout (P2-11)
  const phone = !useMinWidth(768);  // FAB + jump banner only here
  const openReports = (reports || []).filter(isOpenReport).sort((a, b) => (b.ts || 0) - (a.ts || 0));
  const todayStr = today();
  const todayJobs = jobs.filter(j => j.dates.includes(todayStr));
  const confirmedJobs = jobs.filter(j => j.status === "Confirmed");
  const pencilJobs = jobs.filter(j => j.status === "Pencil");
  const avList = calcAvailable(equipment, todayStr, { jobs, checkouts, equipmentRequests, reports });
  const pendingRequests = (equipmentRequests || []).filter(r => r.status === "pending");
  const needsActionTotal = (adminRequests || []).filter(r => r.status === "pending").length + pendingRequests.length + openReports.length; // + overdue / due today once stillOutItems exists

  // Gear that was picked up but never returned: computed from the checkout log keyed
  // by job / request, so a deleted or Cancelled job still lists (P1-12). Count-based
  // (qty), with due date + overdue days (P1-11). Sorted overdue first. A partial
  // return leaves `missing` set ("Missing n"); lost / written-off units drop out.
  const stillOutItems = stillOutList({ checkouts, jobs, equipment, equipmentRequests, today: todayStr, tz: APP_TZ });
  const physOutUnits = stillOutItems.reduce((s, i) => s + i.qty, 0);
  const needsActionCount = needsActionTotal + stillOutItems.filter(i => i.overdue || i.dueToday).length;
  // Crew phone for the Not Returned rows: lazy per-employee profile fetch (read-only).
  const [crewProfiles, setCrewProfiles] = useState({});
  const stillOutCrewIds = [...new Set(stillOutItems.map(i => i.pickedById).filter(Boolean))].join(",");
  useEffect(() => {
    const ids = stillOutCrewIds ? stillOutCrewIds.split(",") : [];
    ids.filter(id => !(id in crewProfiles)).forEach(id => {
      setCrewProfiles(p => ({ ...p, [id]: null }));
      api.getProfile(id).then(d => setCrewProfiles(p => ({ ...p, [id]: d || {} }))).catch(() => {});
    });
  }, [stillOutCrewIds]); // eslint-disable-line react-hooks/exhaustive-deps

  const [expandedStat, setExpandedStat] = useState(null);
  const [eqOutJob, setEqOutJob] = useState(null);
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
      if (isVoidEvt(c.type)) return;
      const key = c.jobId || (c.requestId ? `req_${c.requestId}` : `emp_${c.employeeId}_${c.jobName}`);
      if (!map[key]) map[key] = { key, label: c.jobName || "Unknown", items: [], empNames: new Set(), latestTs: 0 };
      map[key].items.push(c);
      if (c.employeeName) map[key].empNames.add(c.employeeName);
      if (c.ts > map[key].latestTs) map[key].latestTs = c.ts;
    });
    return Object.values(map).sort((a, b) => b.latestTs - a.latestTs).slice(0, 10);
  })();
  const toggleActivity = (key) => setExpandedActivityKeys(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  // Tell the requester on their own LINE (linked members only, resolved server-side, P3-6).
  const pushRequestOutcome = (req, ok) => {
    if (lineNotifyMuted || !req.employeeId) return;
    if (!(employees || []).some(e => e && e.id === req.employeeId && e.lineLinked)) return; // not linked: nothing to send

    const items = (req.items && req.items.length ? req.items : [{ eqName: req.eqName, qty: req.qty }]).map(it => `${it.eqName || ""}${(+it.qty || 1) > 1 ? ` ×${it.qty}` : ""}`).join(", ");
    const dates = (req.useDates || []).map(d => formatDate(d)).join(", ");
    api.notify({ userIds: [], employeeIds: [req.employeeId], message: `${ok ? "✅" : "❌"} [${ok ? t("notifyGearApproved") : t("notifyGearDenied")}] ${items}${dates ? `\n📅 ${dates}` : ""}\n🔗 https://pickshootreturn.pages.dev` });
  };
  const approveRequest = (req) => {
    // Approval only unlocks the request — the employee still picks up with photo verification
    setEquipmentRequests(p => p.map(r => r.id === req.id ? { ...r, status: "approved", resolvedAt: Date.now() } : r));
    pushRequestOutcome(req, true);
    setDashReqModal(null);
  };
  const deleteRequest = async (req) => {
    const hasEvents = checkouts.some(c => c.requestId === req.id);
    if (!window.confirm(`Delete this gear request from ${req.employeeName}?${hasEvents ? " Its checkout history will be kept." : ""}`)) return;
    // Server first (tombstone), then local: a delete that only lived in React
    // state used to come back from KV on the next merge.
    if (deleteRecord && !(await deleteRecord("equipmentRequests", req.id))) return;
    setEquipmentRequests(p => p.filter(r => r.id !== req.id));
    setDashReqModal(null);
  };
  const denyRequest = (req) => {
    setEquipmentRequests(p => p.map(r => r.id === req.id ? { ...r, status: "denied", resolvedAt: Date.now() } : r));
    pushRequestOutcome(req, false);
    setDashReqModal(null);
  };

  const statusColor = JOB_STATUS_BADGE;
  const locationColor = { "Local (Bangkok)": "blue", "Out of Town": "amber", "Overseas": "red" };

  const statSections = {
    today:     { jobs: todayJobs,     label: t("dashTodayJobsLabel"),    color: "var(--accent,#2563EB)", badge: "amber" },
    confirmed: { jobs: confirmedJobs, label: t("dashConfirmedLabel"),  color: "#2F855A", badge: "green" },
    pencil:    { jobs: pencilJobs,    label: t("dashPencilLabel"),     color: "var(--accent,#2563EB)", badge: "amber" },
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ ...S.pageTitle, marginBottom: 2 }}>{t("dashOverview")}</h1>
          <p style={{ ...S.pageSubtitle, marginBottom: 0 }}>{new Date().toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}</p>
        </div>
        {!phone && (
          <button data-testid="dash-new-job" style={S.btn("primary")} onClick={() => setDashJobModal("new")}><Icon d={icons.plus} size={15} /> {t("jobNewJob")}</button>
        )}
      </div>

      {/* Two columns from 1024px (P2-11): a "Needs action" rail on the left, the
          schedule (stats, calendar, bookings, activity) on the right. Narrower
          screens stack the rail first so the actionable cards stay above the fold. */}
      <div data-testid="dash-grid" style={wide ? { display: "grid", gridTemplateColumns: "minmax(360px, 5fr) minmax(0, 7fr)", gap: 16, alignItems: "start" } : { display: "flex", flexDirection: "column", gap: 16 }}>
      <div data-testid="needs-action-rail" style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <p style={{ ...S.sectionTitle, margin: 0 }}>{t("dashNeedsAction")}</p>
          {needsActionCount > 0 ? <span style={S.badge("red")}>{needsActionCount}</span> : <span style={{ fontSize: 11, color: "#2F855A", fontWeight: 600 }}>{t("dashAllClear")}</span>}
        </div>
      {/* Admin Approvals — dedicated, filterable history */}
      {(() => {
        const allReqs = adminRequests || [];
        const pendingCount = allReqs.filter(r => r.status === "pending").length;
        const isResolved = (r) => r.status === "approved" || r.status === "rejected" || r.status === "withdrawn"; // withdrawn = crew re-shot at the shop (P1-5)
        const filtered = allReqs.filter(r => approvalFilter === "all" ? true : approvalFilter === "pending" ? r.status === "pending" : isResolved(r));
        const typeLabel = { "production-house": t("dashTypeProductionHouse"), "equipment": t("dashTypeEquipment"), "member-register": t("dashTypeNewMember"), "early-pickup": "Early Pickup", "early-return": "Early Return" };
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
          <div id="approvals-card" style={{ ...S.card, scrollMarginTop: 70 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
              <p style={{ ...S.sectionTitle, margin: 0 }}>
                {t("dashApprovals")}
                {pendingCount > 0 && <span style={{ ...S.badge("amber"), marginLeft: 8 }}>{pendingCount} {t("dashPending")}</span>}
              </p>
              <div style={{ display: "flex", gap: 4, background: "var(--surface2,#EAF0F7)", padding: 3, borderRadius: 8, border: "1px solid var(--divider-color,#D8E1EC)" }}>
                {tabs.map(tb => (
                  <button key={tb.k} onClick={() => setApprovalFilter(tb.k)} style={{ padding: "5px 12px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 700, background: approvalFilter === tb.k ? "var(--accent,#2563EB)" : "transparent", color: approvalFilter === tb.k ? "var(--accent-text,#FFFFFF)" : "var(--text-muted,#4E6B84)" }}>{tb.l}</button>
                ))}
              </div>
            </div>
            {rows.length === 0 && (
              <p style={{ fontSize: 13, color: "var(--text-muted,#5F7A91)", margin: 0 }}>
                {approvalFilter === "pending" ? t("dashNoPending") : approvalFilter === "resolved" ? t("dashNoResolved") : t("dashNoAll")}
              </p>
            )}
            {/* No height cap with overflow visible: an expanded geo-return photo used to push its Approve / Reject under the next card. */}
            <div style={{ maxHeight: rows.length > 6 ? 640 : "none", overflowY: rows.length > 6 ? "auto" : "visible", margin: "0 -4px", padding: "0 4px" }}>
            {rows.map((row, i, arr) => {
              const divider = { paddingBottom: i < arr.length - 1 ? 12 : 0, marginBottom: i < arr.length - 1 ? 12 : 0, borderBottom: i < arr.length - 1 ? "1px solid var(--divider-color,#D8E1EC)" : "none" };
              if (row.kind === "geo-group") {
                const g = row;
                const open = expandedApproval.has(g.key);
                const pend = g.items.filter(r => r.status === "pending");
                return (
                  <div key={g.key} style={divider}>
                    <div onClick={() => toggleApproval(g.key)} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                      <span style={S.badge(pend.length ? "amber" : "green")}>{pend.length ? `${pend.length} ${t("dashPending")}` : t("dashResolved")}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>{g.jobName} <span style={{ color: "var(--text-muted,#4E6B84)", fontWeight: 500 }}>· Return</span></p>
                        <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-muted,#4E6B84)" }}>{g.items.length} {t("dashItems")}{g.employeeName ? ` · ${t("dashByLabel")} ${g.employeeName}` : ""}</p>
                      </div>
                      {pend.length > 0 && (
                        <button style={{ ...S.btn("success"), padding: "4px 10px", fontSize: 11, flexShrink: 0 }} onClick={(e) => { e.stopPropagation(); pend.forEach(r => approveAdminRequest(r)); }}>{t("dashApproveAll")}</button>
                      )}
                      <span style={{ color: "var(--text-muted,#5F7A91)", fontSize: 14, flexShrink: 0, transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }}>›</span>
                    </div>
                    {open && (
                      <div style={{ marginTop: 10, paddingLeft: 10, borderLeft: "2px solid var(--divider-color,#D8E1EC)", display: "flex", flexDirection: "column", gap: 12 }}>
                        {g.items.map(req => (
                          <div key={req.id} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                            <span style={S.badge(req.status === "approved" ? "green" : req.status === "rejected" ? "red" : req.status === "withdrawn" ? "gray" : "amber", "md")}>{statusLabel(t, req.status)}</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <p style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>{req.eqName || req.eqId}</p>
                              <p style={{ margin: "2px 0 0", fontSize: 11, color: req.distance !== null ? (req.distance > 50 ? "#C53030" : "#2F855A") : "var(--text-muted,#6E8398)" }}>
                                <Icon d={icons.map} size={11} style={{ verticalAlign: "-2px", marginRight: 3 }} />{req.distance !== null ? `${req.distance}${t("dashGpsFrom")}` : t("dashGpsUnavail")}
                              </p>
                              <p style={{ margin: "3px 0 0", fontSize: 10, color: "var(--text-muted,#7B8FA3)" }}>Requested {fmtReqTime(req.submittedAt)}{req.resolvedAt ? ` · ${req.status} ${fmtReqTime(req.resolvedAt)}` : ""}</p>
                              <LazyPhoto field="adminRequests" id={req.id} photo={req.photo} hasPhoto={req.hasPhoto} alt="preview" style={{ width: "100%", maxWidth: 260, height: "auto", borderRadius: 5, marginTop: 6, border: "1px solid var(--border-color,#D8E1EC)" }} />
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
                  <span style={S.badge(req.status === "approved" ? "green" : req.status === "rejected" ? "red" : req.status === "withdrawn" ? "gray" : "amber", "md")}>{statusLabel(t, req.status)}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>{req.name}</p>
                    <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-muted,#4E6B84)" }}>
                      {typeLabel[req.type] || req.type}
                      {req.employeeName ? ` · ${t("dashByLabel")} ${req.employeeName}` : ` · ${t("dashGuest")}`}
                      {req.requestedDate ? ` · For ${formatDate(req.requestedDate)}` : ""}
                      {req.address ? ` · ${req.address}` : ""}
                      {req.category ? ` · ${req.category}` : ""}
                      {req.total && req.type === "equipment" ? ` · ×${req.total}` : ""}
                      {req.contact && req.type === "member-register" ? ` · ${t("dashContact")}: ${req.contact}` : ""}
                    </p>
                    <p style={{ margin: "3px 0 0", fontSize: 10, color: "var(--text-muted,#7B8FA3)" }}>Requested {fmtReqTime(req.submittedAt)}{req.resolvedAt ? ` · ${req.status} ${fmtReqTime(req.resolvedAt)}` : ""}{req.approvedBy ? ` · ${t("dashByLabel")} ${req.approvedBy}` : ""}</p>
                    <LazyPhoto field="adminRequests" id={req.id} photo={req.photo} hasPhoto={req.hasPhoto} alt="preview" style={{ width: 60, maxWidth: 60, height: 60, objectFit: "cover", borderRadius: 5, marginTop: 6, border: "1px solid var(--border-color,#D8E1EC)" }} />
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

      {/* Not Returned: from the checkout log (P1-11 / P1-12) */}
      <div id="stillout-card" data-testid="stillout-card" style={{ ...S.card, border: stillOutItems.some(i => i.overdue) ? "1px solid rgba(197,48,48,0.35)" : "1px solid var(--divider-color,#D8E1EC)", padding: "10px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: stillOutItems.length ? 8 : 0 }}>
          <p style={{ ...S.sectionTitle, margin: 0, fontSize: 12 }}>{t("dashStillOut")}</p>
          {stillOutItems.length > 0 && (
            <span style={{ fontSize: 11, color: "var(--text-muted,#4E6B84)" }}>{tCount(t, "countUnits", physOutUnits)} · {tCount(t, "countItems", stillOutItems.length)}</span>
          )}
        </div>
        {stillOutItems.length === 0
          ? <p style={{ color: "#2F855A", fontSize: 12, margin: 0 }}>{t("dashStillOutEmpty")}</p>
          : stillOutItems.map((item, idx, arr) => {
              const color = item.overdue ? "#C53030" : item.dueToday ? "var(--accent,#2563EB)" : "var(--text-muted,#4E6B84)";
              const prof = item.pickedById ? crewProfiles[item.pickedById] : null;
              const phone = prof && prof.phone ? prof.phone : "";
              const picked = item.daysOut > 0 ? t("dashPickedAgo").replace("{n}", item.daysOut) : t("dashPickedToday");
              const due = item.overdue ? null : item.dueToday ? t("dashDueToday") : item.dueDate ? t("dashDue").replace("{date}", formatDate(item.dueDate)) : t("dashNoDue");
              return (
                <div key={item.key} data-testid="stillout-row" style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: idx < arr.length - 1 ? "1px solid var(--divider-color,#D8E1EC)" : "none" }}>
                  <div style={{ width: 3, alignSelf: "stretch", borderRadius: 2, background: item.overdue ? "#C53030" : "var(--accent,#2563EB)", flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text,#16324A)" }}>{item.qty} × {item.eqName}</span>
                      {item.missing && <span style={{ ...S.badge("red"), fontSize: 10 }}>{t("missingN").replace("{n}", item.qty)}</span>}
                      {item.overdue
                        ? <span style={{ ...S.badge("red"), fontSize: 10, fontWeight: 800 }}>{t("dashOverdueDays").replace("{n}", item.daysOverdue)}</span>
                        : item.dueToday ? <span style={{ ...S.badge("amber"), fontSize: 10 }}>{t("dashDueToday")}</span> : <span style={{ ...S.badge("gray"), fontSize: 10 }}>{t("dashStillOutActive")}</span>}
                    </div>
                    <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-muted,#4E6B84)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {item.jobName}{item.jobGone ? ` (${t("dashJobGone")})` : ""}{item.job && item.job.production ? ` · ${item.job.production}` : ""}
                    </p>
                    <p style={{ margin: "2px 0 0", fontSize: 11, color, fontVariantNumeric: "tabular-nums" }}>
                      {picked}{due ? ` · ${due}` : item.dueDate ? ` · ${t("dashDue").replace("{date}", formatDate(item.dueDate))}` : ""}
                    </p>
                    <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text,#16324A)" }}>
                      <Icon d={icons.user} size={11} style={{ verticalAlign: "-2px", marginRight: 3 }} />{item.pickedBy || "?"}{phone ? <> · <a href={`tel:${phone.replace(/[^+\d]/g, "")}`} style={{ color: "var(--accent,#2563EB)", textDecoration: "none", fontWeight: 600 }}>{phone}</a></> : ""}
                    </p>
                  </div>
                  {onReceive && (
                    <button data-testid="receive-btn" style={{ ...S.btn("success"), padding: "5px 10px", fontSize: 11, flexShrink: 0 }}
                      onClick={() => onReceive(item.jobId, item.eqId, { requestId: item.requestId, qty: item.qty, lanes: item.lanes, jobName: item.jobName, eqName: item.eqName, employeeId: item.pickedById, employeeName: item.pickedBy })}>
                      ✓ {t("dashReceive")}
                    </button>
                  )}
                </div>
              );
            })
        }
      </div>

      {/* Gear Requests */}
      <div id="gear-requests-card" data-testid="gear-requests-card" style={{ ...S.card, scrollMarginTop: 70 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <p style={{ ...S.sectionTitle, margin: 0 }}>
            {t("dashGearRequests")}
            {pendingRequests.length > 0 && <span style={{ ...S.badge("amber"), marginLeft: 8 }}>{pendingRequests.length} {t("dashPending")}</span>}
          </p>
        </div>
        {(equipmentRequests || []).length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--text-muted,#7B8FA3)" }}>{t("dashNoRequests")}</p>
        ) : [...(equipmentRequests || [])].reverse().slice(0, 10).map((req, i, arr) => {
          const itemLabel = req.items
            ? req.items.map(it => { const e = equipment.find(x => x.id === it.eqId); return `${e?.name || it.eqName}${it.qty > 1 ? ` ×${it.qty}` : ""}`; }).join(", ")
            : `${equipment.find(e => e.id === req.eqId)?.name || req.eqName} ×${req.qty}`;
          const dateLabel = req.useDates?.length > 0 ? req.useDates.map(formatDate).join(", ") : req.useDate ? formatDate(req.useDate) : null;
          return (
            <div key={req.id}
              onClick={() => setDashReqModal(req)}
              style={{ display: "flex", alignItems: "flex-start", gap: 10, paddingBottom: i < arr.length - 1 ? 12 : 0, marginBottom: i < arr.length - 1 ? 12 : 0, borderBottom: i < arr.length - 1 ? "1px solid var(--divider-color,#D8E1EC)" : "none", cursor: "pointer" }}>
              <span style={S.badge(req.status === "approved" ? "green" : req.status === "denied" ? "red" : "amber")}>{statusLabel(t, req.status)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "var(--text,#16324A)" }}>{req.employeeName}</p>
                <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--text-muted,#4E6B84)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{itemLabel}</p>
                {dateLabel && <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-muted,#5F7A91)" }}>{dateLabel}</p>}
              </div>
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="var(--text-muted,#8CA2B5)" strokeWidth={2} strokeLinecap="round" style={{ flexShrink: 0, marginTop: 2 }}><path d="M9 18l6-6-6-6" /></svg>
            </div>
          );
        })}
      </div>

      {/* Open damage reports (P2-11): the fourth thing that needs the owner's hand */}
      <div data-testid="damage-card" style={{ ...S.card, padding: "10px 14px", border: openReports.length ? "1px solid rgba(197,48,48,0.35)" : "1px solid var(--divider-color,#D8E1EC)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: openReports.length ? 8 : 0 }}>
          <p style={{ ...S.sectionTitle, margin: 0, fontSize: 12 }}>{t("dashOpenDamage")}{openReports.length > 0 && <span style={{ ...S.badge("red"), marginLeft: 8 }}>{openReports.length}</span>}</p>
          {openReports.length > 0 && onOpenReports && <button style={{ ...S.btn("ghost"), padding: "4px 10px", fontSize: 11 }} onClick={onOpenReports}>{t("dashViewReports")} ›</button>}
        </div>
        {openReports.length === 0
          ? <p style={{ color: "#2F855A", fontSize: 12, margin: 0 }}>{t("dashOpenDamageEmpty")}</p>
          : openReports.slice(0, 5).map((r, i, arr) => (
            <div key={r.id} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "6px 0", borderBottom: i < arr.length - 1 ? "1px solid var(--divider-color,#D8E1EC)" : "none", cursor: onOpenReports ? "pointer" : "default" }} onClick={onOpenReports}>
              <div style={{ width: 3, alignSelf: "stretch", borderRadius: 2, background: "#C53030", flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "var(--text,#16324A)" }}>{(equipment.find(e => e.id === r.eqId) || {}).name || r.eqName || r.eqId}{r.qty > 1 ? ` ×${r.qty}` : ""}</p>
                <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-muted,#4E6B84)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.description}</p>
                <p style={{ margin: "2px 0 0", fontSize: 10, color: "var(--text-muted,#7B8FA3)" }}>{r.reportedBy?.name || (typeof r.reportedBy === "string" ? r.reportedBy : "") || r.employeeName || ""}{r.ts ? ` · ${formatDateTime(r.ts)}` : ""}</p>
              </div>
            </div>
          ))}
      </div>

      </div>

      <div data-testid="schedule-column" style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
      {/* Stats row — 3 tappable cards */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
        {Object.entries(statSections).map(([key, s]) => {
          const isOpen = expandedStat === key;
          return (
            <div key={key}
              onClick={() => setExpandedStat(isOpen ? null : key)}
              style={{ ...S.card, textAlign: "center", padding: "14px 8px", cursor: "pointer",
                border: isOpen ? `1px solid ${s.color}` : "1px solid var(--divider-color,#D8E1EC)",
                background: isOpen ? `${s.color}12` : "var(--surface,#FFFFFF)",
                transition: "all 0.15s" }}>
              <p style={{ margin: 0, fontSize: 28, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.jobs.length}</p>
              <p style={{ margin: "5px 0 0", fontSize: 9, color: isOpen ? s.color : "var(--text-muted,#5F7A91)", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", lineHeight: 1.3 }}>{s.label}</p>
              <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke={isOpen ? s.color : "var(--text-muted,#8CA2B5)"} strokeWidth={2.5} strokeLinecap="round" style={{ marginTop: 6, transition: "transform 0.15s", transform: isOpen ? "rotate(180deg)" : "none" }}>
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
              <p style={{ fontSize: 13, color: "var(--text-muted,#7B8FA3)" }}>{t("dashNoJobsCategory")}</p>
            ) : s.jobs.map((j, i) => (
              <div key={j.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, paddingBottom: i < s.jobs.length - 1 ? 12 : 0, marginBottom: i < s.jobs.length - 1 ? 12 : 0, borderBottom: i < s.jobs.length - 1 ? "1px solid var(--divider-color,#D8E1EC)" : "none" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 4 }}>
                    <span style={S.badge(statusColor[j.status] || "gray")}>{j.status}</span>
                    <span style={S.badge(locationColor[j.location] || "gray")}>{j.location}{j.locationCity ? ` · ${j.locationCity}` : ""}</span>
                  </div>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "var(--text,#16324A)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{j.name}</p>
                  <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-muted,#5F7A91)" }}>{j.production} · {j.shootTime}</p>
                  <p style={{ margin: "3px 0 0", fontSize: 11, color: "var(--text-muted,#4E6B84)" }}>
                    {tCount(t, "countDays", j.dates.length)}
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
      <DashboardCalendar jobs={jobs} equipment={equipment} onEdit={(job) => setDashJobModal(job)} />

      {/* Equipment status: bookings (assignment-based) vs gear physically out (checkout-based) */}
      {(() => {
        const outJobs = jobs.filter(j => j.status === "Confirmed" && j.dates.includes(todayStr) && (j.assignedEquipment || []).length > 0);
        const totalBooked = avList.filter(e => e.hard && e.hard.jobs > 0).length;
        const physOutTypes = new Set(stillOutItems.map(i => i.eqId)).size;
        return (
          <div style={S.card} data-testid="booked-today">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 8, flexWrap: "wrap" }}>
              <p style={{ ...S.sectionTitle, margin: 0 }}>{t("dashBookedToday")}</p>
              <span style={{ fontSize: 11, color: "var(--text-muted,#4E6B84)", flexShrink: 0 }}>{t("dashBookedCount").replace("{n}", totalBooked).replace("{t}", equipment.length)}</span>
            </div>
            <div onClick={() => document.getElementById("stillout-card")?.scrollIntoView({ behavior: "smooth", block: "start" })}
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 12px", borderRadius: 8, marginBottom: outJobs.length ? 10 : 0, cursor: "pointer",
                background: physOutUnits > 0 ? (stillOutItems.some(i => i.overdue) ? "rgba(197,48,48,0.06)" : "rgba(var(--accent-rgb,37,99,235),0.06)") : "var(--surface2,#EAF0F7)",
                border: `1px solid ${stillOutItems.some(i => i.overdue) ? "rgba(197,48,48,0.3)" : "var(--divider-color,#D8E1EC)"}` }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: stillOutItems.some(i => i.overdue) ? "#C53030" : "var(--text-muted,#4E6B84)" }}><Icon d={icons.package} size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />{t("dashPhysOut")}</span>
              <span data-testid="phys-out" style={{ fontSize: 12, fontWeight: 700, color: physOutUnits > 0 ? (stillOutItems.some(i => i.overdue) ? "#C53030" : "var(--accent,#2563EB)") : "#2F855A" }}>{t("dashPhysOutCount").replace("{u}", physOutUnits).replace("{n}", physOutTypes)}</span>
            </div>
            {outJobs.length === 0
              ? <p style={{ color: "#2F855A", fontSize: 13, margin: 0 }}>{t("dashAllAvail")}</p>
              : <div style={S.col}>
                  {outJobs.map(job => {
                    const eqCount = (job.assignedEquipment || []).length;
                    return (
                      <button key={job.id} onClick={() => setEqOutJob(job)}
                        style={{ ...S.card, background: "var(--surface2,#EAF0F7)", border: "1px solid var(--divider-color,#D8E1EC)", cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 14px", margin: 0 }}>
                        <div style={{ minWidth: 0 }}>
                          <p style={{ margin: 0, fontWeight: 700, fontSize: 13, color: "var(--text,#16324A)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{job.name}</p>
                          <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-muted,#4E6B84)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{job.production || "—"}</p>
                        </div>
                        <span style={{ ...S.badge("amber"), flexShrink: 0 }}>{tCount(t, "countItems", eqCount)}</span>
                      </button>
                    );
                  })}
                </div>}
          </div>
        );
      })()}

      {/* Recent activity */}
      <div style={S.card}>
        <p style={S.sectionTitle}>{t("dashRecentActivity")}</p>
        {activityGroups.length === 0 ? (
          <p style={{ color: "var(--text-muted,#5F7A91)", fontSize: 13 }}>{t("dashNoActivity")}</p>
        ) : activityGroups.map((group, i, arr) => {
          const isExpanded = expandedActivityKeys.has(group.key);
          const sortedItems = [...group.items].sort((a, b) => b.ts - a.ts);
          const latestType = sortedItems[0]?.type;
          const isPick = latestType === "pick" || latestType === "checkout";
          const empNames = [...group.empNames].join(", ");
          return (
            <div key={group.key} style={{ paddingBottom: i < arr.length - 1 ? 10 : 0, marginBottom: i < arr.length - 1 ? 10 : 0, borderBottom: i < arr.length - 1 ? "1px solid var(--divider-color,#D8E1EC)" : "none" }}>
              <div onClick={() => toggleActivity(group.key)} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                <span style={S.badge(isPick ? "amber" : "green")}>{isPick ? t("dashPicked") : t("dashReturned")}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{group.label}</p>
                  <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-muted,#5F7A91)" }}>{empNames} · {formatDateTime(group.latestTs)}</p>
                </div>
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="var(--text-muted,#5F7A91)" strokeWidth={2} strokeLinecap="round" style={{ flexShrink: 0, transform: isExpanded ? "rotate(90deg)" : "none", transition: "transform .15s" }}><path d="M9 18l6-6-6-6" /></svg>
              </div>
              {isExpanded && (
                <div style={{ marginTop: 8, paddingLeft: 10, borderLeft: "2px solid var(--divider-color,#D8E1EC)" }}>
                  {sortedItems.map((c, ci) => {
                    const eq = equipment.find(e => e.id === c.eqId);
                    const cIsPick = isPickEvt(c.type);
                    return (
                      <div key={ci} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: ci < sortedItems.length - 1 ? "1px solid var(--divider-color,#D8E1EC)" : "none" }}>
                        <span style={S.badge(cIsPick ? "amber" : isLostEvt(c.type) ? "red" : "green")}>{cIsPick ? t("pickEvt") : isLostEvt(c.type) ? t("condLost") : t("returnEvt")}</span>
                        <div style={{ flex: 1 }}>
                          <p style={{ margin: 0, fontSize: 12, fontWeight: 600 }}>{eq?.name || "—"} ×{c.qty}</p>
                          <p style={{ margin: 0, fontSize: 10, color: "var(--text-muted,#5F7A91)" }}>{c.employeeName} · {formatDateTime(c.ts)}</p>
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

      </div>
      </div>

      {eqOutJob && (
        <Modal title={eqOutJob.name} onClose={() => setEqOutJob(null)}>
          <p style={{ margin: "0 0 12px", fontSize: 12, color: "var(--text-muted,#4E6B84)" }}>{eqOutJob.production || "—"}</p>
          <div style={S.col}>
            {(eqOutJob.assignedEquipment || []).map(ae => {
              const eq = equipment.find(e => e.id === ae.eqId);
              if (!eq) return null;
              const avItem = avList.find(e => e.id === ae.eqId);
              const allOut = avItem ? avItem.available <= 0 : false;
              return (
                <div key={ae.eqId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--divider-color,#D8E1EC)" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontWeight: 600, fontSize: 13, color: "var(--text,#16324A)" }}>{eq.name}</p>
                    {eq.category && <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-muted,#4E6B84)" }}>{eq.category}</p>}
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700, color: allOut ? "#C53030" : "var(--accent,#2563EB)", flexShrink: 0 }}>×{ae.qty}</span>
                </div>
              );
            })}
          </div>
        </Modal>
      )}

      {/* Request Detail Modal */}
      {dashReqModal && (() => {
        const req = dashReqModal;
        const items = req.items || [{ eqId: req.eqId, eqName: req.eqName, qty: req.qty }];
        const dateLabel = req.useDates?.length > 0 ? req.useDates.map(formatDate).join(", ") : req.useDate ? formatDate(req.useDate) : null;
        return (
          <Modal title={t("dashGearReqDetail")} onClose={() => setDashReqModal(null)}>
            <div style={S.col}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={S.badge(req.status === "approved" ? "green" : req.status === "denied" ? "red" : "amber")}>{statusLabel(t, req.status)}</span>
                <span style={{ fontWeight: 700, fontSize: 15 }}>{req.employeeName}</span>
              </div>

              <div style={{ borderTop: "1px solid var(--divider-color,#D8E1EC)", paddingTop: 12 }}>
                <p style={{ ...S.label, marginBottom: 8 }}>{t("dashRequestedItems")}</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {items.map((item, i) => {
                    const eq = equipment.find(e => e.id === item.eqId);
                    return (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "var(--surface2,#EAF0F7)", borderRadius: 8, border: "1px solid var(--divider-color,#D8E1EC)" }}>
                        {eq?.photo
                          ? <img src={eq.photo} alt="" style={{ width: 36, height: 32, objectFit: "cover", borderRadius: 5, flexShrink: 0 }} />
                          : <div style={{ width: 36, height: 32, borderRadius: 5, background: "var(--divider-color,#D8E1EC)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon d={icons.camera} size={12} color="var(--text-muted,#8CA2B5)" /></div>
                        }
                        <div style={{ flex: 1 }}>
                          <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{eq?.name || item.eqName}</p>
                          {eq?.category && <p style={{ margin: 0, fontSize: 11, color: "var(--text-muted,#5F7A91)" }}>{eq.category}</p>}
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
                  <p style={{ fontSize: 13, color: "var(--text,#16324A)", margin: 0 }}>{dateLabel}</p>
                </div>
              )}

              <div>
                <p style={S.label}>{t("dashPurpose")}</p>
                <p style={{ fontSize: 13, color: "var(--text,#16324A)", margin: 0 }}>
                  {req.purpose === "work" ? `${t("teamWork")}: ${req.jobName || ""}${req.productionName ? ` (${req.productionName})` : ""}` : t("purposePractice")}
                </p>
              </div>

              {req.reason && (
                <div>
                  <p style={S.label}>{t("dashReason")}</p>
                  <p style={{ fontSize: 13, color: "var(--text-muted,#4E6B84)", margin: 0 }}>{req.reason}</p>
                </div>
              )}

              <p style={{ fontSize: 11, color: "var(--text-muted,#8CA2B5)", margin: 0 }}>Requested {new Date(req.requestedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</p>

              {req.status === "pending" && (
                <div style={{ display: "flex", gap: 10, paddingTop: 4 }}>
                  <button style={{ ...S.btn("ghost"), flexShrink: 0 }} title="Delete request" onClick={() => deleteRequest(req)}><Icon d={icons.trash} size={14} /></button>
                  <button style={{ ...S.btn("danger"), flex: 1 }} onClick={() => denyRequest(req)}>{t("dashDeny")}</button>
                  <button style={{ ...S.btn("success"), flex: 1 }} onClick={() => approveRequest(req)}>{t("dashApprove")}</button>
                </div>
              )}
              {req.status === "approved" && (() => {
                const reqCheckouts = checkouts.filter(c => c.requestId === req.id);
                const pickedIds = new Set(reqCheckouts.filter(c => isPickEvt(c.type)).map(c => c.eqId));
                const returnedIds = new Set(reqCheckouts.filter(c => isReturnEvt(c.type)).map(c => c.eqId));
                return (
                  <div style={{ borderTop: "1px solid var(--divider-color,#D8E1EC)", paddingTop: 12 }}>
                    <p style={{ ...S.label, marginBottom: 8 }}>{t("dashCheckoutStatus")}</p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {items.map((item, i) => {
                        const eq = equipment.find(e => e.id === item.eqId);
                        const returned = returnedIds.has(item.eqId);
                        const picked = pickedIds.has(item.eqId);
                        return (
                          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", background: "var(--surface2,#EAF0F7)", borderRadius: 8, border: "1px solid var(--divider-color,#D8E1EC)" }}>
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
                <div style={{ display: "flex", gap: 10 }}>
                  <button style={{ ...S.btn("ghost"), flexShrink: 0 }} title="Delete request" onClick={() => deleteRequest(req)}><Icon d={icons.trash} size={14} /></button>
                  <button style={{ ...S.btn("ghost"), flex: 1 }} onClick={() => setDashReqModal(null)}>{t("dashClose")}</button>
                </div>
              )}
            </div>
          </Modal>
        );
      })()}

      {/* Floating + FAB: phones only (desktop has the header New Job button, P2-11) */}
      {phone && <button
        onClick={() => setDashJobModal("new")}
        style={{
          position: "fixed", bottom: 78, right: 20, width: 52, height: 52,
          borderRadius: "50%", background: "var(--btn-primary-bg,#2563EB)", color: "var(--btn-primary-color,#FFFFFF)",
          border: "none", fontSize: 28, fontWeight: 300, cursor: "pointer",
          boxShadow: "0 4px 16px rgba(22,50,74,0.14)", display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 90,
        }}
        title={t("jobNewJob")}
        data-testid="dash-fab"
      >+</button>}

      {dashJobModal && (
        <JobFormModal
          editTarget={dashJobModal === "new" ? null : dashJobModal}
          jobs={jobs}
          setJobs={setJobs}
          productionCompanies={productionCompanies}
          employees={employees}
          lineGroupId={lineGroupId}
          lineNotifyMuted={lineNotifyMuted}
          equipment={equipment}
          checkouts={checkouts}
          equipmentRequests={equipmentRequests}
          reports={reports}
          onClose={() => setDashJobModal(null)}
        />
      )}
    </div>
  );
}

// ─── ADMIN REPORTS PAGE ───────────────────────────────────────────────────────
export function AdminReportsPage({ reports, setReports, equipment, jobs, productionCompanies }) {
  const t = useT();
  const [filter, setFilter] = useState("open");
  const [expandedId, setExpandedId] = useState(null);
  const [detail, setDetail] = useState({}); // P2-2: per-report draft of qty / cost / vendor
  const [savedFlash, setSavedFlash] = useState(null);

  const resolve = (id, status) =>
    setReports(p => p.map(r => r.id === id ? { ...r, status, resolvedAt: Date.now() } : r));
  const draftFor = (r) => detail[r.id] || { qty: r.qty || 1, cost: r.cost ?? "", vendor: r.vendor || "" };
  const saveDetail = (r) => {
    const d = draftFor(r);
    const eq = r.eqId ? equipment.find(e => e.id === r.eqId) : null;
    const qty = eq ? Math.min(Math.max(1, +d.qty || 1), +eq.total || 1) : 1;
    const cost = d.cost === "" || d.cost === null ? null : (+String(d.cost).replace(/,/g, "") || 0);
    setReports(p => p.map(x => x.id === r.id ? { ...x, qty, cost, vendor: (d.vendor || "").trim() } : x));
    setDetail(p => { const n = { ...p }; delete n[r.id]; return n; });
    setSavedFlash(r.id); setTimeout(() => setSavedFlash(f => f === r.id ? null : f), 1500);
  };

  const statusBadge = (status) =>
    ({ open: <span style={S.badge("red")}>{t("reportStatusOpen")}</span>, solved: <span style={S.badge("green")}>{t("reportStatusSolved")}</span>, discarded: <span style={S.badge("gray")}>{t("reportStatusDiscarded")}</span> }[status] || null);

  const filtered = (filter === "open" ? reports.filter(r => r.status === "open") : reports).sort((a, b) => b.ts - a.ts);
  const openCount = reports.filter(r => r.status === "open").length;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24, gap: 12 }}>
        <div>
          <h1 style={S.pageTitle}>{t("reportTitle")}</h1>
          <p style={{ ...S.pageSubtitle, color: openCount > 0 ? "#C53030" : "var(--text-muted,#5F7A91)" }}>{openCount} {t("reportUnresolved")}</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <button style={{ ...S.btn(filter === "open" ? "primary" : "ghost"), padding: "7px 14px", fontSize: 12 }} onClick={() => setFilter("open")}>{t("reportStatusOpen")}</button>
          <button style={{ ...S.btn(filter === "all" ? "primary" : "ghost"), padding: "7px 14px", fontSize: 12 }} onClick={() => setFilter("all")}>{t("reportAll")}</button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div style={{ ...S.card, textAlign: "center", padding: 40 }}>
          <Icon d={icons.alert} size={40} color="var(--border-color,#D8E1EC)" />
          <p style={{ color: "var(--text-muted,#5F7A91)", marginTop: 12 }}>{t("reportNone")}</p>
        </div>
      ) : (
        <div style={S.col}>
          {filtered.map(r => {
            const eq = r.eqId ? equipment.find(e => e.id === r.eqId) : null;
            const open = expandedId === r.id;
            return (
              <div key={r.id} style={{ ...S.card, border: r.status === "open" ? "1px solid rgba(197,48,48,0.35)" : "1px solid var(--divider-color,#D8E1EC)" }}>
                <div style={{ display: "flex", gap: 12, alignItems: "flex-start", cursor: "pointer" }} onClick={() => setExpandedId(open ? null : r.id)}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap", alignItems: "center" }}>
                      {statusBadge(r.status)}
                      {(eq || r.eqName) && <span style={S.tag}>{eq?.name || r.eqName}{(r.qty || 1) > 1 ? ` ×${r.qty}` : ""}</span>}
                      {r.status === "open" && eq && <span style={{ ...S.badge("red"), fontSize: 10 }}>{t("reportOutOfServiceBadge")} · {tCount(t, "countUnits", r.qty || 1)}</span>}
                    </div>
                    <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--text,#16324A)", lineHeight: 1.4 }}>{r.description}</p>
                    <p style={{ margin: "5px 0 0", fontSize: 11, color: "var(--text-muted,#5F7A91)" }}>{t("reportBy")} <strong style={{ color: "var(--text-muted,#4E6B84)" }}>{r.reportedBy?.name || (typeof r.reportedBy === "string" ? r.reportedBy : "")}</strong> · {formatDateTime(r.ts)}</p>
                    {(() => {
                      const job = r.jobId ? (jobs || []).find(j => j.id === r.jobId) : null;
                      const jobName = job ? job.name : r.jobName;
                      const customer = job ? job.production : r.production;
                      if (!jobName && !customer) return null;
                      return (
                        <p style={{ margin: "3px 0 0", fontSize: 11, color: "var(--text,#16324A)" }}>
                          {jobName ? <><Icon d={icons.film} size={11} style={{ verticalAlign: "-2px", marginRight: 3 }} />{t("reportLinkedJob")}: <strong>{jobName}</strong>{job && (job.dates || [])[0] ? ` (${formatDate(job.dates[0])})` : ""}</> : null}
                          {customer ? <>{jobName ? " · " : ""}{t("reportCustomer")}: <strong>{customer}</strong></> : null}
                        </p>
                      );
                    })()}
                    {(r.cost || r.vendor) && <p style={{ margin: "3px 0 0", fontSize: 11, color: "var(--text-muted,#4E6B84)" }}>{r.vendor ? `${t("reportVendorLabel")}: ${r.vendor}` : ""}{r.vendor && r.cost ? " · " : ""}{r.cost ? `฿${Number(r.cost).toLocaleString()}` : ""}</p>}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0, alignItems: "center" }}>
                    {r.photos?.length > 0 && <img src={r.photos[0]} alt="" style={{ width: 52, height: 52, objectFit: "cover", borderRadius: 8 }} />}
                    {r.photos?.length > 1 && <span style={S.badge("gray")}>+{r.photos.length - 1}</span>}
                    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="var(--text-muted,#7B8FA3)" strokeWidth={2.5} strokeLinecap="round" style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
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
                    {/* P2-2: claim record, editable any time */}
                    {(() => {
                      const d = draftFor(r);
                      return (
                        <div style={{ display: "grid", gridTemplateColumns: eq && (+eq.total || 1) > 1 ? "90px 1fr 1fr auto" : "1fr 1fr auto", gap: 8, alignItems: "end", marginBottom: 14 }}>
                          {eq && (+eq.total || 1) > 1 && (
                            <div><label style={S.label}>{t("reportQty")}</label><input type="number" min={1} max={eq.total} style={S.input} value={d.qty} onChange={e => setDetail(p => ({ ...p, [r.id]: { ...d, qty: e.target.value } }))} /></div>
                          )}
                          <div><label style={S.label}>{t("reportCost")}</label><input style={S.input} inputMode="decimal" value={d.cost} onChange={e => setDetail(p => ({ ...p, [r.id]: { ...d, cost: e.target.value } }))} placeholder="0" /></div>
                          <div><label style={S.label}>{t("reportVendor")}</label><input style={S.input} value={d.vendor} onChange={e => setDetail(p => ({ ...p, [r.id]: { ...d, vendor: e.target.value } }))} /></div>
                          <button style={{ ...S.btn(savedFlash === r.id ? "success" : "ghost"), whiteSpace: "nowrap" }} onClick={() => saveDetail(r)}>{savedFlash === r.id ? t("reportDetailsSaved") : t("reportSaveDetails")}</button>
                        </div>
                      );
                    })()}
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
                      <p style={{ fontSize: 12, color: "var(--text-muted,#5F7A91)" }}>{r.status === "solved" ? t("reportStatusSolved") : t("reportStatusDiscarded")} · {r.resolvedAt ? formatDateTime(r.resolvedAt) : ""}</p>
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

// ─── TEAM PAGE ────────────────────────────────────────────────────────────────
export function TeamPage({ employees, setEmployees, setEmployeePin, equipmentRequests, setEquipmentRequests, checkouts, setCheckouts, equipment, kpiConfig, setKpiConfig, kpiEvents, setKpiEvents, punishments, setPunishments, deleteRecord, onOpenRequests }) {
  const t = useT();
  const [modal, setModal] = useState(null);
  const [editTarget, setEditTarget] = useState(null);
  const [form, setForm] = useState({ name: "", pin: "", confirm: "" });
  const [formErr, setFormErr] = useState("");
  const [formBusy, setFormBusy] = useState(false);
  const [pinTarget, setPinTarget] = useState(null); // employee whose PIN is being reset (never shown, P0-2)
  const [profileTarget, setProfileTarget] = useState(null);
  const [profileData, setProfileData] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [kpiForm, setKpiForm] = useState({ punishmentId: "", points: "", reason: "", kind: "deduct" });
  const [kpiMsg, setKpiMsg] = useState(null);

  const openProfile = (emp) => {
    setProfileTarget(emp);
    setProfileData(null);
    setProfileLoading(true);
    setKpiForm({ punishmentId: "", points: "", reason: "", kind: "deduct" });
    setKpiMsg(null);
    setModal("profile");
    api.getProfile(emp.id).then(d => setProfileData(d)).catch(() => {}).finally(() => setProfileLoading(false));
  };

  // Gear requests are approved / denied / deleted on the Dashboard only (P2-11).
  const pendingRequests = (equipmentRequests || []).filter(r => r.status === "pending");
  const openAdd = () => { setForm({ name: "", pin: "", confirm: "" }); setEditTarget(null); setFormErr(""); setModal("add"); };
  const openEdit = (emp) => { setForm({ name: emp.name, pin: "", confirm: "" }); setEditTarget(emp); setFormErr(""); setModal("edit"); };
  const openPin = (emp) => { setPinTarget(emp); setForm({ name: emp.name, pin: "", confirm: "" }); setFormErr(""); setModal("pin"); };

  const validate = (needPin) => {
    if (modal !== "pin" && !form.name.trim()) return t("teamNameRequired");
    if (needPin) {
      if (!form.pin.trim()) return t("teamPinRequired");
      if (!/^\d{4,6}$/.test(form.pin)) return t("teamPinInvalid");
      if (form.pin !== form.confirm) return t("settingsPinMismatch");
    }
    return null;
  };

  // Add: name + PIN go to /api/employees/:id/pin (the server creates the member
  // and hashes the PIN; the employees array in state never carries a PIN).
  // Edit: name only. Reset PIN: the same endpoint on an existing member.
  const saveEmployee = async () => {
    const err = validate(modal !== "edit");
    if (err) { setFormErr(err); return; }
    if (modal === "edit") {
      setEmployees(p => p.map(e => e.id === editTarget.id ? { ...e, name: form.name.trim() } : e));
      setModal(null);
      return;
    }
    setFormBusy(true);
    const id = modal === "add" ? "e" + Date.now() : pinTarget.id;
    const r = await setEmployeePin(id, form.pin, modal === "add" ? form.name.trim() : undefined);
    setFormBusy(false);
    if (!r.ok) { setFormErr(r.status === 401 ? t("authSessionEnded") : t("pinSaveFailed")); return; }
    setForm({ name: "", pin: "", confirm: "" });
    setModal(null);
  };

  const delEmployee = (emp) => {
    if (!window.confirm(t("teamRemoveConfirm"))) return;
    setEmployees(p => p.filter(e => e.id !== emp.id));
    api.audit({ action: "employee.delete", recordId: emp.id, name: emp.name });
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
          {employees.length === 0 && <p style={{ fontSize: 13, color: "var(--text-muted,#5F7A91)" }}>{t("teamNoMembers")}</p>}
          {employees.map((e, i) => (
            <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 12, paddingBottom: i < employees.length - 1 ? 14 : 0, marginBottom: i < employees.length - 1 ? 14 : 0, borderBottom: i < employees.length - 1 ? "1px solid var(--divider-color,#D8E1EC)" : "none" }}>
              <div style={{ width: 38, height: 38, borderRadius: "50%", background: "rgba(var(--accent-rgb,37,99,235),0.1)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Icon d={icons.user} size={17} color="var(--accent,#2563EB)" />
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>{e.name}</p>
                {(() => { const st = kpiStars(kpiScore(e.id, kpiEvents, kpiConfig), kpiConfig); return (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, margin: "3px 0 0" }}>
                    <StarRating value={st} size={12} />
                    <span style={{ fontSize: 11, color: "var(--text-muted,#4E6B84)" }}>{st.toFixed(1)}</span>
                  </div>
                ); })()}
                {e.contact && <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--text-muted,#5F7A91)" }}>{e.contact}</p>}
                {e.lineLinked && <span style={{ ...S.badge("green"), marginTop: 3, display: "inline-block" }}>{t("lineLinkTeamBadge")}</span>}
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <button style={{ ...S.btn("ghost"), padding: "5px 9px", fontSize: 12 }} onClick={() => openPin(e)} title={t("pinResetTitle")}><Icon d={icons.lock} size={12} /> {t("pinResetTitle")}</button>
                <button style={{ ...S.btn("ghost"), padding: "5px 9px" }} onClick={() => openProfile(e)} title="View Profile"><Icon d={icons.user} size={13} /></button>
                <button style={{ ...S.btn("ghost"), padding: "5px 9px" }} onClick={() => openEdit(e)}><Icon d={icons.edit} size={13} /></button>
                <button style={{ ...S.btn("danger"), padding: "5px 9px" }} onClick={() => delEmployee(e)}><Icon d={icons.trash} size={13} /></button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Gear requests live in ONE place, the Dashboard's Needs action rail (P2-11); this only points there. */}
      <div style={{ ...S.card, marginBottom: 20, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }} data-testid="team-requests-link">
        <div style={{ flex: 1, minWidth: 200 }}>
          <p style={{ ...S.sectionTitle, margin: 0 }}>{t("teamEqRequests")} {pendingRequests.length > 0 && <span style={{ ...S.badge("amber"), marginLeft: 6 }}>{t("teamPendingReqsN").replace("{n}", pendingRequests.length)}</span>}</p>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-muted,#5F7A91)" }}>{t("teamRequestsMoved")}</p>
        </div>
        {onOpenRequests && <button style={S.btn(pendingRequests.length > 0 ? "primary" : "ghost")} onClick={onOpenRequests}>{t("teamRequestsGo")} ›</button>}
      </div>

      {(modal === "add" || modal === "edit" || modal === "pin") && (
        <Modal title={modal === "add" ? t("teamAddTitle") : modal === "edit" ? t("teamEditTitle") : t("pinResetTitle")} onClose={() => setModal(null)}>
          <div style={S.col}>
            {modal === "pin"
              ? <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted,#5F7A91)" }}>{t("pinResetFor").replace("{name}", pinTarget ? pinTarget.name : "")}</p>
              : <div>
                  <label style={S.label}>{t("teamNameLabel")}</label>
                  <input style={S.input} value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Somchai" autoFocus />
                </div>}
            {modal !== "edit" && (<>
              <div>
                <label style={S.label}>{t("teamPinLabel")}</label>
                <input style={S.input} type="password" inputMode="numeric" maxLength={6} value={form.pin} onChange={e => setForm(p => ({ ...p, pin: e.target.value.replace(/\D/g, "") }))} placeholder="e.g. 1234" autoFocus={modal === "pin"} />
              </div>
              <div>
                <label style={S.label}>{t("settingsConfirmPin")}</label>
                <input style={S.input} type="password" inputMode="numeric" maxLength={6} value={form.confirm} onChange={e => setForm(p => ({ ...p, confirm: e.target.value.replace(/\D/g, "") }))} placeholder={t("settingsPinReEnter")} />
              </div>
              <p style={{ margin: 0, fontSize: 11, color: "var(--text-muted,#7B8FA3)" }}>{t("teamPinNeverShown")}</p>
            </>)}
            {formErr && <p style={{ fontSize: 12, color: "#C53030", margin: 0 }}>{formErr}</p>}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button style={S.btn("ghost")} onClick={() => setModal(null)}>{t("cancel")}</button>
              <button style={{ ...S.btn("primary"), opacity: formBusy ? 0.6 : 1 }} disabled={formBusy} onClick={saveEmployee}>{modal === "add" ? t("teamAddMemberBtn") : modal === "edit" ? t("teamSaveChanges") : t("pinResetTitle")}</button>
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
            const myEvents = kpiEventsInPeriod(profileTarget.id, kpiEvents, kpiConfig);
            const isAdd = kpiForm.kind === "add";
            const submit = () => {
              const r = buildKpiEvent({ employeeId: profileTarget.id, points: kpiForm.points, reason: kpiForm.reason, kind: kpiForm.kind, ruleId: kpiForm.punishmentId, by: actorName() });
              if (!r.ok) { setKpiMsg({ ok: false, text: r.error === "points" ? t(isAdd ? "teamKpiErrPointsAdd" : "teamKpiErrPoints") : t("teamKpiErrReason") }); return; }
              setKpiEvents(p => [...(p || []), r.event]);
              setKpiForm({ punishmentId: "", points: "", reason: "", kind: "deduct" });
              setKpiMsg({ ok: true, text: t(isAdd ? "teamKpiAddedMsg" : "teamKpiDeductedMsg").replace("{pts}", r.event.points) });
              setTimeout(() => setKpiMsg(null), 3000);
            };
            return (
              <div style={{ ...S.card, background: "rgba(var(--accent-rgb,37,99,235),0.04)", border: "1px solid rgba(var(--accent-rgb,37,99,235),0.15)" }}>
                <p style={S.sectionTitle}>{t("teamKpiScore")}</p>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
                  <StarRating value={stars} size={22} />
                  <span style={{ fontSize: 20, fontWeight: 800, color: "var(--accent,#2563EB)" }}>{stars.toFixed(1)}</span>
                  <span style={{ fontSize: 13, color: "var(--text-muted,#4E6B84)" }}>{score}/{max} {t("kpiPts")}</span>
                </div>
                <p style={{ fontSize: 11, color: "var(--text-muted,#5F7A91)", margin: "0 0 12px" }}>{t("teamKpiPeriodLabel")} {formatDate(start)} – {formatDate(new Date(end.getTime() - 86400000))}</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", gap: 6 }} role="radiogroup" aria-label="adjustment kind">
                    {[["deduct", t("teamKpiModeDeduct")], ["add", t("teamKpiModeAdd")]].map(([k, lbl]) => (
                      <button key={k} role="radio" aria-checked={kpiForm.kind === k} style={{ ...S.chip(kpiForm.kind === k), flex: 1 }} onClick={() => setKpiForm(f => ({ ...f, kind: k, punishmentId: k === "add" ? "" : f.punishmentId }))}>{lbl}</button>
                    ))}
                  </div>
                  {!isAdd && (punishments || []).length > 0 && (
                    <select style={S.select} value={kpiForm.punishmentId} onChange={e => { const pun = (punishments || []).find(x => x.id === e.target.value); setKpiForm(f => ({ punishmentId: e.target.value, points: pun ? String(pun.points) : f.points, reason: pun ? (pun.label + (pun.description ? `: ${pun.description}` : "")) : f.reason })); }}>
                      <option value="">{t("teamKpiCustomDeduction")}</option>
                      {(punishments || []).map(pun => <option key={pun.id} value={pun.id}>{pun.label} (−{pun.points})</option>)}
                    </select>
                  )}
                  <div style={{ display: "grid", gridTemplateColumns: "90px 1fr", gap: 8 }}>
                    <input style={S.input} type="number" min="0" step="0.1" value={kpiForm.points} placeholder={t("teamKpiPoints")} onChange={e => setKpiForm(f => ({ ...f, points: e.target.value }))} />
                    <input style={S.input} value={kpiForm.reason} placeholder={t("teamKpiReason")} onChange={e => setKpiForm(f => ({ ...f, reason: e.target.value }))} />
                  </div>
                  {kpiMsg && <p style={{ fontSize: 12, color: kpiMsg.ok ? "#2F855A" : "#C53030", margin: 0 }}>{kpiMsg.text}</p>}
                  <button data-testid="kpi-submit" style={{ ...S.btn(isAdd ? "success" : "danger"), justifyContent: "center" }} onClick={submit}>{isAdd ? t("teamKpiAdd") : t("teamKpiDeduct")}</button>
                </div>
                {myEvents.length > 0 && (
                  <div style={{ marginTop: 12, borderTop: "1px solid var(--divider-color,#D8E1EC)", paddingTop: 10 }}>
                    <p style={{ ...S.sectionTitle, marginBottom: 8 }}>{t("teamKpiHistory")}</p>
                    {myEvents.map(ev => (
                      <div key={ev.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
                        <span style={{ ...S.badge(isKpiAdd(ev) ? "green" : "red"), flexShrink: 0 }}>{isKpiAdd(ev) ? "+" : "−"}{Math.abs(parseFloat(ev.points) || 0)}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ margin: 0, fontSize: 13 }}>{ev.reason}</p>
                          <p style={{ margin: "2px 0 0", fontSize: 10, color: "var(--text-muted,#7B8FA3)" }}>{formatDateTime(ev.ts)}</p>
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
            <p style={{ color: "var(--text-muted,#5F7A91)", textAlign: "center", padding: 24 }}>{t("loading")}</p>
          ) : !profileData ? (
            <p style={{ color: "var(--text-muted,#5F7A91)", textAlign: "center", padding: 12 }}>{t("teamNoProfileDocs")}</p>
          ) : (
            <div style={S.col}>
              {profileData.photo && (
                <div style={{ display: "flex", justifyContent: "center" }}>
                  <img src={profileData.photo} alt="profile" style={{ width: 90, height: 90, borderRadius: "50%", objectFit: "cover", border: "3px solid var(--accent,#2563EB)" }} />
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
                  <p style={{ margin: 0, fontSize: 13, whiteSpace: "pre-wrap", color: "var(--text-muted,#4E6B84)" }}>{profileData.legalAddress}</p>
                </div>
              )}
              {profileData.idCard && (
                <div>
                  <p style={{ ...S.sectionTitle, marginBottom: 6 }}>{t("idCard")}</p>
                  <img src={profileData.idCard} alt="ID" style={{ width: "100%", maxWidth: 280, borderRadius: 8, border: "1px solid var(--border-color,#D8E1EC)" }} />
                </div>
              )}
              {profileData.promptPayQR && (
                <div>
                  <p style={{ ...S.sectionTitle, marginBottom: 6 }}>{t("promptPayQR")}</p>
                  <img src={profileData.promptPayQR} alt="QR" style={{ width: 120, height: 120, objectFit: "contain", borderRadius: 8, border: "1px solid var(--border-color,#D8E1EC)", background: "#fff", padding: 4 }} />
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
          <p style={{ fontSize: 11, color: "var(--text-muted,#5F7A91)", margin: 0 }}>
            {t("settingsKpiEveryoneStarts")} <strong style={{ color: "var(--accent,#2563EB)" }}>{kpiMax(kpiConfig)} pts (★★★★★)</strong>. {t("settingsKpiCurrPeriod")}{" "}
            <strong style={{ color: "var(--text,#16324A)" }}>{formatDate(p.start)} – {formatDate(endLabel)}</strong>. {t("settingsKpiDefaultStart")}
          </p>
        ); })()}
        <div style={{ borderTop: "1px solid var(--divider-color,#D8E1EC)", paddingTop: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <p style={{ ...S.sectionTitle, margin: 0 }}>{t("settingsKpiPunishments")}</p>
            <button style={{ ...S.btn("ghost"), padding: "4px 10px", fontSize: 12 }} onClick={() => setPunishments(p => [...(p || []), { id: "pun" + Date.now(), label: "", points: "", description: "" }])}><Icon d={icons.plus} size={12} /> {t("settingsKpiAddPunishment")}</button>
          </div>
          <p style={{ fontSize: 11, color: "var(--text-muted,#5F7A91)", margin: "0 0 10px" }}>{t("settingsKpiPunDesc")}</p>
          {(punishments || []).length === 0 && <p style={{ fontSize: 12, color: "var(--text-muted,#5F7A91)", margin: 0 }}>{t("settingsKpiNoPunishments")}</p>}
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

// ─── REPORTS PAGE (P2-16) ─────────────────────────────────────────────────────
// Owner reports computed client-side (src/logic/reports.js) from the data the
// app already holds: utilisation per item, the Not Returned list as CSV,
// per-customer gear history and a month-end statement of crew invoices.
export function ReportsPage({ equipment, checkouts, jobs, equipmentRequests, productionCompanies, invoices, employees }) {
  const t = useT();
  const todayStr = today();
  const [tab, setTab] = useState("util"); // util | overdue | customer | statement
  const [preset, setPreset] = useState("thisMonth");
  const [range, setRange] = useState(() => periodPreset("thisMonth", todayStr));
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const [customer, setCustomer] = useState("");
  const [month, setMonth] = useState(monthOf(todayStr));
  const pickPreset = (k) => { setPreset(k); if (k !== "custom") setRange(periodPreset(k, todayStr)); };
  const fmtN = (v) => (Math.round(v * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const tabs = [["util", t("reportsUtil")], ["overdue", t("reportsOverdue")], ["customer", t("reportsCustomer")], ["statement", t("reportsStatement")]];
  const th = { textAlign: "left", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-muted,#5F7A91)", padding: "6px 8px", borderBottom: "1px solid var(--divider-color,#D8E1EC)", whiteSpace: "nowrap" };
  const td = { fontSize: 12, padding: "7px 8px", borderBottom: "1px solid var(--divider-color,#D8E1EC)", color: "var(--text,#16324A)", verticalAlign: "top" };
  const num = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
  const exportBtn = (label, onClick) => <button style={{ ...S.btn("ghost"), fontSize: 12 }} onClick={onClick} data-testid="report-export"><Icon d={icons.invoice} size={13} /> {label}</button>;

  const utilRows = tab === "util" ? utilisation({ equipment, checkouts, jobs, from: range.from, to: range.to }) : [];
  const stillOut = tab === "overdue" ? stillOutList({ checkouts, jobs, equipment, equipmentRequests, today: todayStr, tz: APP_TZ }) : [];
  const custList = customerNames(jobs, productionCompanies);
  const hist = tab === "customer" && customer ? customerHistory({ jobs, equipment, checkouts, company: customer }) : null;
  const st = tab === "statement" ? crewStatement({ invoices, employees, month, tz: APP_TZ }) : null;
  const safe = (v) => String(v || "").replace(/[^\w.-]+/g, "_");

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h1 style={S.pageTitle}>{t("reportsTitle")}</h1>
        <p style={S.pageSubtitle}>{t("reportsSubtitle")}</p>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        {tabs.map(([k, l]) => <button key={k} data-testid={"reports-tab-" + k} style={{ ...S.btn(tab === k ? "primary" : "ghost"), padding: "7px 14px", fontSize: 12 }} onClick={() => setTab(k)}>{l}</button>)}
      </div>

      {tab === "util" && (
        <div style={S.card}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
            <span style={{ ...S.label, margin: 0 }}>{t("reportsPeriod")}</span>
            {[["thisMonth", t("reportsThisMonth")], ["lastMonth", t("reportsLastMonth")], ["last30", t("reportsLast30")], ["thisYear", t("reportsThisYear")], ["custom", t("reportsCustom")]].map(([k, l]) => (
              <button key={k} style={{ ...S.btn(preset === k ? "primary" : "ghost"), padding: "5px 10px", fontSize: 11 }} onClick={() => pickPreset(k)}>{l}</button>
            ))}
            <span style={{ flex: 1 }} />
            {exportBtn(t("reportsExportCsv"), () => downloadText(`utilisation-${range.from}-${range.to}.csv`, utilisationCsv(utilRows, range)))}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
            <label style={{ fontSize: 11, color: "var(--text-muted,#5F7A91)" }}>{t("reportsFrom")}</label>
            <input type="date" style={{ ...S.input, width: 150 }} value={range.from} onChange={e => { setPreset("custom"); setRange(r => ({ ...r, from: e.target.value })); }} />
            <label style={{ fontSize: 11, color: "var(--text-muted,#5F7A91)" }}>{t("reportsTo")}</label>
            <input type="date" style={{ ...S.input, width: 150 }} value={range.to} onChange={e => { setPreset("custom"); setRange(r => ({ ...r, to: e.target.value })); }} />
          </div>
          <p style={{ margin: "0 0 10px", fontSize: 11, color: "var(--text-muted,#5F7A91)", lineHeight: 1.5 }}>{t("reportsUtilHint")}</p>
          {utilRows.length === 0 ? <p style={{ fontSize: 13, color: "var(--text-muted,#5F7A91)", margin: 0 }}>{t("reportsNoData")}</p> : (
            <div style={{ overflowX: "auto" }}>
              <table data-testid="util-table" style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr><th style={th}>{t("reportsColItem")}</th><th style={{ ...th, textAlign: "right" }}>{t("reportsColUnits")}</th><th style={{ ...th, minWidth: 160 }}>{t("reportsColOut")} %</th><th style={{ ...th, textAlign: "right" }}>{t("reportsColBooked")} %</th><th style={{ ...th, textAlign: "right" }}>{t("reportsColPicks")}</th><th style={{ ...th, textAlign: "right" }}>{t("reportsColJobs")}</th></tr></thead>
                <tbody>
                  {utilRows.map(r => (
                    <tr key={r.eqId}>
                      <td style={td}><span style={{ fontWeight: 600 }}>{r.name}</span>{r.category ? <span style={{ color: "var(--text-muted,#5F7A91)" }}> · {r.category}</span> : null}</td>
                      <td style={num}>{r.total}</td>
                      <td style={td}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ flex: 1, height: 8, borderRadius: 4, background: "var(--surface2,#EAF0F7)", overflow: "hidden", minWidth: 80 }}><div style={{ width: `${Math.min(100, r.outPct)}%`, height: "100%", background: r.outPct >= 60 ? "#2F855A" : r.outPct >= 25 ? "var(--accent,#2563EB)" : "#B7791F" }} /></div>
                          <span style={{ fontVariantNumeric: "tabular-nums", minWidth: 44, textAlign: "right", fontWeight: 700 }}>{r.outPct}%</span>
                        </div>
                        <p style={{ margin: "2px 0 0", fontSize: 10, color: "var(--text-muted,#7B8FA3)" }}>{t("reportsUnitDays").replace("{n}", r.unitDaysOut)}</p>
                      </td>
                      <td style={num}>{r.bookedPct}%</td>
                      <td style={num}>{r.picks}</td>
                      <td style={num}>{r.jobs}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "overdue" && (
        <div style={S.card}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
            <button style={{ ...S.btn(onlyOverdue ? "primary" : "ghost"), padding: "5px 10px", fontSize: 11 }} onClick={() => setOnlyOverdue(v => !v)}>{t("reportsOnlyOverdue")}</button>
            <span style={{ flex: 1 }} />
            {exportBtn(t("reportsExportCsv"), () => downloadText(`not-returned-${todayStr}.csv`, overdueCsv(stillOut, { tz: APP_TZ, onlyOverdue })))}
          </div>
          <p style={{ margin: "0 0 10px", fontSize: 11, color: "var(--text-muted,#5F7A91)" }}>{t("reportsOverdueHint")}</p>
          {(() => {
            const rows = stillOut.filter(i => !onlyOverdue || i.overdue);
            if (rows.length === 0) return <p style={{ fontSize: 13, color: "#2F855A", margin: 0 }}>{t("dashStillOutEmpty")}</p>;
            return (
              <div style={{ overflowX: "auto" }}>
                <table data-testid="overdue-table" style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr><th style={th}>{t("reportsColStatus")}</th><th style={th}>{t("reportsColItem")}</th><th style={{ ...th, textAlign: "right" }}>{t("reportsColQty")}</th><th style={th}>{t("reportsColJob")}</th><th style={th}>{t("reportsColPickedBy")}</th><th style={{ ...th, textAlign: "right" }}>{t("reportsColDaysOut")}</th><th style={th}>{t("reportsColDue")}</th></tr></thead>
                  <tbody>
                    {rows.map(i => (
                      <tr key={i.key}>
                        <td style={td}>{i.overdue ? <span style={S.badge("red")}>{t("dashOverdueDays").replace("{n}", i.daysOverdue)}</span> : i.dueToday ? <span style={S.badge("amber")}>{t("dashDueToday")}</span> : <span style={S.badge("gray")}>{t("dashStillOutActive")}</span>}</td>
                        <td style={{ ...td, fontWeight: 600 }}>{i.eqName}{i.missing ? <span style={{ ...S.badge("red"), marginLeft: 6, fontSize: 10 }}>{t("missingN").replace("{n}", i.qty)}</span> : null}</td>
                        <td style={num}>{i.qty}</td>
                        <td style={td}>{i.jobName}{i.job && i.job.production ? <span style={{ color: "var(--text-muted,#5F7A91)" }}> · {i.job.production}</span> : null}</td>
                        <td style={td}>{i.pickedBy || "?"}</td>
                        <td style={num}>{i.daysOut}</td>
                        <td style={{ ...td, whiteSpace: "nowrap" }}>{i.dueDate ? formatDate(i.dueDate) : t("dashNoDue")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })()}
        </div>
      )}

      {tab === "customer" && (
        <div style={S.card}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
            <label style={{ ...S.label, margin: 0 }}>{t("reportsCustomerPick")}</label>
            <select data-testid="customer-select" style={{ ...S.select, width: "auto", minWidth: 220 }} value={customer} onChange={e => setCustomer(e.target.value)}>
              <option value="">{t("reportsCustomerPickHint")}</option>
              {custList.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <span style={{ flex: 1 }} />
            {hist && hist.rows.length > 0 && exportBtn(t("reportsExportCsv"), () => downloadText(`customer-${safe(customer)}.csv`, customerHistoryCsv(hist)))}
          </div>
          {!hist ? null : hist.rows.length === 0 ? <p style={{ fontSize: 13, color: "var(--text-muted,#5F7A91)", margin: 0 }}>{t("reportsNoCustomerJobs")}</p> : (
            <>
              <p data-testid="customer-totals" style={{ margin: "0 0 10px", fontSize: 12, fontWeight: 600, color: "var(--accent,#2563EB)" }}>
                {t("reportsCustomerTotals").replace("{jobs}", hist.totals.jobs).replace("{days}", hist.totals.shootDays).replace("{units}", hist.totals.units).replace("{unitDays}", hist.totals.unitDays)}
              </p>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr><th style={th}>{t("reportsColJob")}</th><th style={th}>{t("reportsColStatus")}</th><th style={th}>{t("reportsColDates")}</th><th style={{ ...th, textAlign: "right" }}>{t("reportsColShootDays")}</th><th style={{ ...th, textAlign: "right" }}>{t("reportsColHoldDays")}</th><th style={th}>{t("reportsColGear")}</th></tr></thead>
                  <tbody>
                    {hist.rows.map(r => (
                      <tr key={r.jobId}>
                        <td style={{ ...td, fontWeight: 600 }}>{r.name}</td>
                        <td style={td}><span style={S.badge(JOB_STATUS_BADGE[r.status] || "gray")}>{r.status}</span></td>
                        <td style={{ ...td, whiteSpace: "nowrap" }}>{r.first ? formatDate(r.first) : ""}{r.last && r.last !== r.first ? ` → ${formatDate(r.last)}` : ""}</td>
                        <td style={num}>{r.shootDays}</td>
                        <td style={num}>{r.holdDays}</td>
                        <td style={td}>{r.items.length === 0 ? <span style={{ color: "var(--text-muted,#8CA2B5)" }}>-</span> : r.items.map(it => <span key={it.eqId} style={{ ...S.tag, marginRight: 4, marginBottom: 4, display: "inline-block" }}>{it.name}{it.qty > 1 ? ` ×${it.qty}` : ""}</span>)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {tab === "statement" && st && (
        <div style={S.card}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
            <label style={{ ...S.label, margin: 0 }}>{t("reportsMonth")}</label>
            <input type="month" data-testid="statement-month" style={{ ...S.input, width: 170 }} value={month} onChange={e => setMonth(e.target.value || monthOf(todayStr))} />
            <span style={{ flex: 1 }} />
            {st.companies.length > 0 && exportBtn(t("reportsExportCsv"), () => downloadText(`crew-statement-${month}.csv`, crewStatementCsv(st)))}
          </div>
          <p style={{ margin: "0 0 12px", fontSize: 11, color: "var(--text-muted,#5F7A91)", lineHeight: 1.5 }}>{t("reportsStatementHint")}</p>
          {st.companies.length === 0 ? <p style={{ fontSize: 13, color: "var(--text-muted,#5F7A91)", margin: 0 }}>{t("reportsNoStatement")}</p> : (
            <div style={S.col}>
              {st.companies.map(g => (
                <div key={g.company} data-testid="statement-company" style={{ border: "1px solid var(--divider-color,#D8E1EC)", borderRadius: 8, overflow: "hidden" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "var(--surface2,#EAF0F7)", flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 700, fontSize: 13, flex: 1 }}>{g.company}</span>
                    <span style={{ fontSize: 11, color: "var(--text-muted,#5F7A91)" }}>{t("reportsInvoicesN").replace("{n}", g.rows.length)} · {t("reportsPaidUnpaid").replace("{paid}", "฿" + fmtN(g.paid)).replace("{unpaid}", "฿" + fmtN(g.unpaid))}</span>
                    <span style={{ fontWeight: 800, fontSize: 13, fontVariantNumeric: "tabular-nums" }}>฿{fmtN(g.net)}</span>
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead><tr><th style={th}>{t("reportsColCrew")}</th><th style={th}>{t("reportsColInvoice")}</th><th style={th}>{t("reportsColJob")}</th><th style={th}>{t("reportsColIssued")}</th><th style={th}>{t("reportsColStatus")}</th><th style={{ ...th, textAlign: "right" }}>{t("reportsColTotal")}</th><th style={{ ...th, textAlign: "right" }}>{t("reportsColWht")}</th><th style={{ ...th, textAlign: "right" }}>{t("reportsColNet")}</th></tr></thead>
                      <tbody>
                        {g.rows.map(r => (
                          <tr key={r.id}>
                            <td style={{ ...td, fontWeight: 600 }}>{r.employee}{r.position ? <span style={{ color: "var(--text-muted,#5F7A91)", fontWeight: 400 }}> · {r.position}</span> : null}</td>
                            <td style={{ ...td, whiteSpace: "nowrap" }}>{r.no}</td>
                            <td style={td}>{r.job}</td>
                            <td style={{ ...td, whiteSpace: "nowrap" }}>{r.issued ? formatDate(r.issued) : ""}</td>
                            <td style={td}><span style={S.badge(r.status === "Paid" ? "green" : "amber")}>{r.status === "Paid" ? `${t("reportsColPaid")}${r.paidDate ? " " + formatDate(r.paidDate) : ""}` : r.status}</span></td>
                            <td style={num}>{fmtN(r.total)}</td>
                            <td style={num}>{r.wht ? fmtN(r.wht) : "-"}</td>
                            <td style={{ ...num, fontWeight: 700 }}>{fmtN(r.net)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
              <div data-testid="statement-grand" style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 8, background: "rgba(var(--accent-rgb,37,99,235),0.06)", border: "1px solid rgba(var(--accent-rgb,37,99,235),0.2)", flexWrap: "wrap" }}>
                <span style={{ fontWeight: 700, fontSize: 13, flex: 1 }}>{t("reportsGrand")} · {t("reportsInvoicesN").replace("{n}", st.grand.count)}</span>
                <span style={{ fontSize: 11, color: "var(--text-muted,#5F7A91)" }}>{t("reportsColTotal")} ฿{fmtN(st.grand.total)} · {t("reportsColWht")} ฿{fmtN(st.grand.wht)} · {t("reportsPaidUnpaid").replace("{paid}", "฿" + fmtN(st.grand.paid)).replace("{unpaid}", "฿" + fmtN(st.grand.unpaid))}</span>
                <span style={{ fontWeight: 800, fontSize: 15, fontVariantNumeric: "tabular-nums", color: "var(--accent,#2563EB)" }}>฿{fmtN(st.grand.net)}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── ADMIN CHECKOUT PAGE ──────────────────────────────────────────────────────
export function AdminCheckoutPage({ jobs, equipment, checkouts, setCheckouts, verificationConfig, employees, equipmentRequests, reports = [] }) {
  const t = useT();
  const openReportFor = (eqId) => (reports || []).find(r => isOpenReport(r) && r.eqId === eqId) || null; // P2-2 banner
  const todayStr = today();
  const [selectedJob, setSelectedJob] = useState(null);
  const [phase, setPhase] = useState("pick"); // "pick" | "return"
  const [captureAe, setCaptureAe] = useState(null);
  const [pendingAe, setPendingAe] = useState(null);
  const [scanAe, setScanAe] = useState(null);
  const [itemResults, setItemResults] = useState({});
  const [barcodeResults, setBarcodeResults] = useState({});
  const [touched, setTouched] = useState({}); // eqIds received / written off this session (keep the row visible with its badge)
  const [receiveAe, setReceiveAe] = useState(null); // { ae, loc, lane } Receive modal
  const [lostAe, setLostAe] = useState(null);       // Mark lost modal
  const [returnDetails, setReturnDetails] = useState({ qty: 1, condition: "ok", note: "" });
  const [lostForm, setLostForm] = useState({ qty: 1, condition: "lost", note: "" });
  const capture = usePhotoCapture();
  const vMode = verificationConfig?.mode || "photo";
  const dayStartHour = verificationConfig?.dayStartHour ?? DEFAULT_DAY_START_HOUR;

  // History view state
  const [view, setView] = useState("active"); // "active" | "history"
  const [historyFilter, setHistoryFilter] = useState("year"); // "month" | "year" | "custom"
  const nowDate = new Date();
  const [historyYear, setHistoryYear] = useState(nowDate.getFullYear());
  const [historyMonth, setHistoryMonth] = useState(nowDate.getMonth()); // 0-indexed
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [historyDetailJob, setHistoryDetailJob] = useState(null); // { key, jobName, production, dates, events }

  const visibleCheckouts = checkouts.filter(c => !isVoidEvt(c.type)); // undo tombstones never show
  const earliestTs = visibleCheckouts.length > 0 ? Math.min(...visibleCheckouts.map(c => c.ts)) : Date.now();
  const earliestYear = new Date(earliestTs).getFullYear();
  const yearOptions = Array.from({ length: nowDate.getFullYear() - earliestYear + 1 }, (_, i) => earliestYear + i).reverse();
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const evtLabel = (type) => isPickEvt(type) ? "Pick" : isReturnEvt(type) ? "Return" : isLostEvt(type) ? t("condLost") : type;
  const fmtRange = (dates) => (dates || []).length > 0 ? ((dates[0] === dates[dates.length - 1]) ? formatDate(dates[0]) : `${formatDate(dates[0])} – ${formatDate(dates[dates.length - 1])}`) : "";

  const filteredHistory = visibleCheckouts.filter(ev => {
    const d = new Date(ev.ts);
    if (historyFilter === "year") return d.getFullYear() === historyYear;
    if (historyFilter === "month") return d.getFullYear() === historyYear && d.getMonth() === historyMonth;
    if (historyFilter === "custom") {
      if (customFrom && d < new Date(customFrom + "T00:00:00")) return false;
      if (customTo && d > new Date(customTo + "T23:59:59")) return false;
      return true;
    }
    return true;
  }).sort((a, b) => b.ts - a.ts);

  const exportCsv = () => {
    const label = historyFilter === "year" ? `${historyYear}` : historyFilter === "month" ? `${historyYear}-${String(historyMonth+1).padStart(2,"0")}` : "custom";
    const rows = [
      ["Date","Time","Job Name","Production Company","Employee","Equipment","Type","Qty","Condition","Note"],
      ...filteredHistory.map(ev => {
        const job = jobs.find(j => j.id === ev.jobId);
        const eq = equipment.find(e => e.id === ev.eqId);
        const d = new Date(ev.ts);
        return [
          d.toLocaleDateString("en-CA"),
          d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
          ev.jobName || job?.name || "",
          job?.production || "",
          ev.employeeName || "",
          eq?.name || ev.eqId || "",
          evtLabel(ev.type),
          ev.qty ?? 1,
          ev.condition || "",
          ev.note || "",
        ];
      }),
    ];
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `checkout-${label}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  // Count-based state shared with the crew screen (src/logic/checkoutState.js).
  const getState = (job) => jobCheckoutState(job, checkouts, { tz: APP_TZ, dayStartHour });

  // Approved gear requests behave like a job (events carry requestId), same as the crew side.
  const reqAsJob = (req) => ({
    id: "reqjob_" + req.id, __reqId: req.id, employeeName: req.employeeName,
    name: `${req.employeeName || "Crew"} · ${req.purpose === "work" ? (req.jobName || "Work") : "Personal / Practice"}`,
    production: "", dates: [...(req.useDates || [])].sort(), status: "Confirmed", checkoutMode: "span",
    assignedEquipment: (req.items || [{ eqId: req.eqId, qty: req.qty }]).map(it => ({ eqId: it.eqId, qty: it.qty || 1 })),
  });

  // Active = every Confirmed job (and approved gear request) with units still out
  // OR inside its effective pick-up..return window OR shooting today. Overdue first (P0-4).
  const activeJobs = (() => {
    const real = (jobs || []).filter(j => j.status === "Confirmed" && (j.assignedEquipment || []).length > 0);
    const reqs = (equipmentRequests || []).filter(r => r.status === "approved").map(reqAsJob);
    return [...real, ...reqs].map(job => {
      const st = getState(job);
      const dueDate = job.__reqId ? ((job.dates || []).slice(-1)[0] || null) : effReturnDate(job);
      const p = job.__reqId ? (job.dates || [])[0] : effPickupDate(job);
      const inWindow = !!(p && dueDate && todayStr >= p && todayStr <= dueDate);
      const overdue = st.outCount > 0 && !!dueDate && dueDate < todayStr;
      const dueToday = st.outCount > 0 && dueDate === todayStr;
      return { job, st, dueDate, inWindow, overdue, dueToday };
    }).filter(x => x.st.outCount > 0 || x.inWindow || (x.job.dates || []).includes(todayStr))
      .sort((a, b) => (b.overdue ? 2 : b.dueToday ? 1 : 0) - (a.overdue ? 2 : a.dueToday ? 1 : 0) || String((a.job.dates || [])[0] || "").localeCompare(String((b.job.dates || [])[0] || "")));
  })();

  // dueDate rides on every event so a still-out row keeps its due date even after the job record is deleted (P1-11).
  const evtRefOf = (job) => job.__reqId ? { jobId: null, requestId: job.__reqId, dueDate: jobLastDate(job) || null } : { jobId: job.id, requestId: null, dueDate: effReturnDate(job) || null };

  const selectJob = (job) => {
    const { allPicked, outCount } = getState(job);
    setSelectedJob(job);
    setPhase(allPicked || outCount > 0 ? "return" : "pick");
    setItemResults({});
    setBarcodeResults({});
    setTouched({});
    setCaptureAe(null);
    setPendingAe(null);
    setScanAe(null);
    setReceiveAe(null);
    setLostAe(null);
    capture.reset();
  };

  const isReturnPhase = phase === "return";

  // Writes an admin-approved pick or return. `details` = { qty, condition, note } on returns.
  const commitItem = (ae, dataUrl, loc, details) => {
    const now = Date.now();
    const type = phase === "pick" ? "pick" : "return";
    let qty = ae.qty, extra = {};
    if (type === "return") {
      const outstanding = outstandingQty(getState(selectedJob), ae.eqId);
      const condition = details?.condition || "ok";
      qty = Math.max(condition === "missing" ? 0 : 1, Math.min(outstanding, details?.qty ?? outstanding));
      const note = (details?.note || "").trim();
      extra = { condition, ...(note ? { note } : {}) };
    }
    setCheckouts(p => [...p, { id: "co" + now + ae.eqId, ...evtRefOf(selectedJob), jobName: selectedJob.name, eqId: ae.eqId, qty, employeeId: "admin", employeeName: actorName(), type, ts: now, photo: dataUrl || null, location: loc || null, adminApproved: true, by: actorName(), ...extra }]);
    setItemResults(r => ({ ...r, [ae.eqId]: "ok" }));
    setTouched(x => ({ ...x, [ae.eqId]: true }));
  };

  const commitBarcode = (ae, loc, details) => {
    const now = Date.now();
    const type = phase === "pick" ? "barcode_pick" : "barcode_return";
    let qty = ae.qty, extra = {};
    if (type === "barcode_return") {
      const outstanding = outstandingQty(getState(selectedJob), ae.eqId);
      const condition = details?.condition || "ok";
      qty = Math.max(condition === "missing" ? 0 : 1, Math.min(outstanding, details?.qty ?? outstanding));
      const note = (details?.note || "").trim();
      extra = { condition, ...(note ? { note } : {}) };
    }
    setCheckouts(p => [...p, { id: "bc" + now + ae.eqId, ...evtRefOf(selectedJob), jobName: selectedJob.name, eqId: ae.eqId, qty, employeeId: "admin", employeeName: actorName(), type, ts: now, photo: null, location: loc || null, adminApproved: true, by: actorName(), ...extra }]);
    setBarcodeResults(r => ({ ...r, [ae.eqId]: true }));
    setTouched(x => ({ ...x, [ae.eqId]: true }));
  };

  // Lost / written off: removes the units from still-out (and from availability,
  // via the same subtraction) without a return. Shape: { type:"lost", eqId, qty, jobId, ts, by }.
  const commitLost = (ae, qty, condition, note) => {
    const now = Date.now();
    const outstanding = outstandingQty(getState(selectedJob), ae.eqId);
    const q = Math.max(1, Math.min(outstanding, qty || 1));
    setCheckouts(p => [...p, { id: "lost" + now + ae.eqId, ...evtRefOf(selectedJob), jobName: selectedJob.name, eqId: ae.eqId, qty: q, employeeId: "admin", employeeName: actorName(), type: "lost", condition: condition === "written_off" ? "written_off" : "lost", ...(note ? { note: note.trim() } : {}), ts: now, photo: null, location: null, adminApproved: true, by: actorName() }]);
    setTouched(x => ({ ...x, [ae.eqId]: true }));
  };

  const freshDetails = (ae) => ({ qty: isReturnPhase ? outstandingQty(getState(selectedJob), ae.eqId) : ae.qty, condition: "ok", note: "" });
  const onTapItem = (ae, lane) => {
    if (lane === "barcode") { setScanAe(ae); return; }
    if (lane === "receive") { // no photo: Receive / Mark picked
      if (isReturnPhase) { setReturnDetails(freshDetails(ae)); setReceiveAe({ ae, loc: null, lane: "photo" }); }
      else commitItem(ae, null, null);
      return;
    }
    if (lane === "lost") { setLostForm({ qty: 1, condition: "lost", note: "" }); setLostAe(ae); return; } // one unit by default: losing the whole line is the exception
    // photo lane: open the camera synchronously inside the tap (P2-14)
    capture.reset();
    setReturnDetails(freshDetails(ae));
    setPendingAe(ae);
    capture.open();
  };
  useEffect(() => {
    if (pendingAe && (capture.busy || capture.photo || capture.err)) { setCaptureAe(pendingAe); setPendingAe(null); }
  }, [pendingAe, capture.busy, capture.photo, capture.err]);

  if (scanAe && selectedJob) {
    const eq = equipment.find(e => e.id === scanAe.eqId);
    return (
      <div style={{ minHeight: "100vh", background: "var(--bg,#F4F7FB)" }}>
        <QRScanner
          key={scanAe.eqId}
          label={`Scan QR label on: ${eq?.name || ""}`}
          onScan={(scannedId, loc) => {
            if (scannedId === scanAe.eqId) {
              if (isReturnPhase) { setReturnDetails(freshDetails(scanAe)); setReceiveAe({ ae: scanAe, loc, lane: "barcode" }); }
              else commitBarcode(scanAe, loc);
              setScanAe(null);
            }
          }}
          onClose={() => setScanAe(null)}
        />
      </div>
    );
  }

  if (captureAe && selectedJob) {
    const eq = equipment.find(e => e.id === captureAe.eqId);
    const out = outstandingQty(getState(selectedJob), captureAe.eqId);
    return (
      <div style={{ minHeight: "100vh", background: "var(--bg,#F4F7FB)" }}>
        <div style={{ padding: "16px 16px 8px", display: "flex", alignItems: "center", gap: 12 }}>
          <button style={S.btn("ghost")} onClick={() => { setCaptureAe(null); capture.reset(); }}><Icon d={icons.arrow_left} size={16} /> {t("back")}</button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--text,#16324A)" }}>{eq?.name || captureAe.eqId}</p>
            <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-muted,#5F7A91)" }}>{isReturnPhase ? t("returnPhotoTitle") : t("pickPhotoTitle")} · {selectedJob.name}</p>
          </div>
        </div>
        <div style={{ padding: "0 16px 40px", maxWidth: 520 }}>
          <GeoPhoto
            capture={capture}
            label={`${isReturnPhase ? t("adminReturnLabel") : t("adminPickLabel")} · ${eq?.name || ""}`}
            useLabel={isReturnPhase ? t("confirmReturn") : t("photoUse")}
            onUse={(dataUrl, loc) => { commitItem(captureAe, dataUrl, loc, isReturnPhase ? returnDetails : null); setCaptureAe(null); capture.reset(); }}
          >
            {isReturnPhase && <ReturnDetailsFields value={returnDetails} onChange={setReturnDetails} outstanding={out} hintKey="partialHintAdmin" />}
          </GeoPhoto>
        </div>
      </div>
    );
  }

  if (selectedJob) {
    const isReturn = isReturnPhase;
    const st = getState(selectedJob);
    const { pickedIds, returnedIds } = st;
    // Pick: every assigned item. Return: items with units out, plus rows touched this session (so the ✓ stays visible).
    const items = (selectedJob.assignedEquipment || []).filter(ae =>
      equipment.some(e => e.id === ae.eqId) && (isReturn ? (outstandingQty(st, ae.eqId) > 0 || touched[ae.eqId]) : true)
    );
    const photoDoneOf = (ae) => laneDone(st, ae.eqId, "photo", isReturn) || itemResults[ae.eqId] === "ok";
    const barcodeDoneOf = (ae) => laneDone(st, ae.eqId, "barcode", isReturn) || !!barcodeResults[ae.eqId];
    const itemDone = (ae) => {
      if (isReturn) return outstandingQty(st, ae.eqId) === 0;
      if (vMode === "both") return barcodeDoneOf(ae) && photoDoneOf(ae);
      if (vMode === "barcode") return barcodeDoneOf(ae);
      return photoDoneOf(ae) || pickedIds.has(ae.eqId);
    };
    const allDone = items.length > 0 && items.every(itemDone);
    const showPhoto = vMode === "photo" || vMode === "both";
    const showScan = vMode === "barcode" || vMode === "both";

    return (
      <div style={{ minHeight: "100vh", background: "var(--bg,#F4F7FB)", paddingBottom: 100 }}>
        {capture.input}
        <div style={{ padding: "16px 16px 0", display: "flex", alignItems: "center", gap: 12, borderBottom: "1px solid var(--divider-color,#D8E1EC)", paddingBottom: 14, marginBottom: 16, flexWrap: "wrap" }}>
          <button style={S.btn("ghost")} onClick={() => setSelectedJob(null)}><Icon d={icons.arrow_left} size={16} /> {t("back")}</button>
          <div style={{ flex: 1, minWidth: 160 }}>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--text,#16324A)" }}>{selectedJob.name}{selectedJob.__reqId ? <span style={{ ...S.badge("blue"), marginLeft: 6 }}>{t("adminRequestBadge")}</span> : null}</p>
            <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-muted,#5F7A91)" }}>{isReturn ? t("adminReturnLabel") : t("adminPickLabel")}{(selectedJob.dates || []).length ? ` · ${fmtRange(selectedJob.dates)}` : ""}</p>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button style={{ ...S.btn(!isReturn ? "primary" : "ghost"), padding: "6px 12px", fontSize: 12 }} onClick={() => { setPhase("pick"); setItemResults({}); setTouched({}); }}>{t("adminPickLabel")}</button>
            <button style={{ ...S.btn(isReturn ? "primary" : "ghost"), padding: "6px 12px", fontSize: 12 }} onClick={() => { setPhase("return"); setItemResults({}); setTouched({}); }}>{t("adminReturnLabel")}</button>
          </div>
        </div>
        <div style={{ padding: "0 16px" }}>
          {items.length === 0 ? (
            <p style={{ color: "var(--text-muted,#5F7A91)", textAlign: "center", padding: 32 }}>{isReturn ? t("adminNoItemsOut") : t("adminAllPicked")}</p>
          ) : items.map(ae => {
            const eq = equipment.find(e => e.id === ae.eqId);
            const done = itemDone(ae);
            const counts = st.items[ae.eqId];
            const out = outstandingQty(st, ae.eqId);
            const barcodeDone = barcodeDoneOf(ae);
            const photoDone = photoDoneOf(ae);
            const lostUnits = counts?.lost || 0;
            return (
              <div key={ae.eqId} data-testid={`admin-item-${ae.eqId}`} style={{ ...S.card, display: "flex", alignItems: "center", gap: 12, marginBottom: 10, flexWrap: "wrap", opacity: done ? 0.6 : 1 }}>
                {eq?.photo ? (
                  <img src={eq.photo} alt="" style={{ width: 44, height: 44, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />
                ) : (
                  <div style={{ width: 44, height: 44, borderRadius: 8, background: "var(--divider-color,#D8E1EC)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <Icon d={icons.gear} size={18} color="var(--text-muted,#7B8FA3)" />
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 160 }}>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--text,#16324A)" }}>{eq?.name || ae.eqId}</p>
                  <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--text-muted,#5F7A91)", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    {isReturn ? <span>{t("outOfN").replace("{out}", out).replace("{total}", ae.qty)}</span> : ae.qty > 1 ? <span>×{ae.qty}</span> : null}
                    {counts?.missing && out > 0 && <span style={S.badge("red")}>{t("missingN").replace("{n}", out)}</span>}
                    {(counts?.lostBy?.lost || 0) > 0 && <span style={S.badge("gray")}>{t("lostBadgeLost")} ×{counts.lostBy.lost}</span>}
                    {(counts?.lostBy?.written_off || 0) > 0 && <span style={S.badge("gray")}>{t("lostBadgeWrittenOff")} ×{counts.lostBy.written_off}</span>}
                    {isReturn && counts?.owner?.employeeName && <span>{t("adminPickedBy").replace("{name}", counts.owner.employeeName)}</span>}
                  </p>
                  {!isReturn && !done && openReportFor(ae.eqId) && (
                    <p data-testid={`admin-damage-banner-${ae.eqId}`} style={{ margin: "4px 0 0", fontSize: 11, fontWeight: 700, color: "#C53030", lineHeight: 1.4 }}>⚠ {t("assignDamageBanner")}{openReportFor(ae.eqId).description ? ` (${openReportFor(ae.eqId).description})` : ""}</p>
                  )}
                  {vMode === "both" && !done && !isReturn && (
                    <p style={{ margin: "3px 0 0", fontSize: 11, color: "var(--text-muted,#5F7A91)" }}>
                      {barcodeDone ? "✓ Scanned" : "○ Scan"} · {photoDone ? "✓ Photo" : "○ Photo"}
                    </p>
                  )}
                </div>
                {done ? (
                  <span style={{ ...S.badge("green"), flexShrink: 0 }}>✓ {isReturn ? (lostUnits > 0 && (counts?.returned || 0) === 0 ? ((counts?.lostBy?.written_off || 0) >= lostUnits ? t("lostBadgeWrittenOff") : t("lostBadgeLost")) : t("rowReturned")) : t("rowPicked")}</span>
                ) : (
                  <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap" }}>
                    <button style={{ ...S.btn("primary"), padding: "6px 12px", fontSize: 12 }} onClick={() => onTapItem(ae, "receive")}>
                      <Icon d={icons.check} size={14} /> {isReturn ? t("adminReceive") : t("adminMarkPicked")}
                    </button>
                    {showPhoto && !photoDone && (
                      <button style={{ ...S.btn("ghost"), padding: "6px 10px", fontSize: 12 }} onClick={() => onTapItem(ae, "photo")}>
                        <Icon d={icons.camera} size={14} /> {t("adminTakePhoto")}
                      </button>
                    )}
                    {showScan && !barcodeDone && (
                      <button style={{ ...S.btn("ghost"), padding: "6px 10px", fontSize: 12 }} onClick={() => onTapItem(ae, "barcode")}>
                        <Icon d={icons.qr} size={14} /> {t("adminScanQr")}
                      </button>
                    )}
                    {isReturn && out > 0 && (
                      <button style={{ ...S.btn("danger"), padding: "6px 10px", fontSize: 12 }} onClick={() => onTapItem(ae, "lost")}>
                        <Icon d={icons.alert} size={14} /> {t("adminMarkLost")}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {allDone && (
            <div style={{ ...S.card, background: "rgba(47,133,90,0.07)", border: "1px solid rgba(47,133,90,0.25)", textAlign: "center", padding: 20, marginTop: 8 }}>
              <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#2F855A" }}>✓ {isReturn ? t("adminAllReturned") : t("adminAllPicked")}</p>
            </div>
          )}
        </div>

        {receiveAe && (() => {
          const eq = equipment.find(e => e.id === receiveAe.ae.eqId);
          const out = outstandingQty(st, receiveAe.ae.eqId);
          return (
            <Modal title={`${t("adminReceiveTitle")} · ${eq?.name || ""}`} onClose={() => setReceiveAe(null)}>
              <p style={{ margin: "0 0 4px", fontSize: 12, color: "var(--text-muted,#5F7A91)" }}>{t("adminReceiveHint")}</p>
              <ReturnDetailsFields value={returnDetails} onChange={setReturnDetails} outstanding={out} compact hintKey="partialHintAdmin" />
              <button style={{ ...S.btn("primary"), width: "100%", justifyContent: "center", marginTop: 16, padding: "12px" }} data-testid="receive-confirm" onClick={() => {
                if (receiveAe.lane === "barcode") commitBarcode(receiveAe.ae, receiveAe.loc, returnDetails);
                else commitItem(receiveAe.ae, null, receiveAe.loc, returnDetails);
                setReceiveAe(null);
              }}><Icon d={icons.check} size={15} /> {t("adminReceive")}</button>
            </Modal>
          );
        })()}

        {lostAe && (() => {
          const eq = equipment.find(e => e.id === lostAe.eqId);
          const out = outstandingQty(st, lostAe.eqId);
          const q = Math.max(1, Math.min(out, lostForm.qty || 1));
          return (
            <Modal title={`${t("adminMarkLostTitle")} · ${eq?.name || ""}`} onClose={() => setLostAe(null)}>
              <p style={{ margin: "0 0 12px", fontSize: 12, color: "#C53030" }}>{t("adminMarkLostHint")}</p>
              {out > 1 && (
                <div style={{ marginBottom: 12 }}>
                  <label style={S.label}>{t("adminLostUnits")} <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>{t("returnQtyOf").replace("{n}", out)}</span></label>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <button type="button" style={{ ...S.btn("ghost"), padding: "8px 14px", fontSize: 16 }} disabled={q <= 1} onClick={() => setLostForm(f => ({ ...f, qty: q - 1 }))}>−</button>
                    <span style={{ minWidth: 48, textAlign: "center", fontSize: 20, fontWeight: 800 }} data-testid="lost-qty">{q}</span>
                    <button type="button" style={{ ...S.btn("ghost"), padding: "8px 14px", fontSize: 16 }} disabled={q >= out} onClick={() => setLostForm(f => ({ ...f, qty: q + 1 }))}>+</button>
                  </div>
                </div>
              )}
              <label style={S.label}>{t("adminLostReason")}</label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                {[["lost", "adminLost"], ["written_off", "adminWrittenOff"]].map(([id, key]) => (
                  <button key={id} type="button" style={{ ...S.btn(lostForm.condition === id ? "primary" : "ghost"), padding: "7px 12px", fontSize: 12 }} onClick={() => setLostForm(f => ({ ...f, condition: id }))}>{t(key)}</button>
                ))}
              </div>
              <label style={S.label}>{t("returnNote")}</label>
              <input style={S.input} value={lostForm.note} onChange={e => setLostForm(f => ({ ...f, note: e.target.value }))} data-testid="lost-note" />
              <button style={{ ...S.btn("danger"), width: "100%", justifyContent: "center", marginTop: 16, padding: "12px" }} data-testid="lost-confirm" onClick={() => { commitLost(lostAe, q, lostForm.condition, lostForm.note); setLostAe(null); }}>
                <Icon d={icons.alert} size={15} /> {t("adminMarkLost")}
              </button>
            </Modal>
          );
        })()}
      </div>
    );
  }

  if (historyDetailJob) {
    const jobEvents = filteredHistory.filter(ev => (ev.jobId || ("_" + ev.jobName)) === historyDetailJob.key).sort((a, b) => b.ts - a.ts);
    const exportJobCsv = () => {
      const label = historyFilter === "year" ? `${historyYear}` : historyFilter === "month" ? `${historyYear}-${String(historyMonth+1).padStart(2,"0")}` : "custom";
      const rows = [
        ["Date","Time","Job Name","Production Company","Employee","Equipment","Type","Qty","Condition","Note"],
        ...jobEvents.map(ev => {
          const eq = equipment.find(e => e.id === ev.eqId);
          const d = new Date(ev.ts);
          return [d.toLocaleDateString("en-CA"), d.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"}), historyDetailJob.jobName, historyDetailJob.production, ev.employeeName||"", eq?.name||ev.eqId||"", evtLabel(ev.type), ev.qty ?? 1, ev.condition || "", ev.note || ""];
        }),
      ];
      const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
      const blob = new Blob([csv],{type:"text/csv"});
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href=url; a.download=`checkout-${historyDetailJob.jobName.replace(/\s+/g,"-")}-${label}.csv`; a.click();
      URL.revokeObjectURL(url);
    };
    return (
      <div style={{ padding: "20px 16px 100px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <button style={S.btn("ghost")} onClick={() => setHistoryDetailJob(null)}><Icon d={icons.arrow_left} size={16} /> {t("back")}</button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--text,#16324A)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{historyDetailJob.jobName}</p>
            {historyDetailJob.production && <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--accent,#2563EB)", fontWeight: 600 }}>{historyDetailJob.production}</p>}
            {historyDetailJob.dates.length > 0 && <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-muted,#5F7A91)" }}>{fmtRange(historyDetailJob.dates)}</p>}
          </div>
          <button onClick={exportJobCsv} style={{ ...S.btn("ghost"), padding: "6px 12px", fontSize: 12, display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
            <Icon d={icons.invoice} size={13} />CSV
          </button>
        </div>
        {jobEvents.length === 0 ? (
          <p style={{ color: "var(--text-muted,#5F7A91)", textAlign: "center", padding: 32 }}>No events in this period.</p>
        ) : jobEvents.map(ev => {
          const eq = equipment.find(e => e.id === ev.eqId);
          const d = new Date(ev.ts);
          const isPick = isPickEvt(ev.type);
          const isLost = isLostEvt(ev.type);
          const condKey = conditionKey(ev.condition);
          return (
            <div key={ev.id} style={{ ...S.card, display: "flex", alignItems: "center", gap: 12, marginBottom: 8, padding: "12px 14px" }}>
              <div style={{ width: 3, alignSelf: "stretch", minHeight: 32, borderRadius: 2, flexShrink: 0, background: isPick ? "var(--accent,#2563EB)" : isLost ? "#C53030" : "#2F855A" }} />
              {eq?.photo ? (
                <img src={eq.photo} alt="" style={{ width: 36, height: 36, borderRadius: 7, objectFit: "cover", flexShrink: 0 }} />
              ) : (
                <div style={{ width: 36, height: 36, borderRadius: 7, background: "var(--divider-color,#D8E1EC)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Icon d={icons.gear} size={15} color="var(--text-muted,#7B8FA3)" />
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--text,#16324A)" }}>{eq?.name || ev.eqId}{(ev.qty ?? 1) > 1 ? ` ×${ev.qty}` : ""}</p>
                <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-muted,#5F7A91)" }}>{ev.employeeName} · {formatDateTime(ev.ts)}{condKey && ev.condition !== "ok" ? ` · ${t(condKey)}` : ""}{ev.note ? ` · ${ev.note}` : ""}</p>
              </div>
              <span style={{ ...S.badge(isPick ? "amber" : isLost ? "red" : "green"), flexShrink: 0 }}>{evtLabel(ev.type)}</span>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div style={{ padding: "20px 16px 100px" }}>
      <h1 style={{ ...S.pageTitle, marginBottom: 4 }}>{t("adminCheckoutTitle")}</h1>
      <p style={{ ...S.pageSubtitle, marginBottom: 16 }}>{t("adminCheckoutDesc")}</p>
      {/* Tab switcher */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {[["active", t("adminActiveJobs")], ["history", t("adminHistory")]].map(([key, label]) => (
          <button key={key} onClick={() => setView(key)} style={{ ...S.btn(view === key ? "primary" : "ghost"), padding: "7px 18px", fontSize: 13 }}>{label}</button>
        ))}
        {view === "history" && (
          <button onClick={exportCsv} style={{ ...S.btn("ghost"), padding: "7px 14px", fontSize: 13, marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
            <Icon d={icons.invoice} size={14} />{t("adminExportCsv")}
          </button>
        )}
      </div>

      {view === "active" ? (
        <>
          <p style={{ fontSize: 12, color: "var(--text-muted,#5F7A91)", marginBottom: 16 }}>{t("adminActiveDesc")}</p>
          {activeJobs.length === 0 ? (
            <p style={{ color: "var(--text-muted,#5F7A91)", textAlign: "center", padding: 32 }}>{t("adminNothingActive")}</p>
          ) : activeJobs.map(({ job, st, dueDate, overdue, dueToday }) => {
            const missingUnits = Object.values(st.items).reduce((n, it) => n + (it.missing ? it.out : 0), 0);
            return (
              <div key={job.id} data-testid={`admin-job-${job.id}`} style={{ ...S.card, marginBottom: 12, cursor: "pointer", border: overdue ? "1px solid rgba(197,48,48,0.4)" : undefined }} onClick={() => selectJob(job)}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "var(--text,#16324A)" }}>{job.name}{job.__reqId ? <span style={{ ...S.badge("blue"), marginLeft: 6 }}>{t("adminRequestBadge")}</span> : null}</p>
                    {job.production && <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--accent,#2563EB)", fontWeight: 600 }}>{job.production}</p>}
                    <p style={{ margin: "3px 0 0", fontSize: 11, color: "var(--text-muted,#5F7A91)" }}>
                      {tCount(t, "countItems", (job.assignedEquipment || []).length)} · {fmtRange(job.dates) || ""}
                      {dueDate && st.outCount > 0 ? ` · ${overdue ? t("adminOverdue") : dueToday ? t("adminDueToday") : t("adminDue").replace("{d}", formatDate(dueDate))}` : ""}
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    {overdue && <span style={S.badge("red")}>{t("adminOverdue")}</span>}
                    {!overdue && dueToday && <span style={S.badge("amber")}>{t("adminDueToday")}</span>}
                    {missingUnits > 0 && <span style={S.badge("red")}>{t("missingN").replace("{n}", missingUnits)}</span>}
                    {st.allReturned
                      ? <span style={S.badge("green")}>{t("adminAllReturned")}</span>
                      : st.outCount > 0
                        ? <span style={S.badge("amber")}>{st.outUnits} {t("outBadge")}</span>
                        : <span style={S.badge("gray")}>{t("adminPickLabel")}</span>
                    }
                  </div>
                </div>
              </div>
            );
          })}
        </>
      ) : (
        <>
          {/* History filter row */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16, alignItems: "center" }}>
            {[["month","Month"], ["year","Year"], ["custom","Custom"]].map(([k, lbl]) => (
              <button key={k} onClick={() => setHistoryFilter(k)} style={{ ...S.btn(historyFilter === k ? "primary" : "ghost"), padding: "5px 12px", fontSize: 12 }}>{lbl}</button>
            ))}
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              {historyFilter === "month" && (
                <>
                  <select value={historyYear} onChange={e => setHistoryYear(+e.target.value)} style={{ ...S.select, width: "auto", padding: "5px 10px", fontSize: 12 }}>
                    {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                  <select value={historyMonth} onChange={e => setHistoryMonth(+e.target.value)} style={{ ...S.select, width: "auto", padding: "5px 10px", fontSize: 12 }}>
                    {MONTHS.map((m, i) => {
                      const disabled = (historyYear === nowDate.getFullYear() && i > nowDate.getMonth()) || (historyYear === earliestYear && i < new Date(earliestTs).getMonth());
                      return <option key={i} value={i} disabled={disabled}>{m}</option>;
                    })}
                  </select>
                </>
              )}
              {historyFilter === "year" && (
                <select value={historyYear} onChange={e => setHistoryYear(+e.target.value)} style={{ ...S.select, width: "auto", padding: "5px 10px", fontSize: 12 }}>
                  {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              )}
              {historyFilter === "custom" && (
                <>
                  <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} style={{ ...S.input, width: "auto", padding: "5px 10px", fontSize: 12 }} />
                  <span style={{ color: "var(--text-muted,#5F7A91)", fontSize: 12 }}>–</span>
                  <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} style={{ ...S.input, width: "auto", padding: "5px 10px", fontSize: 12 }} />
                </>
              )}
            </div>
            <span style={{ fontSize: 11, color: "var(--text-muted,#5F7A91)", marginLeft: "auto" }}>{filteredHistory.length} events</span>
          </div>

          {filteredHistory.length === 0 ? (
            <p style={{ color: "var(--text-muted,#5F7A91)", textAlign: "center", padding: 32 }}>No checkout events in this period.</p>
          ) : (() => {
            const groupMap = {};
            filteredHistory.forEach(ev => {
              const key = ev.jobId || ("_" + ev.jobName);
              if (!groupMap[key]) {
                const job = jobs.find(j => j.id === ev.jobId);
                groupMap[key] = { key, jobId: ev.jobId, jobName: ev.jobName || job?.name || "—", production: job?.production || "", dates: job?.dates || [], events: [] };
              }
              groupMap[key].events.push(ev);
            });
            const groups = Object.values(groupMap).sort((a, b) => Math.max(...b.events.map(e => e.ts)) - Math.max(...a.events.map(e => e.ts)));
            return groups.map(grp => {
              const pickCount = grp.events.filter(e => isPickEvt(e.type)).length;
              const returnCount = grp.events.filter(e => isReturnEvt(e.type)).length;
              const lostCount = grp.events.filter(e => isLostEvt(e.type)).length;
              const dateRange = fmtRange(grp.dates);
              return (
                <div key={grp.key} style={{ ...S.card, marginBottom: 10, cursor: "pointer" }} onClick={() => setHistoryDetailJob(grp)}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "var(--text,#16324A)" }}>{grp.jobName}</p>
                      {grp.production && <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--accent,#2563EB)", fontWeight: 600 }}>{grp.production}</p>}
                      {dateRange && <p style={{ margin: "3px 0 0", fontSize: 11, color: "var(--text-muted,#5F7A91)" }}>{dateRange}</p>}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                      <span style={S.badge("amber")}>{pickCount} pick</span>
                      <span style={S.badge("green")}>{returnCount} return</span>
                      {lostCount > 0 && <span style={S.badge("red")}>{lostCount} {t("condLost").toLowerCase()}</span>}
                    </div>
                    <Icon d={icons.arrow_left} size={14} color="var(--text-muted,#7B8FA3)" strokeW={2} style={{ transform: "rotate(180deg)", flexShrink: 0 }} />
                  </div>
                </div>
              );
            });
          })()}
        </>
      )}
    </div>
  );
}
