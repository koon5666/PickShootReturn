// Crew portal (P3-8 code split): EmployeeView with its report modal and step bar.
// Lazy chunk loaded after a crew login; an admin session never downloads it.
import { useState, useEffect, useRef, useContext } from "react";
import { DEFAULT_OT_TIERS, calcTotal, otExample } from "../logic/money.js";
import { jobLastDate, effPickupDate, effReturnDate, isOpenReport } from "../logic/availability.js";
import { isPickEvt, isVoidEvt, jobCheckoutState, outstandingQty, latestOpenPick, laneDone, geoGate, voidEvent, DEFAULT_DAY_START_HOUR, DEFAULT_GEO_THRESHOLD_M } from "../logic/checkoutState.js";
import { derivePrefix, sanitizePrefix, rtxNoFromInv } from "../logic/docNumber.js";
import { printableItems, stampCompanyEdit } from "../logic/invoiceDoc.js";
import { useToast } from "../components/toast.jsx";
import { formatDate, formatDateTime, formatDay, formatLongDay, tCount, shootTimeLabel, locationLabel, statusLabel } from "../i18n/format.js";
import { kpiMax, kpiStars, isKpiAdd, visibleKpiRules } from "../logic/kpi.js";
import { myRosterEntry, jobVisibility, splitJobsForEmployee, crewNames } from "../logic/roster.js";
import { JOB_STATUS_BADGE, j, api, actorName, Icon, icons, APP_TZ, today, fmtClock, haversineMeters, addDaysStr, kpiPeriod, kpiScore, kpiEventsInPeriod, StarRating, compressImage, S, Modal, usePhotoCapture, GeoPhoto, ReturnDetailsFields, QRScanner, LangCtx, useRoleList, useT, LangPill, calcAvailable, calcAvailableSpan, describeReasons, AvReasons, printQRForItems, EQ_SORT_OPTIONS, calendarUrl } from "../ui/shared.jsx";
import { makeSignatureTransparent, fmtInvoiceNo, buildInvoiceHTML, printInvoice, PaidDialog, applyPaidChange, issueReceiptFor, InvoiceCreateModal } from "./invoice.jsx";
import { JobDetailModal, DashboardCalendar } from "./calendar.jsx";

// ─── STEP BAR (Pick → Shoot → Return) ────────────────────────────────────────
export function StepBar({ currentStep }) {
  const t = useT();
  const steps = [t("stepPickUp"), t("stepShoot"), t("stepReturn")];
  return (
    <div style={{ display: "flex", alignItems: "center", background: "var(--topbar-bg,#FFFFFF)", borderRadius: 10, padding: "12px 16px", marginBottom: 20 }}>
      {steps.map((label, i) => {
        const done = i < currentStep;
        const active = i === currentStep;
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", flex: 1 }}>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
              <div style={{ width: 26, height: 26, borderRadius: "50%", background: done ? "#2F855A" : active ? "var(--accent,#2563EB)" : "var(--divider-color,#D8E1EC)", display: "flex", alignItems: "center", justifyContent: "center", border: `2px solid ${done ? "#2F855A" : active ? "var(--accent,#2563EB)" : "var(--border-color,#D8E1EC)"}` }}>
                {done
                  ? <Icon d={icons.check} size={12} color="var(--accent-text,#FFFFFF)" strokeW={3} />
                  : <span style={{ fontSize: 10, fontWeight: 800, color: active ? "var(--accent-text,#FFFFFF)" : "var(--text-muted,#7B8FA3)" }}>{i + 1}</span>}
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: done ? "#2F855A" : active ? "var(--accent,#2563EB)" : "var(--text-muted,#8CA2B5)" }}>{label}</span>
            </div>
            {i < 2 && <div style={{ flex: 0, width: 20, height: 2, background: done ? "#2F855A" : "var(--divider-color,#D8E1EC)", marginBottom: 18, flexShrink: 0 }} />}
          </div>
        );
      })}
    </div>
  );
}

// ─── EMPLOYEE VIEW ────────────────────────────────────────────────────────────
export function EmployeeView({ employee, jobs, equipment, checkouts, setCheckouts, reports, setReports, invoices, setInvoices, productionCompanies, setProductionCompanies, companyName, setLang, onLogout, calendarToken, employees, equipmentRequests, setEquipmentRequests, adminRequests, setAdminRequests, lineGroupId, lineNotifyMuted, kpiConfig, kpiEvents, punishments, verificationConfig, saveNow, offlineMode, offlinePendingCount = 0, putProfile = api.putProfile, invoicePresets, chatEnabled, chatUnread, onOpenChat }) {
  const t = useT();
  const lang = useContext(LangCtx);
  const [tab, setTab] = useState("today"); // today | calendar | profile | gear | invoice
  const [showReportModal, setShowReportModal] = useState(false);
  const [showGearRequest, setShowGearRequest] = useState(false);
  const [gearReqForm, setGearReqForm] = useState({ useDates: [], purpose: "practice", productionName: "", jobName: "", reason: "", selectedGear: {} });
  const [gearReqCalMonth, setGearReqCalMonth] = useState(() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() }; });
  const [pinChangeForm, setPinChangeForm] = useState({ oldPin: "", newPin: "", confirmPin: "" });
  const [pinChangeBusy, setPinChangeBusy] = useState(false);
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
  const [profileInfo, setProfileInfo] = useState({ firstName: "", lastName: "", nickname: "", phone: "", email: "", lineId: "", legalAddress: "", bankName: "", bankAccount: "", accountName: "", invoicePrefix: "", taxId: "" });
  const [docConsent, setDocConsent] = useState({}); // { idCard, signature, promptPayQR: ts } stamped on upload (P0-7)
  const [paidDialog, setPaidDialog] = useState(null); // { mode: "paid" | "unpaid", inv }
  const [shareInfo, setShareInfo] = useState({}); // { [invId]: { views, expiresAt, expired } } fetched for active links
  const toast = useToast();
  const [idCard, setIdCard] = useState(null);
  const [promptPayQR, setPromptPayQR] = useState(null);
  const [signature, setSignature] = useState(null);
  const [positions, setPositions] = useState([]); // [{ id, name, dayRate, hoursPerDay, variableOT, otMultiplier, otTiers }]
  const houseRoles = useRoleList(lang); // house list when the admin set one, departments otherwise (P3-4)
  const [lineLink, setLineLink] = useState(null); // { linked, code, expiresAt } from /api/line-link (P3-6)
  useEffect(() => { if (tab === "profile" && !offlineMode) api.lineLink().then(r => { if (r && r.ok) setLineLink(r); }).catch(() => {}); }, [tab]); // eslint-disable-line
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [invoiceModal, setInvoiceModal] = useState(null); // null | { job, existing }
  const [expandedInv, setExpandedInv] = useState(null);
  const [expandedStat, setExpandedStat] = useState("today"); // null | "today" | "confirmed" | "pencil" — default open so the day's pickups are visible on open
  const [empDetailJob, setEmpDetailJob] = useState(null);
  const [invFilter, setInvFilter] = useState("all"); // all | Pending | Paid
  const [invSort, setInvSort] = useState("date"); // date | amount
  const [invDocType, setInvDocType] = useState("all"); // all | invoice | quotation | receipt
  const [invSending, setInvSending] = useState(null); // invoice id currently being sent
  const [invShowAllJobs, setInvShowAllJobs] = useState(false); // P1-10: invoice tab lists my jobs unless toggled
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
  // Photo capture (P2-14 / P1-4): the row's Photo button opens the native camera
  // synchronously; pendingAe = row tapped, captureAe = preview screen shown.
  const capture = usePhotoCapture();
  const [pendingAe, setPendingAe] = useState(null);
  const [returnDetails, setReturnDetails] = useState({ qty: 1, condition: "ok", note: "" }); // P1-1 per-return details
  const [detailsAe, setDetailsAe] = useState(null); // { ae, loc, lane } none-mode / barcode-lane return awaiting details
  const [sessionEvents, setSessionEvents] = useState({}); // { [eqId]: [eventId] } picks made this session (undo)

  const todayStr = today();
  // Role label under the name: the profile's own positions, never a hard-coded "Camera Crew" (P3-6)
  const crewRoleLabel = positions.map(p => (p.name || "").trim()).filter(Boolean).slice(0, 2).join(" · ") || t("crewRoleFallback");
  // Every tab / screen change starts at the top so the page title is visible (P2-15)
  useEffect(() => { try { window.scrollTo(0, 0); } catch {} }, [tab, phase, captureAe, scanAe]);
  // Early pickup approved for me today → job becomes actionable even before its pickup day
  const earlyPickupApproved = (j) => (adminRequests || []).some(r => r.type === "early-pickup" && r.status === "approved" && r.jobId === j.id && r.employeeId === employee.id && r.requestedDate === todayStr);
  const earlyReturnApproved = (j) => (adminRequests || []).some(r => r.type === "early-return" && r.status === "approved" && r.jobId === j.id && r.employeeId === employee.id && r.requestedDate === todayStr);
  const inJobWindow = (j) => { const p = effPickupDate(j), r = effReturnDate(j); return p && r && todayStr >= p && todayStr <= r; };
  const availableJobs = jobs.filter(j => j.status === "Confirmed" && (j.assignedEquipment || []).length > 0 && (inJobWindow(j) || earlyPickupApproved(j)));
  // Roster (P1-10): "mine" = I am on the crew, or the job has no roster yet (open);
  // "other" = staffed with someone else. Other jobs stay reachable but collapsed.
  const isOtherJob = (j) => jobVisibility(j, employee.id) === "other";
  const myEntry = (j) => myRosterEntry(j, employee.id);
  const [showOthers, setShowOthers] = useState({}); // { [statKey]: true }
  const myReports = [...(reports || [])].sort((a, b) => b.ts - a.ts);

  // ── Approved gear requests behave like a job in the checkout flow ──────────
  // Pseudo-job carries __reqId; checkout events for it use requestId instead of jobId.
  const reqAsJob = (req) => ({
    id: "reqjob_" + req.id, __reqId: req.id,
    name: req.purpose === "work" ? (req.jobName || "Work") : "Personal / Practice",
    dates: [...(req.useDates || [])].sort(),
    status: "Confirmed", checkoutMode: "span",
    assignedEquipment: (req.items || [{ eqId: req.eqId, qty: req.qty }]).map(it => ({ eqId: it.eqId, qty: it.qty || 1 })),
  });
  const evtMatchesJob = (c, job) => job.__reqId ? c.requestId === job.__reqId : c.jobId === job.id;

  // ── Early pickup / early return requests (admin must approve) ──────────────
  const earlyReqPending = (type, jobId) => (adminRequests || []).some(r => r.type === type && r.status === "pending" && r.jobId === jobId && r.employeeId === employee.id);
  const submitEarlyRequest = (type, job) => {
    const label = type === "early-pickup" ? "Early pickup" : "Early return";
    setAdminRequests(p => [...(p || []), { id: "ar" + Date.now(), type, status: "pending", submittedAt: new Date().toISOString(), employeeId: employee.id, employeeName: employee.name, jobId: job.id, jobName: job.name, requestedDate: todayStr, name: `${label}: ${job.name}` }]);
    if (lineGroupId && !lineNotifyMuted) {
      const emoji = type === "early-pickup" ? "⏰" : "🔙";
      api.notify({ userIds: [lineGroupId], message: `${emoji} [${label} Request] ${employee.name}\n🎬 ${job.name}\n📅 ${formatDate(todayStr)}\n🔗 https://pickshootreturn.pages.dev` });
    }
  };

  // ── Verification mode helpers ────────────────────────────────────────────────
  const vMode = verificationConfig?.mode || "photo";
  const isAdmin = employee.id === "admin";

  // P2-2: an open damage report on an item warns on the pick row (the unit is
  // out of service; the house may still hand it over knowingly).
  const openReportFor = (eqId) => (reports || []).find(r => isOpenReport(r) && r.eqId === eqId) || null;

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
    // "none": the photo lane doubles as the tap lane (onTapItem commits without a
    // photo when vMode === "none"), so the crew still gets an Out / Return button.
    return { barcode: false, photo: canPhoto };
  };

  // Count-based checkout state (src/logic/checkoutState.js): picked - returned - lost
  // per eqId; daily mode buckets by the configurable production day (P1-1 / P1-2).
  const dayStartHour = verificationConfig?.dayStartHour ?? DEFAULT_DAY_START_HOUR;
  const geoThresholdM = verificationConfig?.geoThresholdM || DEFAULT_GEO_THRESHOLD_M;
  const getJobCheckoutState = (job) => jobCheckoutState(job, checkouts, { tz: APP_TZ, dayStartHour });

  // Load full profile from cloud
  useEffect(() => {
    api.getProfile(employee.id).then(d => {
      if (!d) { setProfileInfo(p => ({ ...p, invoicePrefix: p.invoicePrefix || derivePrefix({ name: employee.name, id: employee.id }) })); return; }
      if (d.photo) setProfilePhoto(d.photo);
      // Prefix is mandatory (P0-6): default it from the nickname / first name / account name so the crew's series is always their own.
      const invoicePrefix = derivePrefix({ invoicePrefix: d.invoicePrefix, nickname: d.nickname, firstName: d.firstName, name: employee.name, id: employee.id });
      setProfileInfo({ firstName: d.firstName || "", lastName: d.lastName || "", nickname: d.nickname || "", phone: d.phone || "", email: d.email || "", lineId: d.lineId || "", legalAddress: d.legalAddress || "", bankName: d.bankName || "", bankAccount: d.bankAccount || "", accountName: d.accountName || "", invoicePrefix, taxId: d.taxId || "" });
      if (d.consent && typeof d.consent === "object") setDocConsent(d.consent);
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
        .map(p => ({ id: p.id, name: p.name.trim(), dayRate: parseFloat(p.dayRate) || 0, hoursPerDay: parseFloat(p.hoursPerDay) || 12, variableOT: !!p.variableOT, otMultiplier: parseFloat(p.otMultiplier) || 1.5, otMode: p.otMode === "flatRate" ? "flatRate" : "multiplier", otFlatRate: parseFloat(p.otFlatRate) || 0, otTiers: (p.otTiers || []).map(tr => ({ untilHour: parseFloat(tr.untilHour) || 0, mult: parseFloat(tr.mult) || 0 })).filter(tr => tr.untilHour > 0 && tr.mult > 0) }));
      const cleanInfo = { ...profileInfo, invoicePrefix: derivePrefix({ invoicePrefix: profileInfo.invoicePrefix, nickname: profileInfo.nickname, firstName: profileInfo.firstName, name: employee.name, id: employee.id }), taxId: (profileInfo.taxId || "").replace(/[^0-9A-Za-z-]/g, "") };
      if (cleanInfo.invoicePrefix !== profileInfo.invoicePrefix) setProfileInfo(p => ({ ...p, invoicePrefix: cleanInfo.invoicePrefix }));
      const consent = { ...docConsent };
      if (!idCard) delete consent.idCard; if (!signature) delete consent.signature; if (!promptPayQR) delete consent.promptPayQR;
      const res = await putProfile(employee.id, { photo: profilePhoto, ...cleanInfo, idCard, promptPayQR, signature, consent, positions: cleanPositions });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      setProfileSaveStatus(res.queued ? "queued" : "saved");
      setTimeout(() => setProfileSaveStatus(null), res.queued ? 5000 : 3000);
    } catch {
      setProfileSaveStatus("error");
      setTimeout(() => setProfileSaveStatus(null), 3500);
    }
  };

  const handleProfileUpload = (e) => {
    const f = e.target.files[0]; if (!f) return;
    compressImage(f, { maxDim: 800, quality: 0.75 }).then(d => d && setProfilePhoto(d));
  };

  const handleDocUpload = (setter, opts, consentKey) => (e) => {
    const f = e.target.files[0]; if (!f) return;
    compressImage(f, opts).then(d => { if (!d) return; setter(d); if (consentKey) setDocConsent(c => ({ ...c, [consentKey]: Date.now() })); });
  };
  const consentLine = (key) => docConsent[key] ? <p style={{ fontSize: 10, color: "var(--text-muted,#7B8FA3)", margin: "4px 0 0" }}>{t("profileConsent").replace("{date}", new Date(docConsent[key]).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }))}</p> : null;

  const selectJob = (job, forceReturn) => {
    setSelectedJob(job);
    const { allPicked } = getJobCheckoutState(job);
    setPhase(forceReturn ? "return" : (allPicked ? "return" : "pick"));
    setItemResults({});
    setBarcodeResults({});
    setSessionEvents({});
    setCaptureAe(null);
    setPendingAe(null);
    setDetailsAe(null);
    setScanAe(null);
    capture.reset();
  };

  // Commit ONE item's photo/none lane. dataUrl & loc null when vMode is "none".
  // `details` = { qty, condition, note } for returns (P1-1); ignored on picks.
  const commitItem = (ae, dataUrl, loc, details) => {
    const now = Date.now();
    const eq = equipment.find(e => e.id === ae.eqId);
    // Gear-request pickups carry requestId instead of jobId
    const evtRef = selectedJob.__reqId ? { jobId: null, requestId: selectedJob.__reqId, dueDate: jobLastDate(selectedJob) || null } : { jobId: selectedJob.id, dueDate: effReturnDate(selectedJob) || null };
    if (phase === "pick") {
      const id = "co" + now + ae.eqId;
      setCheckouts(p => [...p, { id, ...evtRef, jobName: selectedJob.name, eqId: ae.eqId, qty: ae.qty, employeeId: employee.id, employeeName: employee.name, type: "pick", ts: now, photo: dataUrl || null, location: loc || null }]);
      setSessionEvents(s => ({ ...s, [ae.eqId]: [...(s[ae.eqId] || []), id] }));
      setItemResults(r => ({ ...r, [ae.eqId]: "ok" }));
      return;
    }
    // return — count based (P1-1) + geo gate against the latest open pick (P1-2/P1-5)
    const outstanding = outstandingQty(getJobCheckoutState(selectedJob), ae.eqId);
    const condition = details?.condition || "ok";
    const qty = Math.max(condition === "missing" ? 0 : 1, Math.min(outstanding, details?.qty ?? outstanding));
    const note = (details?.note || "").trim();
    const pickupCo = latestOpenPick(selectedJob, checkouts, ae.eqId);
    const gate = geoGate({ returnLoc: loc, pickupLoc: pickupCo?.location, homeBase: verificationConfig?.homeBase, thresholdM: geoThresholdM, haversine: haversineMeters });
    // Require geo check only when photo or barcode mode (both have GPS); "none" mode skips it
    const needsApproval = (vMode !== "none") && !gate.ok;
    const base = { ...evtRef, jobName: selectedJob.name, eqId: ae.eqId, qty, employeeId: employee.id, employeeName: employee.name, ts: now, photo: dataUrl || null, location: loc || null, condition, ...(note ? { note } : {}) };
    if (!needsApproval) {
      setCheckouts(p => [...p, { id: "co" + now + ae.eqId, ...base, type: "return" }]);
      withdrawPendingGeo(ae.eqId); // a retry at the shop supersedes the earlier remote attempt
      setItemResults(r => ({ ...r, [ae.eqId]: "ok" }));
    } else {
      setAdminRequests(p => [...(p || []), { id: "ar" + now + ae.eqId, type: "geo-return", status: "pending", submittedAt: new Date().toISOString(), employeeId: employee.id, employeeName: employee.name, jobId: selectedJob.__reqId ? null : selectedJob.id, requestId: selectedJob.__reqId || null, jobName: selectedJob.name, eqId: ae.eqId, eqName: eq?.name || ae.eqId, name: eq?.name || ae.eqId, qty, condition, ...(note ? { note } : {}), photo: dataUrl || null, returnLocation: loc || null, pickupLocation: pickupCo?.location || null, distance: gate.distance, homeDistance: gate.homeDistance, threshold: gate.threshold, tolerance: gate.tolerance, reason: gate.reason }]);
      setItemResults(r => ({ ...r, [ae.eqId]: "pending" }));
    }
  };

  // Commit ONE item's barcode lane (barcode_pick or barcode_return event).
  const commitBarcode = (ae, loc, details) => {
    const now = Date.now();
    const evType = phase === "pick" ? "barcode_pick" : "barcode_return";
    const evtRef = selectedJob.__reqId ? { jobId: null, requestId: selectedJob.__reqId, dueDate: jobLastDate(selectedJob) || null } : { jobId: selectedJob.id, dueDate: effReturnDate(selectedJob) || null };
    const id = "bc" + now + ae.eqId;
    let qty = ae.qty, extra = {};
    if (phase !== "pick") {
      const outstanding = outstandingQty(getJobCheckoutState(selectedJob), ae.eqId);
      const condition = details?.condition || "ok";
      qty = Math.max(condition === "missing" ? 0 : 1, Math.min(outstanding, details?.qty ?? outstanding));
      const note = (details?.note || "").trim();
      extra = { condition, ...(note ? { note } : {}) };
    }
    setCheckouts(p => [...p, { id, ...evtRef, jobName: selectedJob.name, eqId: ae.eqId, qty, employeeId: employee.id, employeeName: employee.name, type: evType, ts: now, location: loc || null, ...extra }]);
    if (phase === "pick") setSessionEvents(s => ({ ...s, [ae.eqId]: [...(s[ae.eqId] || []), id] }));
    setBarcodeResults(r => ({ ...r, [ae.eqId]: "ok" }));
  };

  // Undo a pick made THIS session (P1-4). The autosave has already persisted the
  // event and the server keeps KV-only ids, so the event is overwritten in place
  // with a qty-0 "void" tombstone that every reader ignores.
  const undoPick = (ae) => {
    const ids = sessionEvents[ae.eqId] || [];
    if (ids.length === 0) return;
    setCheckouts(p => p.map(c => ids.includes(c.id) ? voidEvent(c, employee.id) : c));
    setSessionEvents(s => { const n = { ...s }; delete n[ae.eqId]; return n; });
    setItemResults(r => { const n = { ...r }; delete n[ae.eqId]; return n; });
    setBarcodeResults(r => { const n = { ...r }; delete n[ae.eqId]; return n; });
  };

  // My pending geo-return requests for an item of the selected job (P1-5)
  const myPendingGeo = (job, eqId) => (adminRequests || []).filter(r => r.type === "geo-return" && r.status === "pending" && r.employeeId === employee.id && (job.__reqId ? r.requestId === job.__reqId : r.jobId === job.id) && r.eqId === eqId);
  const withdrawPendingGeo = (eqId) => {
    const ids = myPendingGeo(selectedJob, eqId).map(r => r.id);
    if (ids.length) setAdminRequests(p => (p || []).map(r => ids.includes(r.id) ? { ...r, status: "withdrawn", resolvedAt: new Date().toISOString() } : r));
  };
  const fmtDist = (m) => m == null ? "?" : m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
  const geoReasonText = (g) => {
    if (!g) return "";
    const m = g.threshold || geoThresholdM;
    if (g.reason === "no-return-gps") return t("geoNoGps").replace("{m}", m);
    if (g.reason === "no-pickup-gps") return t("geoNoPickupGps");
    return t("geoTooFar").replace("{dist}", fmtDist(g.distance ?? g.homeDistance)).replace("{m}", m);
  };

  // What happens when an item row is tapped: depends on mode + role
  const onTapItem = (ae, lane) => {
    // Offline: KV is unreachable and the reconnect reloads from cloud, discarding
    // anything entered now — block capture instead of silently losing the work.
    if (offlineMode) { setCoSaveState({ error: t("coOfflineNoCapture") }); return; }
    if (lane === "barcode") { setScanAe(ae); return; }
    const outstanding = phase === "return" ? outstandingQty(getJobCheckoutState(selectedJob), ae.eqId) : 0;
    const freshDetails = { qty: outstanding, condition: "ok", note: "" };
    // photo or none lane
    if (vMode === "none") {
      if (phase === "return") { setReturnDetails(freshDetails); setDetailsAe({ ae, loc: null, lane: "photo" }); }
      else commitItem(ae, null, null);
      return;
    }
    // Open the native camera SYNCHRONOUSLY inside the tap (P2-14); the preview
    // screen appears once the file is picked, or on an error.
    capture.reset();
    setReturnDetails(freshDetails);
    setPendingAe(ae);
    capture.open();
  };
  useEffect(() => {
    if (pendingAe && (capture.busy || capture.photo || capture.err)) { setCaptureAe(pendingAe); setPendingAe(null); }
  }, [pendingAe, capture.busy, capture.photo, capture.err]);

  // Force an immediate save of everything and report success/failure. Returns true on success.
  const doSaveCheckout = async () => {
    if (!saveNow) { setCoSaveState({ error: t("coSaveUnavailable") }); return false; }
    setCoSaveState("saving");
    const res = await saveNow();
    if (res && res.ok) { setCoSaveState("saved"); setTimeout(() => setCoSaveState(s => s === "saved" ? null : s), 3000); return true; }
    setCoSaveState({ error: (res && res.error) || t("coSaveFailedCheck") });
    return false;
  };

  // ── Checkout / return flow (per-item, barcode-style) ───────────────────────
  if (phase !== "select" && selectedJob) {
    const isReturn = phase === "return";
    const jobState = getJobCheckoutState(selectedJob);
    const { pickedIds, returnedIds } = jobState;
    // Pick: all assigned items that still exist. Return: items with units OUT (count
    // based, any date) plus rows returned this session, so the ✓ stays visible.
    const items = (selectedJob.assignedEquipment || []).filter(ae =>
      equipment.some(e => e.id === ae.eqId) && (isReturn ? (outstandingQty(jobState, ae.eqId) > 0 || !!itemResults[ae.eqId] || !!barcodeResults[ae.eqId]) : true)
    );
    const pendingReturn = (ae) => myPendingGeo(selectedJob, ae.eqId).length > 0;
    const myLanes = getMyLanes(selectedJob);
    const photoLaneDone = (ae) => laneDone(jobState, ae.eqId, "photo", isReturn) || itemResults[ae.eqId] === "ok";
    const barcodeLaneDone = (ae) => laneDone(jobState, ae.eqId, "barcode", isReturn) || !!barcodeResults[ae.eqId];
    // Done = every lane I am responsible for is complete. A pending geo-return is NOT done (P1-5).
    const itemDone = (ae) => {
      if (vMode === "both") return (!myLanes.barcode || barcodeLaneDone(ae)) && (!myLanes.photo || photoLaneDone(ae));
      if (vMode === "barcode") return barcodeLaneDone(ae);
      return photoLaneDone(ae);
    };
    const pendingItems = isReturn ? items.filter(ae => !itemDone(ae) && pendingReturn(ae)) : [];
    const allDone = items.length > 0 && items.every(itemDone);
    const allSettled = !allDone && items.length > 0 && items.every(ae => itemDone(ae) || pendingReturn(ae));
    const outstandingOf = (ae) => outstandingQty(jobState, ae.eqId);

    // Per-item photo preview screen (P1-4): shown once the native picker returned a file
    if (captureAe) {
      const eq = equipment.find(e => e.id === captureAe.eqId);
      const out = outstandingOf(captureAe);
      return (
        <div style={{ ...S.main, maxWidth: 500 }}>
          <button style={{ ...S.btn("ghost"), marginBottom: 16 }} onClick={() => { setCaptureAe(null); capture.reset(); }}><Icon d={icons.arrow_left} size={15} /> {t("back")}</button>
          <div style={{ ...S.card, marginBottom: 16, display: "flex", alignItems: "center", gap: 14 }}>
            {eq?.photo && <img src={eq.photo} alt="" style={{ width: 56, height: 48, objectFit: "cover", borderRadius: 6 }} />}
            <div>
              <p style={{ margin: 0, fontWeight: 700, fontSize: 15 }}>{eq?.name}</p>
              <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--text-muted,#5F7A91)" }}>{isReturn ? t("returnPhotoTitle") : t("pickPhotoTitle")}{isReturn && out > 0 ? ` · ${t("stillOutN").replace("{n}", out)}` : ""}</p>
            </div>
          </div>
          <GeoPhoto
            capture={capture}
            label={`${isReturn ? t("returnPhotoTitle") : t("pickPhotoTitle")} · ${eq?.name || ""}`}
            useLabel={isReturn ? t("confirmReturn") : t("photoUse")}
            onUse={(dataUrl, loc) => { commitItem(captureAe, dataUrl, loc, isReturn ? returnDetails : null); setCaptureAe(null); capture.reset(); }}
          >
            {isReturn && <ReturnDetailsFields value={returnDetails} onChange={setReturnDetails} outstanding={out} />}
          </GeoPhoto>
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
              <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--text-muted,#5F7A91)" }}>{isReturn ? t("returnScanTitle") : t("pickScanTitle")} · {eq?.category}</p>
            </div>
          </div>
          <QRScanner
            key={scanAe.eqId}
            label={t("coScanLabelOn").replace("{name}", eq?.name || "")}
            onScan={(scannedId, loc) => {
              if (scannedId === scanAe.eqId) {
                if (isReturn) { setReturnDetails({ qty: outstandingOf(scanAe), condition: "ok", note: "" }); setDetailsAe({ ae: scanAe, loc, lane: "barcode" }); }
                else commitBarcode(scanAe, loc);
                setScanAe(null);
              }
              // If wrong item scanned, scanner stays open (user can try again)
            }}
            onClose={() => setScanAe(null)}
          />
        </div>
      );
    }

    const modeLabel = vMode === "both" ? ` · ${t("coModePhotoScan")}` : vMode === "photo" ? ` · ${t("coModePhoto")}` : vMode === "barcode" ? ` · ${t("coModeScan")}` : "";
    return (
      <div style={{ ...S.main, maxWidth: 600 }}>
        {capture.input}
        <button style={{ ...S.btn("ghost"), marginBottom: 16 }} onClick={() => { setSelectedJob(null); setPhase("select"); setItemResults({}); setSessionEvents({}); }}><Icon d={icons.arrow_left} size={15} /> {t("back")}</button>
        <StepBar currentStep={isReturn ? 2 : 0} />
        <div style={{ ...S.card, marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{selectedJob.name}</h2>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-muted,#5F7A91)" }}>{selectedJob.production} · {locationLabel(t, selectedJob.location)}{selectedJob.locationCity ? ` · ${selectedJob.locationCity}` : ""} · {shootTimeLabel(t, selectedJob.shootTime)}</p>
          {(() => {
            const dates = selectedJob.dates || [];
            const td = today();
            const multi = dates.length > 1;
            return (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "var(--accent,#2563EB)", background: "rgba(var(--accent-rgb,37,99,235),0.1)", border: "1px solid rgba(var(--accent-rgb,37,99,235),0.25)", borderRadius: 8, padding: "4px 10px" }}>
                  <Icon d={icons.calendar} size={13} /> {t("coTodayLabel")} · {formatDate(td)}
                </span>
                {dates.length > 0 && (
                  <span style={{ fontSize: 11, color: "var(--text-muted,#4E6B84)" }}>
                    {multi ? `${t("coShootDays").replace("{n}", dates.length)} ` : `${t("coShootDate")} `}{dates.map(d => formatDate(d)).join(" · ")}
                  </span>
                )}
                <span style={{ display: "inline-flex", alignItems: "center", fontSize: 10, fontWeight: 700, color: (selectedJob.checkoutMode || "span") === "daily" ? "#2563EB" : "var(--text-muted,#4E6B84)", background: (selectedJob.checkoutMode || "span") === "daily" ? "rgba(37,99,235,0.1)" : "rgba(22,50,74,0.04)", border: `1px solid ${(selectedJob.checkoutMode || "span") === "daily" ? "rgba(37,99,235,0.3)" : "var(--border-color,#D8E1EC)"}`, borderRadius: 6, padding: "3px 8px", letterSpacing: "0.04em" }}>
                  {(selectedJob.checkoutMode || "span") === "daily" ? t("jobDailyReturn") : t("coReturnLastDay")}
                </span>
              </div>
            );
          })()}
        </div>
        {(isReturn && (selectedJob.dates || []).length > 1 && (selectedJob.checkoutMode || "span") === "span") && (
          <div style={{ ...S.card, background: "rgba(var(--accent-rgb,37,99,235),0.05)", border: "1px solid rgba(var(--accent-rgb,37,99,235),0.18)", marginBottom: 16 }}>
            <p style={{ margin: 0, fontSize: 12, color: "var(--accent,#2563EB)", display: "flex", gap: 8, alignItems: "center" }}>
              <Icon d={icons.calendar} size={14} /> {t("coMultiDayNote")}
            </p>
          </div>
        )}
        <p style={S.sectionTitle}>{isReturn ? t("coTapToReturn") : t("coTapToCheckOut")}{modeLabel}</p>
        {items.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--text-muted,#5F7A91)" }}>{isReturn ? t("coNothingToReturn") : t("coNothingToPick")}</p>
        ) : (
          <div style={S.col}>
            {items.map(ae => {
              const eq = equipment.find(e => e.id === ae.eqId);
              const done = itemDone(ae);
              const pendingReqs = isReturn ? myPendingGeo(selectedJob, ae.eqId) : [];
              const pend = isReturn && !done && (itemResults[ae.eqId] === "pending" || pendingReqs.length > 0);
              const geo = pendingReqs.length ? pendingReqs[pendingReqs.length - 1] : null;
              const barcodeDone = barcodeLaneDone(ae);
              const photoDone = photoLaneDone(ae);
              const counts = jobState.items[ae.eqId];
              const out = outstandingOf(ae);
              const canUndo = !isReturn && (sessionEvents[ae.eqId] || []).length > 0;

              return (
                <div key={ae.eqId} data-testid={`item-${ae.eqId}`} style={{ ...S.card, background: "var(--surface2,#EAF0F7)", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", opacity: done ? 0.65 : 1 }}>
                  {eq.photo && <img src={eq.photo} alt="" style={{ width: 48, height: 40, objectFit: "cover", borderRadius: 6, flexShrink: 0 }} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>{eq.name}</p>
                    <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--text-muted,#5F7A91)" }}>
                      {eq.category} · {isReturn ? t("outOfN").replace("{out}", out).replace("{total}", ae.qty) : `${t("qty")}: ${ae.qty}`}
                      {counts?.missing && out > 0 && <span style={{ ...S.badge("red"), marginLeft: 6 }}>{t("missingN").replace("{n}", out)}</span>}
                    </p>
                    {!isReturn && !done && openReportFor(ae.eqId) && (
                      <p data-testid={`damage-banner-${ae.eqId}`} style={{ margin: "4px 0 0", fontSize: 11, fontWeight: 700, color: "#C53030", lineHeight: 1.4 }}>⚠ {t("pickDamageBanner")}{openReportFor(ae.eqId).description ? ` (${openReportFor(ae.eqId).description})` : ""}</p>
                    )}
                    {pend && (
                      <div style={{ margin: "6px 0 0" }}>
                        <p style={{ margin: 0, fontSize: 11, color: "#C53030", fontWeight: 600 }}>⚠ {t("geoSentForApproval")}</p>
                        {geo && <p style={{ margin: "3px 0 0", fontSize: 11, color: "var(--text-muted,#5F7A91)", lineHeight: 1.5 }}>{geoReasonText(geo)}</p>}
                        {myLanes.photo && vMode !== "none" && (
                          <button style={{ ...S.btn("ghost", "lg"), marginTop: 6 }} onClick={() => onTapItem(ae, "photo")} title={t("geoRetryHint")}>
                            <Icon d={icons.camera} size={13} /> {t("geoRetryAtShop")}
                          </button>
                        )}
                      </div>
                    )}
                    {/* "Both" mode: show mini status for each lane */}
                    {vMode === "both" && (
                      <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                        <span style={{ fontSize: 11, color: barcodeDone ? "#2F855A" : "var(--text-muted,#7B8FA3)" }}>{barcodeDone ? `✓ ${t("coScanned")}` : `○ ${t("coScanPending")}`}</span>
                        <span style={{ fontSize: 11, color: "var(--border-color,#D8E1EC)" }}>·</span>
                        <span style={{ fontSize: 11, color: photoDone ? "#2F855A" : "var(--text-muted,#7B8FA3)" }}>{photoDone ? `✓ ${t("coPhotoDone")}` : `○ ${t("coPhotoPending")}`}</span>
                      </div>
                    )}
                  </div>
                  {done ? (
                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
                      <span style={{ ...S.badge("green", "md"), flexShrink: 0 }}>✓ {isReturn ? t("coReturnedBadge") : t("coOutBadge")}</span>
                      {canUndo && (
                        <button style={S.btn("ghost", "lg")} onClick={() => undoPick(ae)} title={t("undoPickHint")}><Icon d={icons.undo} size={14} /> {t("undoPick")}</button>
                      )}
                    </div>
                  ) : pend ? (
                    <span style={{ ...S.badge("amber", "md"), flexShrink: 0 }}>{t("geoPending")}</span>
                  ) : (
                    <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                      {myLanes.barcode && !barcodeDone && (
                        <button style={{ ...S.btn("ghost", "lg"), minWidth: 44, padding: "10px 12px", border: "1px solid rgba(var(--accent-rgb,37,99,235),0.4)" }} onClick={() => onTapItem(ae, "barcode")} aria-label={t("adminScanQr")}>
                          <Icon d={icons.qr} size={18} />
                        </button>
                      )}
                      {myLanes.photo && !photoDone && (
                        <button style={{ ...S.btn("primary", "lg"), minWidth: 44 }} onClick={() => onTapItem(ae, "photo")}>
                          <Icon d={vMode === "none" ? icons.check : icons.camera} size={17} />
                          {vMode === "none" ? (isReturn ? t("coBtnReturn") : t("coBtnOut")) : t("coBtnPhoto")}
                        </button>
                      )}
                      {myLanes.barcode && barcodeDone && !myLanes.photo && (
                        <span style={{ ...S.badge("green", "md"), flexShrink: 0 }}>✓ {t("coScanned")}</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {allDone && (
          <div style={{ ...S.card, background: "rgba(47,133,90,0.07)", border: "1px solid rgba(47,133,90,0.25)", marginTop: 16, textAlign: "center" }}>
            <div style={{ marginBottom: 8, display: "flex", justifyContent: "center" }}><Icon d={isReturn ? icons.flag : icons.check} size={36} color="#2F855A" strokeW={2.2} /></div>
            <p style={{ margin: "0 0 12px", fontWeight: 700, color: "#2F855A" }}>{isReturn ? t("coAllReturned") : t("coAllPicked")}</p>
            <button style={{ ...S.btn("primary", "lg"), width: "100%", opacity: coSaveState === "saving" ? 0.7 : 1 }} disabled={coSaveState === "saving"} onClick={async () => { const ok = await doSaveCheckout(); if (ok) { setSelectedJob(null); setPhase("select"); setItemResults({}); setSessionEvents({}); } }}>{coSaveState === "saving" ? t("coSaving") : `${t("backToJobs")}`}</button>
          </div>
        )}
        {allSettled && pendingItems.length > 0 && (
          <div style={{ ...S.card, background: "rgba(183,121,31,0.07)", border: "1px solid rgba(183,121,31,0.3)", marginTop: 16, textAlign: "center" }} data-testid="pending-card">
            <div style={{ marginBottom: 8, display: "flex", justifyContent: "center" }}><Icon d={icons.hourglass} size={30} color="#B7791F" /></div>
            <p style={{ margin: "0 0 4px", fontWeight: 700, color: "#B7791F" }}>{t("allReturnedWaiting")}</p>
            <p style={{ margin: "0 0 12px", fontSize: 12, color: "var(--text-muted,#5F7A91)" }}>{t("pendingCountLine").replace("{n}", pendingItems.length)}</p>
            <button style={{ ...S.btn("primary", "lg"), width: "100%", opacity: coSaveState === "saving" ? 0.7 : 1 }} disabled={coSaveState === "saving"} onClick={async () => { const ok = await doSaveCheckout(); if (ok) { setSelectedJob(null); setPhase("select"); setItemResults({}); setSessionEvents({}); } }}>{coSaveState === "saving" ? t("coSaving") : `${t("backToJobs")}`}</button>
          </div>
        )}
        {/* Explicit save — make sure everything reached the cloud */}
        {items.length > 0 && (
          <div data-sticky-primary="checkout-save" style={{ position: "sticky", bottom: "calc(12px + env(safe-area-inset-bottom, 0px))", zIndex: 5, marginTop: 16 }}>
            <button
              style={{ ...S.btn(coSaveState === "saved" ? "success" : (coSaveState && coSaveState.error) ? "danger" : "primary", "lg"), width: "100%", padding: "14px", fontSize: 15, fontWeight: 700, boxShadow: "0 4px 24px rgba(22,50,74,0.17)", opacity: coSaveState === "saving" ? 0.75 : 1 }}
              disabled={coSaveState === "saving"}
              onClick={doSaveCheckout}
            >
              {coSaveState === "saving" ? t("coSaving")
                : coSaveState === "saved" ? `✓ ${t("coSavedCloud")}`
                : (coSaveState && coSaveState.error) ? t("coSaveFailedRetry")
                : <><Icon d={icons.save} size={17} /> {t("coSave")}</>}
            </button>
            {coSaveState && coSaveState.error && (
              <p style={{ fontSize: 12, color: "#C53030", textAlign: "center", margin: "8px 0 0", lineHeight: 1.5 }}>⚠ {coSaveState.error}</p>
            )}
          </div>
        )}
        {/* Return details for the none mode and the barcode lane (photo lane collects them on the preview) */}
        {detailsAe && (() => {
          const eq = equipment.find(e => e.id === detailsAe.ae.eqId);
          const out = outstandingOf(detailsAe.ae);
          return (
            <Modal title={`${t("returnDetailsTitle")} · ${eq?.name || ""}`} onClose={() => setDetailsAe(null)}>
              <ReturnDetailsFields value={returnDetails} onChange={setReturnDetails} outstanding={out} compact />
              <button style={{ ...S.btn("primary"), width: "100%", justifyContent: "center", marginTop: 16, padding: "12px" }} onClick={() => {
                if (detailsAe.lane === "barcode") commitBarcode(detailsAe.ae, detailsAe.loc, returnDetails);
                else commitItem(detailsAe.ae, null, detailsAe.loc, returnDetails);
                setDetailsAe(null);
              }}><Icon d={icons.check} size={15} /> {t("confirmReturn")}</button>
            </Modal>
          );
        })()}
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
            ? <img src={profilePhoto} alt="avatar" style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover", border: "2px solid var(--accent,#2563EB)" }} />
            : <div style={{ width: 32, height: 32, borderRadius: "50%", background: "rgba(var(--accent-rgb,37,99,235),0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Icon d={icons.user} size={16} color="var(--accent,#2563EB)" />
              </div>
          }
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text,#16324A)", lineHeight: 1.2 }}>{employee.name}</div>
            <div style={{ fontSize: 11, color: "var(--text-muted,#5F7A91)", letterSpacing: "0.02em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 150 }}>{crewRoleLabel}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {chatEnabled && (
            <button
              onClick={onOpenChat}
              style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", cursor: "pointer", padding: "6px", borderRadius: 6 }}
              title="Team Chat"
            >
              <Icon d={icons.chat} size={18} color={chatUnread > 0 ? "var(--accent,#2563EB)" : "var(--text-muted,#4E6B84)"} />
              {chatUnread > 0 && (
                <div style={{ position: "absolute", top: 3, right: 3, width: 8, height: 8, borderRadius: "50%", background: "#C53030", border: "1.5px solid var(--bg,#F4F7FB)" }} />
              )}
            </button>
          )}
          <LangPill setLang={setLang} />
          <button style={{ ...S.btn("ghost", "md"), padding: "7px 10px", fontSize: 12 }} onClick={onLogout}>
            <Icon d={icons.logout} size={14} /> {t("logout")}
          </button>
        </div>
      </header>

      {offlineMode && (
        <div style={{ background: "rgba(var(--accent-rgb,37,99,235),0.12)", borderBottom: "1px solid rgba(var(--accent-rgb,37,99,235),0.25)", padding: "8px 16px", display: "flex", alignItems: "center", gap: 8 }}>
          <Icon d={icons.alert} size={15} color="var(--accent,#2563EB)" />
          <p style={{ margin: 0, fontSize: 12, color: "var(--accent,#2563EB)", lineHeight: 1.4 }}>
            <strong>{t("offlineTitle")}</strong> {t("offlineCrewBody")} {(offlinePendingCount || 0) > 0 ? t("offlinePendingN").replace("{n}", offlinePendingCount) : t("offlineClean")}
          </p>
        </div>
      )}

      {showReportModal && (
        <ReportModal employee={employee} equipment={equipment} jobs={jobs} checkouts={checkouts} onSubmit={(report) => {
          setReports(p => [...p, report]);
          if (lineGroupId && !lineNotifyMuted) {
            const msg = `🚨 [Damage Report] ${employee.name}\n📷 ${report.eqName || "—"}\n📝 ${report.description}\n🔗 https://pickshootreturn.pages.dev`;
            api.notify({ userIds: [lineGroupId], message: msg });
          }
          setShowReportModal(false);
        }} onClose={() => setShowReportModal(false)} />
      )}

      {/* Production House add / edit — writes straight to productionCompanies, no admin approval */}
      {showAdminReqModal === "production-house" && (() => {
        // Shared list, no owner lock (2026-09-22): any crew member may fix any company's
        // billing details, so a wrong address on their own invoice needs no admin.
        const me = { id: employee.id, name: employee.name, role: "employee" };
        const editing = adminReqForm.id ? (productionCompanies || []).find(c => c.id === adminReqForm.id) : null;
        // Whose entry this is: an edit to a teammate's company still goes through,
        // it is only announced so it is a conscious one.
        const addedByOther = !!editing && (editing.addedBy ?? null) !== employee.id;
        const field = (key, label, ph, extra = {}) => (
          <div>
            <label style={S.label}>{label}</label>
            <input style={S.input} value={adminReqForm[key] || ""} onChange={e => setAdminReqForm(p => ({ ...p, [key]: e.target.value }))} placeholder={ph} {...extra} />
          </div>
        );
        return (
        <Modal title={adminReqForm.id ? t("prodHouseEditTitle") : t("prodHouseAddTitle")} dirty={editing ? ["name", "address", "taxId", "branch"].some(k => (adminReqForm[k] || "") !== (editing[k] || "")) : !!(adminReqForm.name || adminReqForm.address)} onClose={() => setShowAdminReqModal(null)}>
          <div style={S.col}>
            {addedByOther && (
              <div style={{ ...S.card, padding: "10px 14px", background: "rgba(var(--accent-rgb,37,99,235),0.05)", border: "1px solid rgba(var(--accent-rgb,37,99,235),0.2)" }}>
                <p style={{ margin: 0, fontSize: 12, color: "var(--text,#16324A)", lineHeight: 1.5, display: "flex", gap: 6, alignItems: "flex-start" }}><Icon d={icons.alert} size={14} style={{ flexShrink: 0, marginTop: 2 }} /> <span>{t("prodHouseSharedEdit").replace("{name}", editing.addedByName || (editing.addedBy ? t("teammate") : companyName || t("theHouse")))}</span></p>
              </div>
            )}
            {field("name", t("prodHouseName"), "e.g. Thai Film Co.", { autoFocus: !adminReqForm.id })}
            <div>
              <label style={S.label}>{t("billingAddress")}</label>
              <textarea style={{ ...S.input, height: 80, resize: "vertical" }} value={adminReqForm.address || ""} onChange={e => setAdminReqForm(p => ({ ...p, address: e.target.value }))} placeholder={t("billingAddressPh")} autoFocus={!!adminReqForm.id} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {field("taxId", t("prodHouseTaxId"), "0105551234567", { inputMode: "numeric", maxLength: 17 })}
              {field("branch", t("prodHouseBranch"), t("prodHouseBranchPh"))}
            </div>
            {adminReqMsg && <p style={{ fontSize: 12, color: adminReqMsg.ok ? "#2F855A" : "#C53030", margin: 0 }}>{adminReqMsg.text}</p>}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button style={S.btn("ghost")} onClick={() => setShowAdminReqModal(null)}>{t("cancel")}</button>
              <button style={S.btn("primary")} onClick={() => {
                const name = (adminReqForm.name || "").trim();
                const address = (adminReqForm.address || "").trim();
                const taxId = (adminReqForm.taxId || "").trim();
                const branch = (adminReqForm.branch || "").trim();
                if (!name) { setAdminReqMsg({ ok: false, text: t("prodHouseNameRequired") }); return; }
                setProductionCompanies(prev => {
                  const list = prev || [];
                  // Any company is fully editable; one added by someone else keeps its
                  // attribution and gains a last-edited stamp (the server enforces both).
                  if (adminReqForm.id) return list.map(c => c.id === adminReqForm.id ? stampCompanyEdit({ ...c, name, address, taxId, branch }, me) : c);
                  // Same name already registered (e.g. auto-added from a booking with no address) → fill it in, never duplicate
                  const dup = list.find(c => (c.name || "").trim().toLowerCase() === name.toLowerCase());
                  if (dup) return list.map(c => c.id === dup.id ? stampCompanyEdit({ ...c, address: address || c.address || "", taxId: taxId || c.taxId || "", branch: branch || c.branch || "" }, me) : c);
                  return [...list, { id: "co" + Date.now(), name, address, taxId, branch, addedBy: employee.id, addedByName: employee.name }];
                });
                setShowAdminReqModal(null);
              }}>{t("save")}</button>
            </div>
          </div>
        </Modal>
        );
      })()}

      <div style={{ ...S.main, paddingBottom: "calc(62px + 28px + env(safe-area-inset-bottom, 0px))" }}>
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
              <p style={{ ...S.pageSubtitle, marginBottom: 0, fontSize: 12 }}>{formatLongDay(new Date(), { lang })}</p>
            </div>

            {/* Gear currently out — jobs + my approved gear requests */}
            {(() => {
              const myReqJobs = myRequests.filter(r => r.status === "approved").map(reqAsJob);
              const myEvents = (j) => (checkouts || []).some(c => c && c.employeeId === employee.id && evtMatchesJob(c, j));
              const outJobs = [...jobs, ...myReqJobs].filter(j => getJobCheckoutState(j).outCount > 0 && (!isOtherJob(j) || myEvents(j)));
              if (outJobs.length === 0) return null;
              return (
                <div style={{ ...S.card, background: "rgba(var(--accent-rgb,37,99,235),0.06)", border: "1px solid rgba(var(--accent-rgb,37,99,235),0.2)" }} data-testid="gear-out-card">
                  <p style={{ ...S.sectionTitle, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}><Icon d={icons.film} size={13} /> {t("gearOutTitle")}</p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {outJobs.map(job => {
                      const jst = getJobCheckoutState(job);
                      const outCount = jst.outCount;
                      const missingUnits = Object.values(jst.items).reduce((n, it) => n + (it.missing ? it.out : 0), 0);
                      // Returning before the last shoot day of an ongoing span-mode job needs admin approval
                      const lastShoot = jobLastDate(job);
                      const isEarly = !job.__reqId && (job.checkoutMode || "span") === "span" && lastShoot && todayStr < lastShoot;
                      const canReturn = !isEarly || earlyReturnApproved(job);
                      const erPending = isEarly && !canReturn && earlyReqPending("early-return", job.id);
                      return (
                        <div key={job.id} style={{ ...S.card, background: "var(--surface2,#EAF0F7)", cursor: canReturn ? "pointer" : "default", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }} onClick={() => canReturn && selectJob(job, true)}>
                          <span style={{ ...S.badge("amber", "md"), flexShrink: 0 }}>{outCount} {t("outBadge")}</span>
                          {missingUnits > 0 && <span style={{ ...S.badge("red", "md"), flexShrink: 0 }}>{t("missingN").replace("{n}", missingUnits)}</span>}
                          <div style={{ flex: "1 1 160px", minWidth: 0 }}>
                            <p style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>{job.name}{job.__reqId ? <span style={{ ...S.badge("blue"), marginLeft: 6 }}>{t("requestBadge")}</span> : null}</p>
                            <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-muted,#4E6B84)" }}>{job.dates?.map(d => formatDate(d)).join(", ")}</p>
                            {(() => {
                              const due = job.__reqId ? jobLastDate(job) : effReturnDate(job);
                              if (!due) return null;
                              if (due < todayStr) return <p style={{ margin: "2px 0 0", fontSize: 11, fontWeight: 700, color: "#C53030" }}>{t("dashOverdueDays").replace("{n}", Math.max(1, Math.round((Date.parse(todayStr + "T00:00:00Z") - Date.parse(due + "T00:00:00Z")) / 86400000)))} · {t("crewDueLabel").replace("{date}", formatDate(due))}</p>;
                              if (due === todayStr) return <p style={{ margin: "2px 0 0", fontSize: 11, fontWeight: 700, color: "var(--accent,#2563EB)" }}>{t("dashDueToday")}</p>;
                              return <p style={{ margin: "2px 0 0", fontSize: 10, color: "var(--text-muted,#4E6B84)" }}>{t("crewDueLabel").replace("{date}", formatDate(due))}</p>;
                            })()}
                            {canReturn && isEarly && <p style={{ margin: "2px 0 0", fontSize: 11, color: "#2F855A" }}>{t("earlyReturnApprovedToday")}</p>}
                          </div>
                          {canReturn ? (
                            <Icon d={icons.chevron_right} size={16} color="var(--accent,#2563EB)" strokeW={2} />
                          ) : erPending ? (
                            <span style={{ ...S.badge("amber", "md"), flexShrink: 0 }}>{t("returnReqPending")}</span>
                          ) : (
                            /* full-width row under the title at phone width (flex-basis 160px above forces the wrap), so the job name is never squeezed to one word per line */
                            <button style={{ ...S.btn("ghost", "lg"), flex: "1 0 100%", justifyContent: "center" }} onClick={(e) => { e.stopPropagation(); submitEarlyRequest("early-return", job); }}>{t("requestEarlyReturn")}</button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* Returns waiting for admin approval (geo-gated) + recent outcomes (P1-5) */}
            {(() => {
              const cutoff = Date.now() - 3 * 86400000;
              const mine = (adminRequests || []).filter(r => r.type === "geo-return" && r.employeeId === employee.id && (r.status === "pending" || (r.resolvedAt && new Date(r.resolvedAt).getTime() > cutoff)))
                .sort((a, b) => (a.status === "pending" ? 0 : 1) - (b.status === "pending" ? 0 : 1) || new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0));
              if (mine.length === 0) return null;
              const fmtDist = (m) => m == null ? null : m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
              const statusOf = (r) => r.status === "pending" ? ["amber", t("geoPending")] : r.status === "approved" ? ["green", t("geoApproved")] : r.status === "withdrawn" ? ["gray", t("geoWithdrawn")] : ["red", t("geoRejected")];
              return (
                <div style={{ ...S.card, background: "rgba(183,121,31,0.06)", border: "1px solid rgba(183,121,31,0.25)" }} data-testid="geo-waiting-card">
                  <p style={{ ...S.sectionTitle, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}><Icon d={icons.hourglass} size={13} /> {t("geoWaitingTitle")}</p>
                  <p style={{ margin: "0 0 10px", fontSize: 11, color: "var(--text-muted,#5F7A91)", lineHeight: 1.5 }}>{t("geoWaitingHint")}</p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {mine.map(r => {
                      const [color, label] = statusOf(r);
                      const eqName = equipment.find(e => e.id === r.eqId)?.name || r.eqName || r.name || r.eqId;
                      const dist = fmtDist(r.distance ?? r.homeDistance);
                      return (
                        <div key={r.id} style={{ ...S.card, background: "var(--surface2,#EAF0F7)", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "10px 14px" }}>
                          <span style={{ ...S.badge(color), flexShrink: 0 }}>{label}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ margin: 0, fontWeight: 700, fontSize: 13 }}>{eqName}{r.qty > 1 ? ` ×${r.qty}` : ""} <span style={{ ...S.badge("blue"), marginLeft: 4 }}>{t("geoLabelReturn")}</span></p>
                            <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-muted,#4E6B84)" }}>
                              {r.jobName}{dist ? ` · ${t("geoDistanceFrom").replace("{dist}", dist)}` : ""} · {formatDateTime(r.resolvedAt || r.submittedAt)}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* Early pickup — jobs whose pickup day is tomorrow can be requested 1 day ahead */}
            {(() => {
              const tomorrow = addDaysStr(todayStr, 1);
              const upcoming = jobs.filter(j => j.status === "Confirmed" && (j.assignedEquipment || []).length > 0 && effPickupDate(j) === tomorrow && !earlyPickupApproved(j) && !isOtherJob(j));
              if (upcoming.length === 0) return null;
              return (
                <div style={{ ...S.card, background: "rgba(37,99,235,0.05)", border: "1px solid rgba(37,99,235,0.2)" }}>
                  <p style={{ ...S.sectionTitle, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}><Icon d={icons.clock} size={13} /> {t("pickupTomorrow")}</p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {upcoming.map(job => {
                      const pending = earlyReqPending("early-pickup", job.id);
                      return (
                        <div key={job.id} style={{ ...S.card, background: "var(--surface2,#EAF0F7)", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>{job.name}</p>
                            <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-muted,#4E6B84)" }}>{t("pickupOn").replace("{date}", formatDate(effPickupDate(job)))} · {tCount(t, "itemsN", (job.assignedEquipment || []).length)}</p>
                          </div>
                          {pending ? (
                            <span style={{ ...S.badge("amber", "md"), flexShrink: 0 }}>{t("waitingApproval")}</span>
                          ) : (
                            <button style={{ ...S.btn("primary", "lg"), flexShrink: 0 }} onClick={() => submitEarlyRequest("early-pickup", job)}>{t("requestEarlyPickup")}</button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* Stats — clickable, expand one at a time. Counts are MY jobs (roster or open). */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              {[
                { key: "today", label: t("tabToday"), value: splitJobsForEmployee(availableJobs, employee.id).mine.length, color: "var(--accent,#2563EB)" },
                { key: "confirmed", label: t("statusConfirmed"), value: splitJobsForEmployee(confirmedJobs, employee.id).mine.length, color: "#2F855A" },
                { key: "pencil", label: t("statusPencil"), value: splitJobsForEmployee(pencilJobs, employee.id).mine.length, color: "var(--accent,#2563EB)" },
              ].map(stat => (
                <div key={stat.key} onClick={() => setExpandedStat(expandedStat === stat.key ? null : stat.key)} style={{ ...S.card, textAlign: "center", padding: "12px 6px", cursor: "pointer", border: expandedStat === stat.key ? `1px solid ${stat.color}40` : undefined, transition: "border-color .15s" }}>
                  <p style={{ margin: 0, fontSize: 24, fontWeight: 800, color: stat.color, lineHeight: 1 }}>{stat.value}</p>
                  <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--text-muted,#5F7A91)", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>{stat.label}</p>
                  <p style={{ margin: "3px 0 0", fontSize: 10, lineHeight: 1, color: expandedStat === stat.key ? stat.color : "var(--text-muted,#8CA2B5)" }}><Icon d={expandedStat === stat.key ? icons.chevron_up : icons.chevron_down} size={12} strokeW={2.2} /></p>
                </div>
              ))}
            </div>

            {/* Expanded stat job list: my jobs first, other crews' jobs collapsed (P1-10) */}
            {expandedStat && (() => {
              const { mine, others } = splitJobsForEmployee(statJobMap[expandedStat] || [], employee.id);
              const othersOpen = !!showOthers[expandedStat];
              if (mine.length === 0 && others.length === 0) return <p style={{ fontSize: 13, color: "var(--text-muted,#7B8FA3)", textAlign: "center" }}>{t("crewNoJobs")}</p>;
              const list = othersOpen ? [...mine, ...others] : mine;
              const cards = list.map(job => {
                const { allPicked, allReturned } = getJobCheckoutState(job);
                const isToday = expandedStat === "today";
                const other = isOtherJob(job);
                const me = myEntry(job);
                return (
                  <div key={job.id} data-testid={other ? "other-job-card" : "my-job-card"} style={{ ...S.card, cursor: "pointer", opacity: other ? 0.75 : 1 }} onClick={() => isToday ? selectJob(job) : setEmpDetailJob(job)}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, justifyContent: "space-between" }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
                          {isToday ? (allReturned ? <span style={S.badge("green")}>{t("allReturned")}</span> : allPicked ? (() => {
                            const due = effReturnDate(job);
                            if (due && due < todayStr) return <span style={S.badge("red")}>{t("crewOverdue").replace("{n}", Math.max(1, Math.round((Date.parse(todayStr + "T00:00:00Z") - Date.parse(due + "T00:00:00Z")) / 86400000)))}</span>;
                            if (due && due === todayStr) return <span style={S.badge("amber")}>{t("crewReturnToday")}</span>;
                            return <span style={S.badge("amber")}>{t("onShoot")}</span>;
                          })() : <span style={S.badge("blue")}>{t("readyPick")}</span>) : <span style={S.badge(JOB_STATUS_BADGE[job.status] || "gray")}>{t("status" + job.status)}</span>}
                          <span style={S.badge("gray")}>{shootTimeLabel(t, job.shootTime)}</span>
                          {other && <span style={S.badge("gray")}>{t("crewOtherJobBadge")}</span>}
                          {me && me.role && <span style={S.badge("blue")}>{me.role}</span>}
                        </div>
                        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{job.name}</h3>
                        <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-muted,#5F7A91)" }}>{job.production} · {locationLabel(t, job.location)}{job.locationCity ? ` · ${job.locationCity}` : ""}</p>
                        <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-muted,#4E6B84)" }}>{job.dates?.map(d => formatDate(d)).join(", ")}</p>
                        {me && (me.pickupTime || me.callTime) && (
                          <p style={{ margin: "4px 0 0", fontSize: 12, fontWeight: 600, color: "var(--accent,#2563EB)" }} data-testid="my-times">
                            {me.pickupTime ? `${t("crewPickupAt")} ${fmtClock(me.pickupTime)}` : ""}{me.pickupTime && me.callTime ? " · " : ""}{me.callTime ? `${t("crewCallAt")} ${fmtClock(me.callTime)}` : ""}
                          </p>
                        )}
                        {other && <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--text-muted,#8CA2B5)" }}><Icon d={icons.user} size={11} style={{ verticalAlign: "-2px", marginRight: 3 }} />{crewNames(job, employees || []).join(", ")}</p>}
                      </div>
                      <Icon d={icons.chevron_right} size={16} color="var(--text-muted,#5F7A91)" strokeW={2} />
                    </div>
                  </div>
                );
              });
              return (
                <>
                  {mine.length === 0 && <p style={{ fontSize: 13, color: "var(--text-muted,#7B8FA3)", textAlign: "center", margin: 0 }}>{t("crewNoMyJobs")}</p>}
                  {cards}
                  {others.length > 0 && (
                    <button data-testid="toggle-other-jobs" style={{ ...S.btn("ghost"), width: "100%", justifyContent: "center", fontSize: 12 }} onClick={() => setShowOthers(p => ({ ...p, [expandedStat]: !othersOpen }))}>
                      {othersOpen ? t("crewHideOtherJobs") : t("crewShowOtherJobs").replace("{n}", others.length)}
                    </button>
                  )}
                </>
              );
            })()}

            {/* Job detail modal for Confirmed/Pencil jobs */}
            {empDetailJob && <JobDetailModal job={empDetailJob} equipment={equipment} onClose={() => setEmpDetailJob(null)} />}

            {/* Gear Checkout Requests */}
            <div style={S.card}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <p style={{ ...S.sectionTitle, margin: 0 }}>{t("gearRequests")} {pendingRequests.length > 0 && <span style={{ ...S.badge("amber"), marginLeft: 6 }}>{pendingRequests.length} {t("dashPending")}</span>}</p>
                <button style={S.btn("primary", "lg")} onClick={() => setShowGearRequest(true)}>
                  <Icon d={icons.plus} size={15} /> {t("requestBtn")}
                </button>
              </div>
              {myRequests.length === 0 ? (
                <p style={{ fontSize: 13, color: "var(--text-muted,#7B8FA3)" }}>{t("noGearRequests")}</p>
              ) : myRequests.slice().reverse().map((req, i) => {
                const itemLabel = req.items
                  ? req.items.map(it => { const e = equipment.find(x => x.id === it.eqId); return `${e?.name || it.eqName}${it.qty > 1 ? ` ×${it.qty}` : ""}`; }).join(", ")
                  : `${equipment.find(e => e.id === req.eqId)?.name || req.eqName} ×${req.qty}`;
                // Approved requests are picked up with the same photo verification as jobs
                const reqJob = req.status === "approved" ? reqAsJob(req) : null;
                const reqState = reqJob ? getJobCheckoutState(reqJob) : null;
                const needsPickup = reqJob && (reqJob.assignedEquipment || []).some(ae => equipment.some(e => e.id === ae.eqId) && !reqState.pickedIds.has(ae.eqId));
                // Who approves and how you hear back (P3-6): the house is named, LINE is the channel.
                const meLinked = !!(employees || []).find(e => e.id === employee.id)?.lineLinked;
                const statusHint = req.status === "pending" ? (meLinked ? t("requestSentPendingLinked") : t("requestSentPending")).replace("{house}", companyName || t("theHouse"))
                  : req.status === "approved" && needsPickup ? t("reqApprovedHint")
                  : req.status === "denied" || req.status === "rejected" ? t("reqDeniedHint") : "";
                return (
                  <div key={req.id} data-testid={`gear-req-${req.id}`} style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap", paddingBottom: i < myRequests.length - 1 ? 10 : 0, marginBottom: i < myRequests.length - 1 ? 10 : 0, borderBottom: i < myRequests.length - 1 ? "1px solid var(--divider-color,#D8E1EC)" : "none" }}>
                    <span style={S.badge(req.status === "approved" ? "green" : (req.status === "denied" || req.status === "rejected") ? "red" : "amber", "md")}>{statusLabel(t, req.status)}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{itemLabel}</p>
                      <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-muted,#5F7A91)" }}>
                        {req.purpose === "work" ? `${t("reqWork")}${req.jobName}` : t("reqPractice")}
                        {(req.useDates?.length > 0) ? ` · ${req.useDates.map(d => formatDate(d)).join(", ")}` : req.useDate ? ` · ${t("reqForDate").replace("{date}", formatDate(req.useDate))}` : ""}
                        {" · "}{formatDay(new Date(req.requestedAt))}
                      </p>
                      {req.reason && <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-muted,#4E6B84)" }}>{req.reason}</p>}
                      {statusHint && <p style={{ margin: "4px 0 0", fontSize: 11, lineHeight: 1.45, color: req.status === "pending" ? "var(--accent,#2563EB)" : "var(--text-muted,#5F7A91)" }}>{statusHint}</p>}
                    </div>
                    {needsPickup && (
                      <button style={{ ...S.btn("primary", "lg"), flexShrink: 0 }} onClick={() => selectJob(reqJob)}>
                        <Icon d={icons.camera} size={15} /> {t("reqPickUpBtn")}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>


            {/* Gear Request Modal */}
            {showGearRequest && (
              <Modal title={t("reqGearModalTitle")} dirty={gearReqForm.useDates.length > 0 || Object.values(gearReqForm.selectedGear).some(q => q > 0) || !!gearReqForm.reason} onClose={() => { setShowGearRequest(false); setGearReqForm({ useDates: [], purpose: "practice", productionName: "", jobName: "", reason: "", selectedGear: {} }); }} wide>
                <div style={S.col}>
                  <div>
                    <label style={S.label}>{t("datesNeeded")}</label>
                    {(() => {
                      const { year, month } = gearReqCalMonth;
                      const firstDay = new Date(year, month, 1).getDay();
                      const daysInMonth = new Date(year, month + 1, 0).getDate();
                      const monthName = new Date(year, month).toLocaleString(lang === "th" ? "th-TH" : "en-GB", { month: "long", year: "numeric" });
                      const todayStr = today();
                      const cells = [];
                      for (let i = 0; i < firstDay; i++) cells.push(null);
                      for (let d = 1; d <= daysInMonth; d++) cells.push(d);
                      return (
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                            <button style={{ ...S.btn("ghost", "md"), minWidth: 36, padding: "4px 9px" }} aria-label="previous month" onClick={() => setGearReqCalMonth(p => { const d = new Date(p.year, p.month - 1); return { year: d.getFullYear(), month: d.getMonth() }; })}>‹</button>
                            <span style={{ flex: 1, textAlign: "center", fontWeight: 600, fontSize: 13 }}>{monthName}</span>
                            <button style={{ ...S.btn("ghost", "md"), minWidth: 36, padding: "4px 9px" }} aria-label="next month" onClick={() => setGearReqCalMonth(p => { const d = new Date(p.year, p.month + 1); return { year: d.getFullYear(), month: d.getMonth() }; })}>›</button>
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 }}>
                            {(lang === "th" ? ["อา","จ","อ","พ","พฤ","ศ","ส"] : ["Su","Mo","Tu","We","Th","Fr","Sa"]).map((d, i) => <div key={i} style={{ textAlign: "center", fontSize: 11, color: "var(--text-muted,#5F7A91)", fontWeight: 600, paddingBottom: 3 }}>{d}</div>)}
                            {cells.map((d, i) => {
                              if (!d) return <div key={"e"+i} />;
                              const ds = `${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
                              const sel = gearReqForm.useDates.includes(ds);
                              const isToday = ds === todayStr;
                              return (
                                <div key={d} onClick={() => setGearReqForm(p => ({ ...p, useDates: p.useDates.includes(ds) ? p.useDates.filter(x => x !== ds) : [...p.useDates, ds].sort() }))}
                                  style={{ textAlign: "center", padding: "9px 0", minHeight: 36, boxSizing: "border-box", borderRadius: 5, cursor: "pointer", fontSize: 13, fontWeight: sel ? 700 : 400,
                                    background: sel ? "var(--accent,#2563EB)" : isToday ? "rgba(var(--accent-rgb,37,99,235),0.1)" : "transparent",
                                    color: sel ? "var(--accent-text,#FFFFFF)" : isToday ? "var(--accent,#2563EB)" : "var(--text,#16324A)",
                                    border: isToday && !sel ? "1px solid rgba(var(--accent-rgb,37,99,235),0.3)" : "1px solid transparent" }}>
                                  {d}
                                </div>
                              );
                            })}
                          </div>
                          {gearReqForm.useDates.length > 0
                            ? <p style={{ fontSize: 11, color: "var(--accent,#2563EB)", marginTop: 8 }}>{tCount(t, "datesSelected", gearReqForm.useDates.length)} {gearReqForm.useDates.map(d => formatDate(d)).join(", ")}</p>
                            : <p style={{ fontSize: 11, color: "var(--text-muted,#7B8FA3)", marginTop: 8 }}>{t("tapDatesHint")}</p>
                          }
                        </div>
                      );
                    })()}
                  </div>

                  <div>
                    <label style={S.label}>{t("selectEquipment")}</label>
                    {(() => {
                      // One shared availability model (worst day over the chosen dates): gear
                      // still out, other jobs' windows, approved loans and open damage all count.
                      const avList = gearReqForm.useDates.length === 0
                        ? equipment.map(eq => ({ ...eq, available: eq.total, taken: 0, reasons: [] }))
                        : calcAvailableSpan(equipment, gearReqForm.useDates, { jobs, checkouts, equipmentRequests, reports });
                      return (
                        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 300, overflowY: "auto", paddingRight: 4 }}>
                          {avList.map(eq => {
                            const currentQty = +gearReqForm.selectedGear[eq.id] || 0;
                            const isSelected = currentQty > 0;
                            const maxAvail = Math.max(0, eq.available ?? eq.total);
                            const isMulti = eq.total > 1;
                            const reqReasonLines = describeReasons(eq.reasons, t);
                            return (
                              <div key={eq.id}
                                onClick={() => {
                                  if (!isSelected && maxAvail === 0) return;
                                  if (!isSelected) setGearReqForm(p => ({ ...p, selectedGear: { ...p.selectedGear, [eq.id]: 1 } }));
                                  else setGearReqForm(p => { const g = { ...p.selectedGear }; delete g[eq.id]; return { ...p, selectedGear: g }; });
                                }}
                                style={{
                                  display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 10,
                                  border: isSelected ? "1.5px solid var(--accent,#2563EB)" : maxAvail === 0 ? "1.5px solid var(--divider-color,#D8E1EC)" : "1.5px solid var(--border-color,#D8E1EC)",
                                  background: isSelected ? "rgba(var(--accent-rgb,37,99,235),0.07)" : maxAvail === 0 ? "rgba(22,50,74,0.07)" : "var(--surface2,#EAF0F7)",
                                  cursor: maxAvail === 0 && !isSelected ? "not-allowed" : "pointer",
                                  opacity: maxAvail === 0 && !isSelected ? 0.45 : 1,
                                  transition: "all 0.12s",
                                }}>
                                <div style={{ width: 22, height: 22, borderRadius: 6, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                                  background: isSelected ? "var(--accent,#2563EB)" : "var(--surface,#FFFFFF)", border: isSelected ? "none" : "1.5px solid var(--border-color,#D8E1EC)" }}>
                                  {isSelected && <Icon d={icons.check} size={13} color="var(--accent-text,#FFFFFF)" strokeW={3} />}
                                </div>
                                {eq.photo
                                  ? <img src={eq.photo} alt="" style={{ width: 40, height: 36, objectFit: "cover", borderRadius: 6, flexShrink: 0 }} />
                                  : <div style={{ width: 40, height: 36, borderRadius: 6, background: "var(--divider-color,#D8E1EC)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                                      <Icon d={icons.camera} size={14} color="var(--text-muted,#8CA2B5)" />
                                    </div>
                                }
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <p style={{ margin: 0, fontWeight: 600, fontSize: 13, color: isSelected ? "var(--accent,#2563EB)" : "var(--text,#16324A)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{eq.name}</p>
                                  <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-muted,#5F7A91)" }}>
                                    {eq.category}
                                    {isMulti ? ` · ${t("avFree").replace("{a}", maxAvail).replace("{t}", eq.total)}` : maxAvail === 0 ? ` · ${t("jobUnavailable")}` : ` · ${t("jobAvailable")}`}
                                  </p>
                                  {reqReasonLines.length > 0 && reqReasonLines.slice(0, 2).map((l, i) => <p key={i} style={{ margin: "2px 0 0", fontSize: 10, color: "var(--text-muted,#7B8FA3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>· {l}</p>)}
                                </div>
                                {isMulti && isSelected && (
                                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                                    <button style={{ width: 28, height: 28, borderRadius: 6, border: "1px solid var(--border-color,#D8E1EC)", background: "var(--surface,#FFFFFF)", color: "var(--text,#16324A)", fontSize: 16, lineHeight: 1, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                                      onClick={() => setGearReqForm(p => ({ ...p, selectedGear: { ...p.selectedGear, [eq.id]: Math.max(1, (p.selectedGear[eq.id] || 1) - 1) } }))}>−</button>
                                    <span style={{ minWidth: 20, textAlign: "center", fontWeight: 700, fontSize: 14, color: "var(--accent,#2563EB)" }}>{currentQty}</span>
                                    <button style={{ width: 28, height: 28, borderRadius: 6, border: "1px solid var(--border-color,#D8E1EC)", background: "var(--surface,#FFFFFF)", color: "var(--text,#16324A)", fontSize: 16, lineHeight: 1, cursor: currentQty >= maxAvail ? "not-allowed" : "pointer", opacity: currentQty >= maxAvail ? 0.4 : 1, display: "flex", alignItems: "center", justifyContent: "center" }}
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
                        <input style={S.input} value={gearReqForm.productionName} onChange={e => setGearReqForm(p => ({ ...p, productionName: e.target.value }))} placeholder={t("productionHousePh")} />
                      </div>
                      <div>
                        <label style={S.label}>{t("jobNameLabel")}</label>
                        <input style={S.input} value={gearReqForm.jobName} onChange={e => setGearReqForm(p => ({ ...p, jobName: e.target.value }))} placeholder={t("jobNamePh")} />
                      </div>
                    </>
                  )}
                  <div>
                    <label style={S.label}>{t("reasonLabel")}</label>
                    <textarea style={{ ...S.input, height: 70, resize: "vertical", lineHeight: 1.5 }} value={gearReqForm.reason} onChange={e => setGearReqForm(p => ({ ...p, reason: e.target.value }))} placeholder={t("reasonPlaceholder")} />
                  </div>

                  {Object.values(gearReqForm.selectedGear).some(q => q > 0) && (
                    <div style={{ padding: "10px 14px", background: "rgba(var(--accent-rgb,37,99,235),0.06)", border: "1px solid rgba(var(--accent-rgb,37,99,235),0.15)", borderRadius: 8 }}>
                      <p style={{ margin: 0, fontSize: 11, color: "var(--accent,#2563EB)", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>{t("selectedLabel")}</p>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {Object.entries(gearReqForm.selectedGear).filter(([, q]) => q > 0).map(([eqId, qty]) => {
                          const eq = equipment.find(e => e.id === eqId);
                          return eq ? <span key={eqId} style={S.tag}>{eq.name}{eq.total > 1 ? ` ×${qty}` : ""}</span> : null;
                        })}
                      </div>
                    </div>
                  )}

                  {(() => {
                    // Submit stays disabled until one item AND one date are chosen; the reason is written next to it (P2-5).
                    const nItems = Object.values(gearReqForm.selectedGear).filter(q => q > 0).length;
                    const nDates = gearReqForm.useDates.length;
                    const blocker = nItems === 0 && nDates === 0 ? t("reqNeedBoth") : nItems === 0 ? t("reqNeedItem") : nDates === 0 ? t("reqNeedDate") : "";
                    return blocker ? <p data-testid="gear-req-blocker" style={{ margin: 0, fontSize: 12, color: "#B7791F", textAlign: "right" }}>{blocker}</p> : null;
                  })()}
                  <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                    <button style={S.btn("ghost", "lg")} onClick={() => { setShowGearRequest(false); setGearReqForm({ useDates: [], purpose: "practice", productionName: "", jobName: "", reason: "", selectedGear: {} }); }}>{t("cancel")}</button>
                    <button style={{ ...S.btn("primary", "lg"), opacity: (Object.values(gearReqForm.selectedGear).some(q => q > 0) && gearReqForm.useDates.length > 0) ? 1 : 0.45, cursor: (Object.values(gearReqForm.selectedGear).some(q => q > 0) && gearReqForm.useDates.length > 0) ? "pointer" : "not-allowed" }}
                      disabled={!(Object.values(gearReqForm.selectedGear).some(q => q > 0) && gearReqForm.useDates.length > 0)}
                      data-testid="gear-req-submit"
                      onClick={() => {
                      const selectedItems = Object.entries(gearReqForm.selectedGear).filter(([, q]) => q > 0);
                      if (selectedItems.length === 0 || gearReqForm.useDates.length === 0) return;
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
                        const purposeStr = gearReqForm.purpose === "work" ? `Job: ${gearReqForm.jobName}${gearReqForm.productionName ? ` (${gearReqForm.productionName})` : ""}` : "Purpose: Practice";
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

            {/* Equipment Add Request Modal */}
            {showAdminReqModal === "equipment" && (
              <Modal title={t("reqNewEqTitle")} dirty={!!(adminReqForm.name || adminReqForm.category || adminReqForm.notes || adminReqForm.photo)} onClose={() => setShowAdminReqModal(null)}>
                <div style={S.col}>
                  <div>
                    <label style={S.label}>{t("eqItemName")}</label>
                    <input style={S.input} value={adminReqForm.name || ""} onChange={e => setAdminReqForm(p => ({ ...p, name: e.target.value }))} placeholder={t("eqNamePh")} autoFocus />
                  </div>
                  <div>
                    <label style={S.label}>{t("eqCategory")}</label>
                    <input style={S.input} value={adminReqForm.category || ""} onChange={e => setAdminReqForm(p => ({ ...p, category: e.target.value }))} placeholder={t("eqCategoryPh")} />
                  </div>
                  <div>
                    <label style={S.label}>{t("eqReqTotalUnits")}</label>
                    <input style={S.input} type="number" min={1} value={adminReqForm.total || "1"} onChange={e => setAdminReqForm(p => ({ ...p, total: e.target.value }))} />
                  </div>
                  <div>
                    <label style={S.label}>{t("eqNotes")}</label>
                    <input style={S.input} value={adminReqForm.notes || ""} onChange={e => setAdminReqForm(p => ({ ...p, notes: e.target.value }))} placeholder={t("eqNotesPh")} />
                  </div>
                  <div>
                    <label style={S.label}>{t("eqPhotoOptional")}</label>
                    <input ref={adminReqPhotoRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      compressImage(file, { maxDim: 1200, quality: 0.72 }).then(d => d && setAdminReqForm(p => ({ ...p, photo: d })));
                    }} />
                    <button style={S.btn("ghost")} onClick={() => adminReqPhotoRef.current?.click()}><Icon d={icons.photo} size={14} /> {adminReqForm.photo ? t("eqChangePhoto") : t("uploadPhoto")}</button>
                    {adminReqForm.photo && <img src={adminReqForm.photo} alt="preview" style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 6, marginTop: 8 }} />}
                  </div>
                  {adminReqMsg && <p style={{ fontSize: 12, color: adminReqMsg.ok ? "#2F855A" : "#C53030", margin: 0 }}>{adminReqMsg.text}</p>}
                  <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                    <button style={S.btn("ghost")} onClick={() => setShowAdminReqModal(null)}>{t("cancel")}</button>
                    <button style={S.btn("primary")} onClick={() => {
                      if (!adminReqForm.name?.trim()) { setAdminReqMsg({ ok: false, text: t("eqItemNameRequired") }); return; }
                      setAdminRequests(p => [...(p || []), { id: "ar" + Date.now(), type: "equipment", status: "pending", submittedAt: new Date().toISOString(), employeeId: employee.id, employeeName: employee.name, name: adminReqForm.name.trim(), category: adminReqForm.category || "", total: +adminReqForm.total || 1, notes: adminReqForm.notes || "", photo: adminReqForm.photo || null }]);
                      setShowAdminReqModal(null);
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

        {/* GEAR TAB */}
        {tab === "gear" && (() => {
          const myAdminReqs = (adminRequests || []).filter(r => r.employeeId === employee.id);
          const eqAvailList = calcAvailable(equipment || [], today(), { jobs: jobs || [], checkouts: checkouts || [], equipmentRequests: equipmentRequests || [], reports: reports || [] });
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
          // Crew ask "can I borrow the 600d on Saturday": a list question. One 48px row per item,
          // availability in words, the QR label only when this house scans labels (P3-3).
          const showQr = vMode === "barcode" || vMode === "both";
          const freeWords = (eq) => {
            const a = Math.max(0, eq.available ?? eq.total), tot = eq.total || 0;
            if (a <= 0) return t("noneFreeToday");
            if (tot <= 1) return t("freeTodayOne");
            return t("freeTodayN").replace("{a}", a).replace("{t}", tot);
          };
          const renderEqGrid = (items) => (
            <div style={{ ...S.card, padding: 0, overflow: "hidden" }} data-testid="gear-list">
              {items.map((eq, i) => {
                const a = Math.max(0, eq.available ?? eq.total);
                const conflict = (eq.available ?? 0) < 0;
                const tone = conflict || a <= 0 ? "#C53030" : a < (eq.total || 0) ? "#B7791F" : "#2F855A";
                return (
                  <div key={eq.id} data-testid={`gear-row-${eq.id}`} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", minHeight: 64, boxSizing: "border-box", borderBottom: i < items.length - 1 ? "1px solid var(--divider-color,#D8E1EC)" : "none" }}>
                    <div style={{ width: 48, height: 48, borderRadius: 8, overflow: "hidden", background: "var(--surface2,#EAF0F7)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {eq.photo
                        ? <img src={eq.photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                        : <Icon d={icons.camera} size={20} color="var(--border-color,#D8E1EC)" />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontWeight: 700, fontSize: 14, lineHeight: 1.3, color: "var(--text,#16324A)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{eq.name}</p>
                      <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--text-muted,#5F7A91)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {eq.category ? `${eq.category} · ` : ""}<span style={{ color: tone, fontWeight: 600 }}>{conflict ? `${t("avConflict")} ${eq.available}` : freeWords(eq)}</span>
                      </p>
                      <AvReasons av={eq} t={t} max={1} style={{ fontSize: 11, marginTop: 2 }} />
                    </div>
                    {showQr && (
                      <button style={{ ...S.btn("ghost", "lg"), minWidth: 44, padding: "8px 10px", flexShrink: 0 }} aria-label={t("viewQr")} title={t("viewQr")} onClick={() => printQRForItems([eq], false)}>
                        <Icon d={icons.qr} size={18} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          );
          return (
            <div style={S.col}>
              <h1 style={{ ...S.pageTitle, fontSize: 18, marginBottom: 2 }}>{t("tabGear")}</h1>

              {/* Equipment Library */}
              <div>
                <p style={{ ...S.sectionTitle, marginBottom: 8 }}>{tCount(t, "gearLibraryCount", eqAvailList.length)}</p>
                {/* Category filter */}
                {eqCategories.length > 0 && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                    <button onClick={() => setEqFilterCat(null)} style={S.chip(eqFilterCat === null)}>{t("eqAll")}</button>
                    {eqCategories.map(c => (
                      <button key={c} onClick={() => setEqFilterCat(eqFilterCat === c ? null : c)} style={S.chip(eqFilterCat === c)}>{c}</button>
                    ))}
                  </div>
                )}
                {/* Sort: one select instead of a clipped chip row */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <label htmlFor="gear-sort" style={{ ...S.label, margin: 0, whiteSpace: "nowrap" }}>{t("sortLabel")}</label>
                  <select id="gear-sort" style={{ ...S.select, flex: 1, minHeight: 36, padding: "7px 10px" }} value={eqSortBy} onChange={e => setEqSortBy(e.target.value)}>
                    {EQ_SORT_OPTIONS.map(o => <option key={o.key} value={o.key}>{t(o.labelKey)}</option>)}
                  </select>
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
                  <button style={S.btn("primary", "lg")} onClick={() => setShowReportModal(true)}>
                    <Icon d={icons.alert} size={15} /> {t("reportNew")}
                  </button>
                </div>
                {myReports.length === 0 ? (
                  <p style={{ fontSize: 13, color: "var(--text-muted,#7B8FA3)" }}>{t("reportNone")}</p>
                ) : myReports.map(r => (
                  <div key={r.id} style={{ ...S.card, border: r.status === "open" ? "1px solid rgba(197,48,48,0.25)" : "1px solid var(--divider-color,#D8E1EC)", marginBottom: 8 }}>
                    <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
                      {{ open: <span style={S.badge("red")}>{t("reportStatusOpen")}</span>, solved: <span style={S.badge("green")}>{t("reportStatusSolved")}</span>, discarded: <span style={S.badge("gray")}>{t("reportStatusDiscarded")}</span> }[r.status]}
                      {r.eqName && <span style={S.tag}>{r.eqName}</span>}
                      {r.reportedBy?.name && <span style={{ fontSize: 11, color: "var(--text-muted,#6E8398)" }}>{t("reportedBy").replace("{name}", r.reportedBy.name)}</span>}
                    </div>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{r.description}</p>
                    <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--text-muted,#5F7A91)" }}>{formatDateTime(r.ts)}</p>
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
                    {t("eqRequestsTitle")} {myAdminReqs.length > 0 && <span style={S.badge("amber")}>{myAdminReqs.length}</span>}
                  </p>
                  <span style={{ color: "var(--text-muted,#5F7A91)", cursor: "pointer", display: "inline-flex", minWidth: 44, minHeight: 32, alignItems: "center", justifyContent: "flex-end" }}><Icon d={eqReqCollapsed ? icons.chevron_right : icons.chevron_down} size={16} strokeW={2} /></span>
                </div>
                {!eqReqCollapsed && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ display: "flex", gap: 8, marginBottom: myAdminReqs.length > 0 ? 12 : 0 }}>
                      <button style={S.btn("ghost", "md")} onClick={() => { setShowAdminReqModal("equipment"); setAdminReqForm({ name: "", category: "", total: "1", notes: "", photo: null }); setAdminReqMsg(null); }}>{t("eqRequestAddBtn")}</button>
                    </div>
                    {myAdminReqs.length === 0 ? (
                      <p style={{ fontSize: 13, color: "var(--text-muted,#7B8FA3)" }}>{t("eqRequestsNone")}</p>
                    ) : myAdminReqs.slice().reverse().map((req, i, arr) => (
                      <div key={req.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, paddingBottom: i < arr.length - 1 ? 10 : 0, marginBottom: i < arr.length - 1 ? 10 : 0, borderBottom: i < arr.length - 1 ? "1px solid var(--divider-color,#D8E1EC)" : "none" }}>
                        <span style={S.badge(req.status === "approved" ? "green" : req.status === "rejected" ? "red" : req.status === "withdrawn" ? "gray" : "amber", "md")}>{statusLabel(t, req.status)}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{req.name || req.eqName || req.jobName || "—"}{req.type === "geo-return" && req.qty > 1 ? ` ×${req.qty}` : ""}</p>
                          <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-muted,#5F7A91)" }}>
                            {req.type === "production-house" ? t("reqTypeProductionHouse") : req.type === "geo-return" ? t("geoLabelReturn") : req.type === "member-register" ? t("reqTypeMemberRegister") : req.type === "early-pickup" ? t("reqTypeEarlyPickup") : req.type === "early-return" ? t("reqTypeEarlyReturn") : t("reqTypeEquipment")}
                            {req.type === "geo-return" && req.distance != null ? ` · ${t("geoDistanceFrom").replace("{dist}", req.distance < 1000 ? `${req.distance} m` : `${(req.distance / 1000).toFixed(1)} km`)}` : ""}
                            {req.status === "approved" && (req.type === "equipment" || req.type === "production-house") ? ` · ${t("reqAddedToSystem")}` : ""}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Add New Equipment — goes to admin approval */}
              <div style={S.card}>
                <p style={{ ...S.sectionTitle, margin: "0 0 8px" }}>{t("addNewEqTitle")}</p>
                <p style={{ fontSize: 11, color: "var(--text-muted,#5F7A91)", margin: "0 0 12px" }}>{t("addNewEqDesc")}</p>
                <button style={S.btn("primary", "lg")} onClick={() => { setShowAdminReqModal("equipment"); setAdminReqForm({ name: "", category: "", total: "1", notes: "", photo: null }); setAdminReqMsg(null); }}>
                  <Icon d={icons.plus} size={15} /> {t("submitEquipment")}
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
                  ? <img src={profilePhoto} alt="profile" style={{ width: 100, height: 100, borderRadius: "50%", objectFit: "cover", border: "3px solid var(--accent,#2563EB)" }} />
                  : <div style={{ width: 100, height: 100, borderRadius: "50%", background: "var(--divider-color,#D8E1EC)", display: "flex", alignItems: "center", justifyContent: "center", border: "3px solid var(--border-color,#D8E1EC)" }}>
                      <Icon d={icons.user} size={40} color="var(--text-muted,#8CA2B5)" />
                    </div>
                }
              </div>
              <div style={{ textAlign: "center" }}>
                <p style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "var(--text,#16324A)" }}>{profileInfo.nickname || employee.name}</p>
                {profileInfo.firstName && <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--text-muted,#4E6B84)" }}>{profileInfo.firstName} {profileInfo.lastName}</p>}
                <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-muted,#5F7A91)" }}>{crewRoleLabel}</p>
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
              const myEvents = kpiEventsInPeriod(employee.id, kpiEvents, kpiConfig);
              const rules = visibleKpiRules(punishments);
              return (
                <div style={S.card} data-testid="kpi-card">
                  <p style={{ ...S.sectionTitle, display: "flex", alignItems: "center", gap: 6 }}><Icon d={icons.star} size={13} fill="currentColor" /> {t("kpiMyScore")}</p>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
                    <StarRating value={stars} size={26} />
                    <span style={{ fontSize: 24, fontWeight: 800, color: "var(--accent,#2563EB)" }}>{stars.toFixed(1)}</span>
                    <span style={{ fontSize: 13, color: "var(--text-muted,#4E6B84)" }}>{score}/{max} {t("kpiPts")}</span>
                  </div>
                  <p style={{ fontSize: 11, color: "var(--text-muted,#5F7A91)", margin: "0 0 4px" }}>
                    {t("teamKpiPeriodLabel")} {formatDate(start)} – {formatDate(new Date(end.getTime() - 86400000))}
                  </p>
                  {myEvents.length === 0 ? (
                    <p style={{ fontSize: 13, color: "#2F855A", margin: "8px 0 0" }}>{t("kpiFullScore")}</p>
                  ) : (
                    <div style={{ marginTop: 12, borderTop: "1px solid var(--divider-color,#D8E1EC)", paddingTop: 10 }}>
                      <p style={{ ...S.sectionTitle, marginBottom: 8 }}>{t("kpiHistory")}</p>
                      {myEvents.map(ev => (
                        <div key={ev.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
                          <span style={{ ...S.badge(isKpiAdd(ev) ? "green" : "red"), flexShrink: 0 }}>{isKpiAdd(ev) ? "+" : "−"}{Math.abs(parseFloat(ev.points) || 0)}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ margin: 0, fontSize: 13, color: "var(--text,#16324A)" }}>{ev.reason}</p>
                            <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-muted,#7B8FA3)" }}>{formatDate(new Date(ev.ts))}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* The rules are known before they bite (P3-2): read-only copy of the house's deduction presets */}
                  <div style={{ marginTop: 12, borderTop: "1px solid var(--divider-color,#D8E1EC)", paddingTop: 10 }} data-testid="kpi-rules">
                    <p style={{ ...S.sectionTitle, marginBottom: 4 }}>{t("kpiRulesTitle")}</p>
                    <p style={{ fontSize: 11, color: "var(--text-muted,#7B8FA3)", margin: "0 0 8px" }}>{t("kpiRulesHint")}</p>
                    {rules.length === 0 ? (
                      <p style={{ fontSize: 12, color: "var(--text-muted,#7B8FA3)", margin: 0 }}>{t("kpiRulesNone")}</p>
                    ) : rules.map((r, i) => (
                      <div key={r.id || i} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "5px 0", borderBottom: i < rules.length - 1 ? "1px dashed var(--divider-color,#D8E1EC)" : "none" }}>
                        <span style={{ ...S.badge("gray"), flexShrink: 0, minWidth: 36, justifyContent: "center" }}>−{parseFloat(r.points) || 0}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ margin: 0, fontSize: 12, color: "var(--text,#16324A)" }}>{r.label}</p>
                          {r.description && <p style={{ margin: "1px 0 0", fontSize: 11, color: "var(--text-muted,#7B8FA3)" }}>{r.description}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
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
                  <label style={S.label}>{t("nickname")} <span style={{ color: "var(--text-muted,#5F7A91)", fontWeight: 400 }}>{t("shownInPortal")}</span></label>
                  <input style={S.input} placeholder={t("nickname")} value={profileInfo.nickname} onChange={e => setProfileInfo(p => ({ ...p, nickname: e.target.value }))} />
                </div>
                {[
                  { key: "phone", label: t("phone"), type: "tel", placeholder: t("phonePh") },
                  { key: "email", label: t("email"), type: "email", placeholder: t("emailPh") },
                  { key: "lineId", label: t("lineId"), type: "text", placeholder: t("lineIdPh") },
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
                <div>
                  <label style={S.label}>{t("profileTaxId")}</label>
                  <input style={S.input} inputMode="numeric" maxLength={17} placeholder="1234567890123" value={profileInfo.taxId}
                    onChange={e => setProfileInfo(p => ({ ...p, taxId: e.target.value.replace(/[^0-9A-Za-z-]/g, "") }))} />
                  <p style={{ fontSize: 11, color: "var(--text-muted,#5F7A91)", margin: "4px 0 0", lineHeight: 1.5 }}>{t("profileTaxIdHint")}</p>
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
              <p style={{ fontSize: 11, color: "var(--text-muted,#5F7A91)", margin: "0 0 14px", lineHeight: 1.6 }}>{t("positionsDesc")}</p>
              {positions.length === 0 && <p style={{ fontSize: 13, color: "var(--text-muted,#5F7A91)", margin: 0 }}>{t("positionsEmpty")}</p>}
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {positions.map((pos, i) => {
                  const rph = (parseFloat(pos.dayRate) || 0) / (parseFloat(pos.hoursPerDay) || 12);
                  return (
                    <div key={pos.id} style={{ border: "1px solid var(--border-color,#D8E1EC)", borderRadius: 10, padding: 14, background: "rgba(22,50,74,0.04)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                        <span style={S.badge("amber")}>{t("roleLabel")} {i + 1}</span>
                        <div style={{ flex: 1 }} />
                        <button style={{ ...S.btn("danger"), padding: "5px 8px" }} onClick={() => removePosition(pos.id)}><Icon d={icons.trash} size={13} /></button>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        <div>
                          <label style={S.label}>{t("positionName")}</label>
                          <input style={S.input} value={pos.name} list="psr-role-list" placeholder={t("positionPh")} onChange={e => updatePosition(pos.id, { name: e.target.value })} />
                          <p style={{ fontSize: 10, color: "var(--text-muted,#7B8FA3)", margin: "4px 0 0" }}>{t("positionPickHint")}</p>
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
                          <p style={{ fontSize: 11, color: "var(--text-muted,#5F7A91)", margin: 0 }}>{t("hourlyRate")}: ฿{rph.toLocaleString(undefined, { maximumFractionDigits: 2 })}{t("perHr")}</p>
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
                            <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                              {[["multiplier", t("otModeMultiplier")], ["flatRate", t("otModeFlatRate")]].map(([k, lbl]) => (
                                <button key={k} style={{ ...S.btn((pos.otMode || "multiplier") === k ? "primary" : "ghost"), padding: "4px 10px", fontSize: 11 }} onClick={() => updatePosition(pos.id, { otMode: k })}>{lbl}</button>
                              ))}
                            </div>
                            {(pos.otMode || "multiplier") === "multiplier" ? (
                              <>
                                <label style={S.label}>{t("otMultiplierLabel")}</label>
                                <input style={{ ...S.input, maxWidth: 140 }} type="number" min="1" step="0.25" inputMode="decimal" value={pos.otMultiplier} placeholder="1.5" onChange={e => updatePosition(pos.id, { otMultiplier: e.target.value })} />
                              </>
                            ) : (
                              <>
                                <label style={S.label}>{t("otFlatRateLabel")}</label>
                                <input style={{ ...S.input, maxWidth: 140 }} type="number" min="0" step="50" inputMode="decimal" value={pos.otFlatRate || ""} placeholder="500" onChange={e => updatePosition(pos.id, { otFlatRate: e.target.value })} />
                              </>
                            )}
                            {(() => { const ex = otExample(pos); if (!ex) return null; const f = n => Math.round(n).toLocaleString(); const f2 = n => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
                              return <p style={{ fontSize: 11, color: "var(--accent,#2563EB)", margin: "6px 0 0", lineHeight: 1.5 }}>{ex.mode === "flatRate"
                                ? t("otExampleFlat").replace("{h}", ex.base).replace("{ot}", f(ex.otPerHour))
                                : t("otExampleMult").replace("{dayRate}", f(ex.dayRate)).replace("{h}", ex.base).replace(/\{rph\}/g, f2(ex.ratePerHour)).replace("{mult}", ex.mult).replace("{ot}", f2(ex.otPerHour))}</p>; })()}
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
                                    <span style={{ fontSize: 11, color: "var(--text-muted,#5F7A91)", whiteSpace: "nowrap" }}>{from}h–</span>
                                    <input style={{ ...S.input, padding: "7px 8px" }} type="number" min="0" inputMode="decimal" value={tr.untilHour} placeholder="14" onChange={e => updateTier(pos.id, ti, { untilHour: e.target.value })} />
                                    <span style={{ fontSize: 11, color: "var(--text-muted,#5F7A91)" }}>h</span>
                                  </div>
                                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                    <input style={{ ...S.input, padding: "7px 8px" }} type="number" min="1" step="0.25" inputMode="decimal" value={tr.mult} placeholder="1.5" onChange={e => updateTier(pos.id, ti, { mult: e.target.value })} />
                                    <span style={{ fontSize: 11, color: "var(--text-muted,#5F7A91)" }}>×</span>
                                  </div>
                                  <button style={{ ...S.btn("danger"), padding: "5px 6px", minWidth: 0 }} onClick={() => removeTier(pos.id, ti)}><Icon d={icons.x} size={12} /></button>
                                </div>
                              );
                            })}
                            <p style={{ fontSize: 10, color: "var(--text-muted,#7B8FA3)", margin: "2px 0 0" }}>{t("otTiersNote")}</p>
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
                  <p style={{ fontSize: 11, color: "var(--text-muted,#5F7A91)", margin: "0 0 8px", lineHeight: 1.5 }}>{t("profileIdCardHelp")}</p>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    {idCard && <img src={idCard} alt="ID" style={{ width: 100, height: 66, objectFit: "cover", borderRadius: 6, border: "1px solid var(--border-color,#D8E1EC)" }} />}
                    <input ref={idCardRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleDocUpload(setIdCard, { maxDim: 1400, quality: 0.72 }, "idCard")} />
                    <button style={S.btn("ghost")} onClick={() => idCardRef.current.click()}>
                      <Icon d={icons.photo} size={14} /> {idCard ? t("replacePhoto") : t("uploadPhoto")}
                    </button>
                    {idCard && <button style={{ ...S.btn("danger"), padding: "7px 10px" }} onClick={() => setIdCard(null)}><Icon d={icons.x} size={13} /></button>}
                  </div>
                  {idCard && consentLine("idCard")}
                </div>
                {/* PromptPay / Bank QR */}
                <div>
                  <label style={S.label}>{t("promptPayQR")}</label>
                  <p style={{ fontSize: 11, color: "var(--text-muted,#5F7A91)", margin: "0 0 8px", lineHeight: 1.5 }}>{t("profileQrHelp")}</p>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    {promptPayQR && <img src={promptPayQR} alt="QR" style={{ width: 80, height: 80, objectFit: "contain", borderRadius: 6, border: "1px solid var(--border-color,#D8E1EC)", background: "#fff" }} />}
                    <input ref={promptPayRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleDocUpload(setPromptPayQR, { maxDim: 1000, quality: 0.85 }, "promptPayQR")} />
                    <button style={S.btn("ghost")} onClick={() => promptPayRef.current.click()}>
                      <Icon d={icons.photo} size={14} /> {promptPayQR ? t("replacePhoto") : t("uploadPhoto")}
                    </button>
                    {promptPayQR && <button style={{ ...S.btn("danger"), padding: "7px 10px" }} onClick={() => setPromptPayQR(null)}><Icon d={icons.x} size={13} /></button>}
                  </div>
                  {promptPayQR && consentLine("promptPayQR")}
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
                  <label style={S.label}>{t("profilePrefix")} <span style={{ color: "#C53030" }}>*</span></label>
                  <p style={{ fontSize: 11, color: "var(--text-muted,#5F7A91)", margin: "0 0 6px", lineHeight: 1.5 }}>{t("profilePrefixHint").replace("{prefix}", profileInfo.invoicePrefix || "XXXX")}</p>
                  <input style={{ ...S.input, borderColor: profileInfo.invoicePrefix ? undefined : "#C53030" }} autoCapitalize="characters" placeholder={derivePrefix({ nickname: profileInfo.nickname, firstName: profileInfo.firstName, name: employee.name, id: employee.id })} maxLength={6}
                    value={profileInfo.invoicePrefix}
                    onChange={e => setProfileInfo(p => ({ ...p, invoicePrefix: sanitizePrefix(e.target.value) }))}
                    onBlur={() => setProfileInfo(p => ({ ...p, invoicePrefix: derivePrefix({ invoicePrefix: p.invoicePrefix, nickname: p.nickname, firstName: p.firstName, name: employee.name, id: employee.id }) }))} />
                </div>
                {/* Signature */}
                <div>
                  <label style={S.label}>{t("signatureSection")}</label>
                  <p style={{ fontSize: 11, color: "var(--text-muted,#5F7A91)", margin: "0 0 8px", lineHeight: 1.5 }}>{t("signatureHint")} {t("profileSignatureHelp")}</p>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    {signature && <img src={signature} alt="Signature" style={{ height: 50, maxWidth: 160, objectFit: "contain", borderRadius: 6, border: "1px solid var(--border-color,#D8E1EC)", background: "#fff", padding: 4 }} />}
                    <input ref={signatureRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => {
                      const f = e.target.files[0]; if (!f) return;
                      const r = new FileReader();
                      r.onload = (ev) => makeSignatureTransparent(ev.target.result).then(d => { setSignature(d); setDocConsent(c => ({ ...c, signature: Date.now() })); });
                      r.readAsDataURL(f);
                    }} />
                    <button style={S.btn("ghost")} onClick={() => signatureRef.current.click()}>
                      <Icon d={icons.photo} size={14} /> {signature ? t("replacePhoto") : t("uploadSignature")}
                    </button>
                    {signature && <button style={{ ...S.btn("danger"), padding: "7px 10px" }} onClick={() => setSignature(null)}><Icon d={icons.x} size={13} /></button>}
                  </div>
                  {signature && consentLine("signature")}
                </div>
                <datalist id="psr-role-list">{houseRoles.map(r => <option key={r.value} value={r.value}>{lang === "th" ? `${r.label} · ${r.dept}` : r.dept}</option>)}</datalist>
              </div>
            </div>

            {/* PIN Change: verified + written server-side (P0-2); nothing about the PIN stays in state */}
            <div style={S.card}>
              <p style={S.sectionTitle}>{t("changePasscode")}</p>
              <div style={S.col}>
                <div>
                  <label style={S.label}>{t("settingsCurrentPinLabel")}</label>
                  <input style={S.input} type="password" inputMode="numeric" maxLength={6} value={pinChangeForm.oldPin} onChange={e => setPinChangeForm(p => ({ ...p, oldPin: e.target.value.replace(/\D/g, "") }))} />
                </div>
                <div>
                  <label style={S.label}>{t("newPinLabel")}</label>
                  <input style={S.input} type="password" inputMode="numeric" maxLength={6} value={pinChangeForm.newPin} onChange={e => setPinChangeForm(p => ({ ...p, newPin: e.target.value.replace(/\D/g, "") }))} placeholder="e.g. 5678" />
                </div>
                <div>
                  <label style={S.label}>{t("confirmPinLabel")}</label>
                  <input style={S.input} type="password" inputMode="numeric" maxLength={6} value={pinChangeForm.confirmPin} onChange={e => setPinChangeForm(p => ({ ...p, confirmPin: e.target.value.replace(/\D/g, "") }))} placeholder="Re-enter PIN" />
                </div>
                {pinChangeMsg && <p style={{ fontSize: 12, color: pinChangeMsg.ok ? "#2F855A" : "#C53030", margin: 0 }}>{pinChangeMsg.text}</p>}
                <button style={{ ...S.btn("primary"), alignSelf: "flex-end", opacity: pinChangeBusy ? 0.6 : 1 }} disabled={pinChangeBusy} onClick={async () => {
                  const { oldPin, newPin, confirmPin } = pinChangeForm;
                  if (!/^\d{4,6}$/.test(oldPin)) { setPinChangeMsg({ ok: false, text: t("settingsPinWrong") }); return; }
                  if (!/^\d{4,6}$/.test(newPin)) { setPinChangeMsg({ ok: false, text: t("loginPinDigits") }); return; }
                  if (newPin !== confirmPin) { setPinChangeMsg({ ok: false, text: t("loginPinMatch") }); return; }
                  setPinChangeBusy(true);
                  const r = await api.changePin(oldPin, newPin).catch(() => ({ status: 0 }));
                  setPinChangeBusy(false);
                  if (r.ok) { setPinChangeForm({ oldPin: "", newPin: "", confirmPin: "" }); setPinChangeMsg({ ok: true, text: t("pinResetDone") }); setTimeout(() => setPinChangeMsg(null), 3000); return; }
                  if (r.status === 401) { setPinChangeMsg({ ok: false, text: t("settingsPinWrong") }); return; }
                  if (r.status === 429) { setPinChangeMsg({ ok: false, text: t("loginTooManyAttempts") + (r.retryAfter || 60) + t("loginSeconds") }); return; }
                  setPinChangeMsg({ ok: false, text: r.error || t("pinSaveFailed") });
                }}>{t("updatePasscode")}</button>
              </div>
            </div>

            {/* LINE notifications (P3-6): link this account to a LINE user through the OA */}
            <div style={S.card} data-testid="line-link-card">
              <p style={{ ...S.sectionTitle, display: "flex", alignItems: "center", gap: 6 }}><Icon d={icons.bell} size={13} /> {t("lineLinkTitle")}</p>
              <div style={S.col}>
                {lineLink?.linked ? (
                  <>
                    <p style={{ fontSize: 13, color: "#2F855A", margin: 0, lineHeight: 1.6, display: "flex", gap: 6, alignItems: "flex-start" }}><Icon d={icons.check} size={15} style={{ flexShrink: 0, marginTop: 2 }} /> <span>{t("lineLinked")}</span></p>
                    <div><button style={S.btn("ghost", "md")} onClick={async () => { const r = await api.lineUnlink().catch(() => null); if (r && r.ok) setLineLink(r); }}>{t("lineUnlink")}</button></div>
                  </>
                ) : (
                  <>
                    <p style={{ fontSize: 13, color: "var(--text-muted,#5F7A91)", margin: 0, lineHeight: 1.7 }}>{t("lineLinkedNo")} {t("lineLinkHintCrew")}</p>
                    {lineLink?.code ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                        <div>
                          <p style={{ ...S.label, margin: 0 }}>{t("lineLinkCode")}</p>
                          <p data-testid="line-link-code" style={{ margin: "2px 0 0", fontSize: 26, fontWeight: 800, letterSpacing: "0.12em", fontFamily: "monospace", color: "var(--accent,#2563EB)" }}>{lineLink.code}</p>
                        </div>
                        <button style={S.btn("ghost", "md")} onClick={async () => { const r = await api.lineLink().catch(() => null); if (r && r.ok) setLineLink(r); }}>{t("lineLinkRefresh")}</button>
                      </div>
                    ) : (
                      <div><button style={S.btn("primary", "md")} data-testid="line-link-get" onClick={async () => { const r = await api.lineLinkCode().catch(() => null); if (r && r.ok) setLineLink(r); }}>{t("lineLinkGetCode")}</button></div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Calendar Sync */}
            <div style={S.card}>
              <p style={{ ...S.sectionTitle, display: "flex", alignItems: "center", gap: 6 }}><Icon d={icons.calendar} size={13} /> {t("calendarSync")}</p>
              <div style={S.col}>
                <p style={{ fontSize: 13, color: "var(--text-muted,#5F7A91)", margin: 0, lineHeight: 1.7 }}>
                  {lang === "th" ? t("calSyncDesc") : <>Subscribe to the production schedule in your iPhone Calendar. Pencil jobs appear <strong style={{ color: "var(--text,#16324A)" }}>tentative (striped)</strong>, Confirmed are <strong style={{ color: "#2F855A" }}>solid</strong>. Updates hourly.</>}
                </p>
                <div style={{ fontSize: 12, color: "var(--text-muted,#5F7A91)", lineHeight: 1.8 }}>
                  <strong style={{ color: "var(--text,#16324A)", display: "block", marginBottom: 6 }}>{t("calSyncSetup")}</strong>
                  1. <strong>{t("calSyncStep1")}</strong><br />
                  2. <strong>{t("calSyncStep2")}</strong><br />
                  3. <strong>{t("calSyncStep3")}</strong>
                </div>
                <code style={{ background: "rgba(var(--accent-rgb,37,99,235),0.1)", color: "var(--accent,#2563EB)", padding: "6px 10px", borderRadius: 6, fontSize: 11, wordBreak: "break-all" }}>
                  {calendarToken ? calendarUrl(calendarToken) : "…"}
                </code>
                <p style={{ fontSize: 12, color: "var(--text-muted,#5F7A91)", margin: 0 }}>{t("settingsCalTokenHint")}</p>
                <button style={{ ...S.btn("ghost"), alignSelf: "flex-start", fontSize: 12 }} disabled={!calendarToken} onClick={() => navigator.clipboard?.writeText(calendarUrl(calendarToken))}>
                  <Icon d={icons.copy} size={13} /> {t("copyUrl")}
                </button>
              </div>
            </div>

            {/* Save Profile: sticks ABOVE the 62px bottom nav + the phone's home indicator (P1-3) */}
            <div data-sticky-primary="profile-save" style={{ position: "sticky", bottom: "calc(62px + 16px + env(safe-area-inset-bottom, 0px))", zIndex: 10 }}>
              <button
                style={{ ...S.btn(profileSaveStatus === "saved" || profileSaveStatus === "queued" ? "success" : profileSaveStatus === "error" ? "danger" : "primary", "lg"), width: "100%", padding: "15px", fontSize: 15, fontWeight: 700, opacity: profileSaveStatus === "saving" ? 0.75 : 1, boxShadow: "0 4px 24px rgba(22,50,74,0.17)" }}
                disabled={profileSaveStatus === "saving"}
                onClick={saveProfile}
              >
                {profileSaveStatus === "saving" ? t("profileSaving") : profileSaveStatus === "saved" ? t("profileSaved") : profileSaveStatus === "queued" ? t("profileSaveQueued") : profileSaveStatus === "error" ? t("profileSaveFail") : t("profileSaveBtn")}
              </button>
            </div>

            {/* My recent activity — consolidated per job + pick/return */}
            <div style={S.card}>
              <p style={S.sectionTitle}>{t("recentActivity")}</p>
              {(() => {
                const mine = checkouts.filter(c => c.employeeId === employee.id && !isVoidEvt(c.type));
                if (mine.length === 0) return <p style={{ fontSize: 13, color: "var(--text-muted,#5F7A91)" }}>{t("noActivity")}</p>;
                const groups = {};
                mine.forEach(c => {
                  const kind = (isPickEvt(c.type)) ? "pick" : "return";
                  const key = `${c.jobId || c.jobName || "x"}|${kind}`;
                  if (!groups[key]) groups[key] = { key, jobName: c.jobName || "—", kind, items: [], latest: 0 };
                  groups[key].items.push(c);
                  if ((c.ts || 0) > groups[key].latest) groups[key].latest = c.ts || 0;
                });
                const list = Object.values(groups).sort((a, b) => b.latest - a.latest).slice(0, 10);
                return list.map((g, i, arr) => {
                  const open = !!expandedActivity[g.key];
                  return (
                    <div key={g.key} style={{ paddingBottom: i < arr.length - 1 ? 10 : 0, borderBottom: i < arr.length - 1 ? "1px solid var(--divider-color,#D8E1EC)" : "none", marginBottom: i < arr.length - 1 ? 10 : 0 }}>
                      <div onClick={() => setExpandedActivity(p => ({ ...p, [g.key]: !p[g.key] }))} style={{ display: "flex", gap: 10, alignItems: "center", cursor: "pointer" }}>
                        <span style={{ ...S.badge(g.kind === "pick" ? "amber" : "green"), flexShrink: 0 }}>{g.kind === "pick" ? t("pickEvt") : t("returnEvt")}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>{g.jobName}</p>
                          <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-muted,#5F7A91)" }}>{tCount(t, "itemsN", g.items.length)} · {formatDateTime(g.latest)}</p>
                        </div>
                        <span style={{ color: "var(--text-muted,#5F7A91)", flexShrink: 0, display: "inline-flex", transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }}><Icon d={icons.chevron_right} size={16} strokeW={2} /></span>
                      </div>
                      {open && (
                        <div style={{ marginTop: 8, paddingLeft: 10, borderLeft: "2px solid var(--divider-color,#D8E1EC)", display: "flex", flexDirection: "column", gap: 6 }}>
                          {g.items.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0)).map((c, j) => {
                            const eq = equipment.find(e => e.id === c.eqId);
                            return (
                              <div key={j} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                {eq?.photo && <img src={eq.photo} alt="" style={{ width: 28, height: 24, objectFit: "cover", borderRadius: 4, flexShrink: 0 }} />}
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <p style={{ margin: 0, fontSize: 12, fontWeight: 600 }}>{eq?.name || c.eqName || "Unknown"}</p>
                                  <p style={{ margin: 0, fontSize: 10, color: "var(--text-muted,#7B8FA3)" }}>{formatDateTime(c.ts)}</p>
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
          const allConfirmed = jobs.filter(j => j.status === "Confirmed").sort((a, b) => (b.dates[0] || "") > (a.dates[0] || "") ? 1 : -1);
          // Only jobs I am on (or unstaffed ones) are offered for invoicing; "show all" is one tap away (P1-10).
          const { mine: myConfirmed, others: otherConfirmed } = splitJobsForEmployee(allConfirmed, employee.id);
          const confirmedJobs = invShowAllJobs ? allConfirmed : myConfirmed;
          const allMyInvoices = invoices.filter(inv => inv.employeeId === employee.id && !inv._deleted);
          // Revenue = invoices only: a quotation is not income and a receipt repeats its invoice's amount.
          const revenueDocs = allMyInvoices.filter(inv => inv.status !== "Void" && (inv.docType === "invoice" || !inv.docType));
          const filteredInvoices = allMyInvoices
            .filter(inv => (invFilter === "all" || (inv.status || "Pending") === invFilter) && (invDocType === "all" || (inv.docType || "invoice") === invDocType))
            .sort((a, b) => invSort === "amount" ? calcTotal(b) - calcTotal(a) : b.updatedAt - a.updatedAt);
          const myInvoices = filteredInvoices;

          const saveInvoice = (inv) => {
            const isNew = !invoices.some(i => i.id === inv.id);
            setInvoices(p => {
              const idx = p.findIndex(i => i.id === inv.id);
              return idx >= 0 ? p.map(i => i.id === inv.id ? inv : i) : [...p, inv];
            });
            setInvoiceModal(null);
            toast(t(isNew ? "docCreatedToast" : "docUpdatedToast").replace("{no}", fmtInvoiceNo(inv)));
            if (isNew) setExpandedInv(inv.id);
          };
          const hasBankInfo = !!(profileInfo.bankAccount || profileInfo.bankName || promptPayQR);
          const issueReceipt = (inv) => {
            const { list, receipt } = issueReceiptFor(invoices, inv, APP_TZ);
            if (!receipt) return;
            setInvoices(list);
            toast(t("receiptIssuedToast").replace("{no}", receipt.invoiceNo));
            setInvDocType("all"); setExpandedInv(receipt.id);
          };
          const liveReceiptFor = (inv) => invoices.find(i => !i._deleted && i.docType === "receipt" && i.status !== "Void" && (i.linkedInvId === inv.id || i.invoiceNo === rtxNoFromInv(inv.invoiceNo)));
          const shareDoc = async (inv) => {
            setInvSending(inv.id);
            try {
              const html = buildInvoiceHTML({ invoice: inv, employee, profileInfo, promptPayQR, idCard, signature, productionCompanies, companyName, autoPrint: false });
              const { key, token, expiresAt } = await api.shareInvoice(html);
              const shareUrl = `https://pickshootreturn.pages.dev/api/invoice-view/${key}`;
              const name = profileInfo.firstName ? `${profileInfo.firstName} ${profileInfo.lastName || ""}`.trim() : employee.name;
              const total = calcTotal(inv);
              const msg = `🧾 Invoice · ${name}\n📄 ${fmtInvoiceNo(inv)}\n🎬 ${inv.jobName || "—"}${inv.productionCompany ? ` · ${inv.productionCompany}` : ""}\n💰 ฿${total.toLocaleString()}\n📋 ${inv.status || "Pending"}\n🔗 ${shareUrl}\n⏳ 72h`;
              await api.notify({ userIds: [lineGroupId], message: msg });
              // Remember the link (with its revoke token) on the document so it can be inspected / revoked later.
              setInvoices(p => p.map(i => i.id === inv.id ? { ...i, share: { key, token, createdAt: Date.now(), expiresAt } } : i));
              setShareInfo(si => ({ ...si, [inv.id]: { views: 0, expiresAt, expired: false } }));
              toast(t("shareSent"));
            } catch { toast(t("shareFailed"), { kind: "error" }); }
            setInvSending(null);
          };
          const refreshShare = async (inv) => {
            if (!inv.share?.key) return;
            const st = await api.shareStatus(inv.share.key, inv.share.token);
            setShareInfo(si => ({ ...si, [inv.id]: st.found ? st : { expired: true, views: 0 } }));
          };
          const revokeShare = async (inv) => {
            if (!inv.share?.key) return;
            await api.revokeShare(inv.share.key, inv.share.token);
            setInvoices(p => p.map(i => i.id === inv.id ? { ...i, share: null } : i));
            setShareInfo(si => { const n = { ...si }; delete n[inv.id]; return n; });
            toast(t("shareRevoked"));
          };

          const delInvoice = (id) => {
            if (window.confirm(t("deleteDocConfirm"))) setInvoices(p => p.map(i => i.id === id ? { ...i, _deleted: true, deletedAt: Date.now(), deletedBy: actorName() } : i));
          };

          return (
            <div style={S.col}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <h1 style={{ ...S.pageTitle, fontSize: 18, marginBottom: 2 }}>{t("myInvoices")}</h1>
                  <p style={{ ...S.pageSubtitle, marginBottom: 0, fontSize: 12 }}>{tCount(t, "invCountTotal", allMyInvoices.length).replace("{total}", allMyInvoices.reduce((s, inv) => s + calcTotal(inv), 0).toLocaleString())}</p>
                </div>
                {/* A document needs no job at all: same job billed per day or per week is
                    several documents, and each must mint its own number (crew ask 2026-09-23). */}
                <button data-testid="invoice-new-blank" style={{ ...S.btn("primary", "md"), flexShrink: 0 }} onClick={() => setInvoiceModal({ job: null, existing: null })}>
                  <Icon d={icons.plus} size={14} /> {t("crewNewDoc")}
                </button>
              </div>

              {/* Revenue Summary */}
              {(() => {
                const allYears = [...new Set(revenueDocs.map(inv => new Date(inv.createdAt || inv.updatedAt).getFullYear().toString()))].sort((a,b)=>b-a);
                const revInvs = revenueDocs.filter(inv => {
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
                      <p style={{ ...S.sectionTitle, margin: 0 }}>{t("revenue")}</p>
                      <div style={{ display: "flex", gap: 6 }}>
                        {[["all", t("revAll")],["year", t("revByYear")],["custom", t("revCustom")]].map(([k,lbl]) => (
                          <button key={k} style={S.chip(revPeriod === k)} onClick={() => setRevPeriod(k)}>{lbl}</button>
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
                        <div><label style={S.label}>{t("revFrom")}</label><input style={S.input} type="date" value={revFrom} onChange={e => setRevFrom(e.target.value)} /></div>
                        <div><label style={S.label}>{t("revTo")}</label><input style={S.input} type="date" value={revTo} onChange={e => setRevTo(e.target.value)} /></div>
                      </div>
                    )}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      <div style={{ background: "rgba(var(--accent-rgb,37,99,235),0.06)", borderRadius: 8, padding: "10px 14px" }}>
                        <p style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--text-muted,#5F7A91)" }}>{t("totalInvoiced")}</p>
                        <p style={{ margin: "4px 0 0", fontSize: 20, fontWeight: 800, color: "var(--accent,#2563EB)" }}>฿{revTotal.toLocaleString()}</p>
                        <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-muted,#5F7A91)" }}>{tCount(t, "invoicesN", revInvs.length)}</p>
                      </div>
                      <div style={{ background: "rgba(47,133,90,0.06)", borderRadius: 8, padding: "10px 14px" }}>
                        <p style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--text-muted,#5F7A91)" }}>{t("paidLabel")}</p>
                        <p style={{ margin: "4px 0 0", fontSize: 20, fontWeight: 800, color: "#2F855A" }}>฿{revPaid.toLocaleString()}</p>
                        <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-muted,#5F7A91)" }}>{t("pendingAmount").replace("{amt}", (revTotal - revPaid).toLocaleString())}</p>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Filter/Sort row */}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                {["all", "Pending", "Paid"].map(f => (
                  <button key={f} style={S.chip(invFilter === f)} onClick={() => setInvFilter(f)}>
                    {f === "all" ? t("filterAll") : f === "Paid" ? t("stPaid") : t("invPending")}
                  </button>
                ))}
                <div style={{ flex: 1 }} />
                <button style={S.chip(invSort === "date")} onClick={() => setInvSort("date")}>{t("sortLatestShort")}</button>
                <button style={S.chip(invSort === "amount")} onClick={() => setInvSort("amount")}>{t("sortAmount")} ↓</button>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {[["all", t("filterAll")],["invoice","INV"],["quotation","QUO"],["receipt","RTX"]].map(([k,lbl]) => (
                  <button key={k} style={S.chip(invDocType === k)} onClick={() => setInvDocType(k)}>{lbl}</button>
                ))}
              </div>

              {/* Production Houses — crew add/edit directly (billing address flows into the invoice "Bill to") */}
              <div style={S.card}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <p style={{ ...S.sectionTitle, margin: 0 }}>{t("prodHousesTitle")}</p>
                  <button style={S.btn("ghost", "md")} onClick={() => { setShowAdminReqModal("production-house"); setAdminReqForm({ name: "", address: "" }); setAdminReqMsg(null); }}>{t("addProdHouse")}</button>
                </div>
                {(() => {
                  const companies = [...(productionCompanies || [])].filter(c => (c.name || "").trim()).sort((a, b) => (a.name || "").localeCompare(b.name || "", ["th", "en"], { sensitivity: "base" }));
                  // Requests submitted before crew could add directly — still waiting on an admin
                  const legacyPending = (adminRequests || []).filter(r => r.employeeId === employee.id && r.type === "production-house" && r.status === "pending");
                  if (companies.length === 0 && legacyPending.length === 0) return <p style={{ fontSize: 12, color: "var(--text-muted,#7B8FA3)", marginTop: 8 }}>{t("prodHouseEmpty")}</p>;
                  return (
                    <div style={{ marginTop: 10, display: "flex", flexDirection: "column" }}>
                      {companies.map((co, i) => (
                        <div key={co.id} onClick={() => { setShowAdminReqModal("production-house"); setAdminReqForm({ id: co.id, name: co.name || "", address: co.address || "", taxId: co.taxId || "", branch: co.branch || "" }); setAdminReqMsg(null); }}
                          style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: (i < companies.length - 1 || legacyPending.length > 0) ? "1px solid var(--divider-color,#D8E1EC)" : "none", cursor: "pointer" }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{co.name}</p>
                            {(co.address || "").trim()
                              ? <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-muted,#5F7A91)", whiteSpace: "pre-wrap" }}>{co.address}</p>
                              : <p style={{ margin: "2px 0 0", fontSize: 11, color: "#B7791F", fontStyle: "italic" }}>{t("noBillingAddress")}</p>}
                          </div>
                          <Icon d={icons.edit} size={14} color="var(--text-muted,#5F7A91)" />
                        </div>
                      ))}
                      {legacyPending.map(req => (
                        <div key={req.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0" }}>
                          <span style={S.badge("amber")}>{statusLabel(t, req.status)}</span>
                          <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{req.name}</p>
                        </div>
                      ))}
                      <p style={{ margin: "8px 0 0", fontSize: 11, color: "var(--text-muted,#7B8FA3)" }}>{t("prodHouseHint")}</p>
                    </div>
                  );
                })()}
              </div>

              {/* Confirmed jobs to invoice */}
              <div style={S.card} data-testid="invoice-jobs-card">
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <p style={{ ...S.sectionTitle, margin: 0 }}>{invShowAllJobs ? t("confirmJobs") : t("crewMyJobsToInvoice")}</p>
                  {otherConfirmed.length > 0 && (
                    <button data-testid="invoice-show-all" style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 12, color: "var(--accent,#2563EB)", fontWeight: 600, padding: 0 }} onClick={() => setInvShowAllJobs(v => !v)}>
                      {invShowAllJobs ? t("crewShowMyJobsOnly") : t("crewShowAllJobs").replace("{n}", otherConfirmed.length)}
                    </button>
                  )}
                </div>
                {confirmedJobs.length === 0
                  ? <p style={{ fontSize: 13, color: "var(--text-muted,#5F7A91)", margin: "8px 0 0" }}>{t("crewNoJobsToInvoice")} {t("crewNoJobsUseNew")}</p>
                  : confirmedJobs.map(job => {
                    // Documents of mine already raised against this job, regardless of the list filter (P2-4).
                    // The count is information, NOT a gate: one job is billed per day or per week as
                    // several documents, so the button stays (crew ask 2026-09-23).
                    const jobDocs = allMyInvoices.filter(inv => inv.jobId === job.id).length;
                    return (
                      <div key={job.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "10px 0", borderBottom: "1px solid var(--divider-color,#D8E1EC)" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{job.name}{isOtherJob(job) && <span style={{ ...S.badge("gray"), marginLeft: 6 }}>{t("crewOtherJobBadge")}</span>}</p>
                          <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-muted,#5F7A91)" }}>{job.production} · {(job.dates || []).slice(0, 2).map(d => formatDay(d)).join(", ")}</p>
                          {jobDocs > 0 && <p style={{ margin: "3px 0 0", fontSize: 11, color: "var(--text-muted,#5F7A91)" }}><span style={{ ...S.badge("green"), fontSize: 9, marginRight: 5 }}>✓ {t("invoicedBadge")}</span>{tCount(t, "countDocs", jobDocs)}</p>}
                        </div>
                        <button style={{ ...S.btn(jobDocs > 0 ? "ghost" : "primary", "md"), flexShrink: 0 }} onClick={() => setInvoiceModal({ job, existing: null })}>
                          <Icon d={jobDocs > 0 ? icons.plus : icons.invoice} size={14} /> {jobDocs > 0 ? t("crewAnotherDoc") : t("createInvoice")}
                        </button>
                      </div>
                    );
                  })
                }
              </div>

              {/* My saved invoices */}
              {myInvoices.length === 0 ? (
                <div style={{ ...S.card, textAlign: "center", padding: 32 }}>
                  <p style={{ color: "var(--text-muted,#5F7A91)", fontSize: 13 }}>{invFilter === "all" ? t("noInvoicesYet") : t("noInvoicesFilter").replace("{status}", invFilter === "Paid" ? t("stPaid") : t("invPending"))}</p>
                </div>
              ) : (
                <div style={S.col}>
                  {myInvoices.map(inv => {
                    const total = calcTotal(inv);
                    const isPaid = (inv.status || "Pending") === "Paid";
                    const isVoid = inv.status === "Void";
                    const isExpanded = expandedInv === inv.id;
                    const itemList = printableItems(inv);
                    const isInv = inv.docType === "invoice" || !inv.docType;
                    const shareSt = shareInfo[inv.id];
                    const shareActive = inv.share?.key && !(shareSt?.expired) && (!inv.share.expiresAt || Date.now() < inv.share.expiresAt);
                    return (
                      <div key={inv.id} style={{ ...S.card, border: isPaid ? "1px solid rgba(47,133,90,0.25)" : "var(--card-border,1px solid #D8E1EC)", opacity: isVoid ? 0.7 : 1 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }} onClick={() => { setExpandedInv(isExpanded ? null : inv.id); if (!isExpanded && inv.share?.key) refreshShare(inv); }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 3, flexWrap: "wrap" }}>
                              <span style={{ ...S.badge("blue"), fontSize: 9 }}>{{ quotation: "QUO", receipt: "RTX" }[inv.docType] || "INV"}</span>
                              <span style={{ ...S.badge(isVoid ? "red" : isPaid ? "green" : "amber"), fontSize: 10 }}>{isVoid ? t("receiptVoided") : ({ Paid: t("stPaid"), Pending: inv.docType === "quotation" ? t("quoPending") : t("invPending"), Confirmed: t("stConfirmed"), Declined: t("stDeclined") }[inv.status || "Pending"] || inv.status)}</span>
                              <p style={{ margin: 0, fontSize: 11, color: "var(--text-muted,#5F7A91)", fontFamily: "monospace" }}>{fmtInvoiceNo(inv)}</p>
                            </div>
                            <p style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{inv.jobName}</p>
                            {(inv.position || inv.productionCompany) && <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--text-muted,#5F7A91)" }}>{[inv.position, inv.productionCompany].filter(Boolean).join(" · ")}</p>}
                          </div>
                          <div style={{ textAlign: "right", flexShrink: 0 }}>
                            <p style={{ margin: 0, fontWeight: 800, fontSize: 16, color: "var(--accent,#2563EB)" }}>฿{total.toLocaleString()}</p>
                            <p style={{ margin: "3px 0 0", fontSize: 11, color: "var(--text-muted,#5F7A91)" }}>{formatDate(new Date(inv.updatedAt))}</p>
                          </div>
                          <Icon d={icons.chevron_right} size={14} strokeW={2} style={{ transform: isExpanded ? "rotate(90deg)" : "none", transition: "transform 0.2s", opacity: 0.4, marginLeft: 8 }} />
                        </div>
                        {isExpanded && (
                          <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--divider-color,#D8E1EC)" }}>
                            {/* Line items */}
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 40px 80px 80px", gap: "4px 8px", marginBottom: 10 }}>
                              {[t("colDescription"), t("colQty"), t("colRate"), t("colTotal")].map((h, i) => (
                                <div key={i} style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--text-muted,#5F7A91)", textAlign: i > 0 ? "right" : "left", paddingBottom: 4, borderBottom: "1px solid var(--divider-color,#D8E1EC)" }}>{h}</div>
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
                            <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10, paddingTop: 8, borderTop: "1px solid var(--divider-color,#D8E1EC)", marginBottom: 14 }}>
                              <span style={{ fontSize: 12, color: "var(--text-muted,#5F7A91)" }}>{t("colTotal")}</span>
                              <span style={{ fontSize: 18, fontWeight: 800, color: "var(--accent,#2563EB)" }}>฿{total.toLocaleString()}</span>
                            </div>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              {!isVoid && <button style={S.btn("ghost", "md")} onClick={() => setInvoiceModal({ job: null, existing: inv })}>
                                <Icon d={icons.edit} size={14} /> {t("editBtn")}
                              </button>}
                              <button style={S.btn("ghost", "md")} onClick={() => printInvoice({ invoice: inv, employee, profileInfo, promptPayQR, idCard, signature, productionCompanies, companyName, print: false })}>
                                <Icon d={icons.eye} size={14} /> {t("viewBtn")}
                              </button>
                              <button style={S.btn("primary", "md")} onClick={() => printInvoice({ invoice: inv, employee, profileInfo, promptPayQR, idCard, signature, productionCompanies, companyName })}>
                                <Icon d={icons.print} size={14} /> {t("printBtn")}
                              </button>
                              {lineGroupId && !isVoid && (
                                <button
                                  disabled={invSending === inv.id}
                                  style={{ ...S.btn("ghost", "md"), opacity: invSending === inv.id ? 0.6 : 1 }}
                                  onClick={() => shareDoc(inv)}>
                                  <Icon d={icons.chat} size={14} /> {invSending === inv.id ? t("shareSending") : t("shareBtn")}
                                </button>
                              )}
                              {isInv && !isPaid && (
                                <button style={S.btn("ghost", "md")} onClick={() => setPaidDialog({ mode: "paid", inv })}><Icon d={icons.check} size={14} /> {t("markPaid")}</button>
                              )}
                              {isInv && isPaid && (<>
                                {!liveReceiptFor(inv) && <button style={S.btn("success", "md")} onClick={() => issueReceipt(inv)}><Icon d={icons.receipt} size={14} /> {t("issueReceipt")}</button>}
                                <button style={S.btn("ghost", "md")} onClick={() => setPaidDialog({ mode: "unpaid", inv })}>{t("markPending")}</button>
                              </>)}
                              {!isVoid && <button style={{ ...S.btn("danger", "md"), minWidth: 36 }} aria-label={t("deleteBtn")} title={t("deleteBtn")} onClick={() => delInvoice(inv.id)}>
                                <Icon d={icons.trash} size={14} />
                              </button>}
                            </div>
                            {inv.share?.key && (
                              <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 11, color: "var(--text-muted,#5F7A91)" }}>
                                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Icon d={icons.link} size={12} /> {shareActive
                                  ? t("shareLinkActive").replace("{date}", formatDateTime(shareSt?.expiresAt || inv.share.expiresAt))
                                  : t("shareExpired")}</span>
                                {shareSt && !shareSt.expired && <span>· {t("shareViews").replace("{n}", shareSt.views || 0)}</span>}
                                <button style={{ ...S.btn("ghost"), fontSize: 11, padding: "3px 8px" }} onClick={() => revokeShare(inv)}>{t("shareRevoke")}</button>
                              </div>
                            )}
                            {isVoid && inv.voidReason && <p style={{ margin: "8px 0 0", fontSize: 11, color: "#C53030" }}>{t("receiptVoided")}: {inv.voidReason}</p>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {paidDialog && (
                <PaidDialog mode={paidDialog.mode} invoice={paidDialog.inv} onClose={() => setPaidDialog(null)}
                  onConfirm={(change) => { setInvoices(p => applyPaidChange(p, paidDialog.inv, change)); setPaidDialog(null); toast(paidDialog.mode === "paid" ? `${fmtInvoiceNo(paidDialog.inv)} · ${t("markPaid")}` : `${fmtInvoiceNo(paidDialog.inv)} · ${t("markPending")}`); }} />
              )}

              {invoiceModal && (
                <InvoiceCreateModal
                  job={invoiceModal.job}
                  existingInvoice={invoiceModal.existing}
                  employee={{ ...employee, invoicePrefix: profileInfo.invoicePrefix }}
                  invoicePrefix={profileInfo.invoicePrefix}
                  positions={positions}
                  onSave={saveInvoice}
                  onClose={() => setInvoiceModal(null)}
                  allInvoices={invoices}
                  companyName={companyName}
                  invoicePresets={invoicePresets}
                  productionCompanies={productionCompanies}
                  jobs={jobs}
                  adminRequests={adminRequests}
                  profileInfo={profileInfo}
                  hasIdCard={!!idCard}
                  hasSignature={!!signature}
                  hasBank={hasBankInfo}
                />
              )}
            </div>
          );
        })()}
      </div>

      {/* Employee Bottom Nav */}
      <nav style={{
        position: "fixed", bottom: 0, left: 0, right: 0, height: 62,
        background: "var(--topbar-bg,#FFFFFF)", borderTop: "1px solid var(--divider-color,#D8E1EC)",
        display: "flex", alignItems: "stretch", zIndex: 100,
        padding: "0 4px", paddingBottom: "env(safe-area-inset-bottom,0px)",
      }}>
        {[
          { key: "today", label: t("tabToday"), icon: icons.calendar },
          { key: "invoice", label: t("tabInvoice"), icon: icons.invoice },
          { key: "gear", label: t("tabGear"), icon: icons.camera },
          { key: "profile", label: t("tabProfile"), icon: icons.user },
        ].map(tItem => {
          const active = tab === tItem.key;
          return (
            <button key={tItem.key} onClick={() => setTab(tItem.key)} style={{
              flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              gap: 3, border: "none", cursor: "pointer", background: "transparent",
              color: active ? "var(--accent,#2563EB)" : "var(--text-muted,#5F7A91)", position: "relative", padding: "8px 2px 6px",
            }}>
              {active && <div style={{ position: "absolute", top: 0, left: "25%", right: "25%", height: 2, background: "var(--accent,#2563EB)", borderRadius: "0 0 3px 3px" }} />}
              <Icon d={tItem.icon} size={20} color={active ? "var(--accent,#2563EB)" : "var(--text-muted,#5F7A91)"} />
              <span style={{ fontSize: 11, fontWeight: active ? 700 : 500, letterSpacing: "0.02em", lineHeight: 1.1 }}>{tItem.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

// ─── REPORT MODAL (employee submits a damage report) ─────────────────────────
export function ReportModal({ employee, equipment, jobs, checkouts, onSubmit, onClose }) {
  const t = useT();
  const [photos, setPhotos] = useState([]);
  const [description, setDescription] = useState("");
  const [qty, setQty] = useState(1);        // P2-2: units taken out of service
  const [jobId, setJobId] = useState("");   // P2-2: link to the job it happened on
  // Jobs this crew member touched recently first, then every other live job.
  const jobChoices = (() => {
    const mine = new Set((checkouts || []).filter(c => c.employeeId === employee.id && c.jobId).map(c => c.jobId));
    const live = (jobs || []).filter(j => j.status !== "Declined");
    return [...live.filter(j => mine.has(j.id)), ...live.filter(j => !mine.has(j.id))]
      .sort((a, b) => (mine.has(b.id) ? 1 : 0) - (mine.has(a.id) ? 1 : 0) || ((b.dates || [])[0] || "").localeCompare((a.dates || [])[0] || ""))
      .slice(0, 40);
  })();
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
    const job = (jobs || []).find(j => j.id === jobId);
    onSubmit({
      id: "rep" + Date.now(),
      eqId: eqId === "" || eqId === "other" ? null : eqId,
      eqName: eqId === "other" ? customEqName.trim() : (eq?.name || ""),
      qty: eq ? Math.min(Math.max(1, +qty || 1), +eq.total || 1) : 1,
      jobId: job ? job.id : null,
      jobName: job ? job.name : "",
      production: job ? (job.production || "") : "",
      description: description.trim(),
      photos,
      ts: new Date(incidentTs).getTime() || Date.now(),
      reportedBy: { id: employee.id, name: employee.name },
      employeeId: employee.id,
      status: "open",
      resolvedAt: null,
      cost: null, vendor: "",
    });
    setSubmitted(true);
  };

  if (submitted) return (
    <Modal title={t("reportNew")} onClose={onClose}>
      <div style={{ textAlign: "center", padding: "24px 0" }}>
        <div style={{ marginBottom: 12, display: "flex", justifyContent: "center" }}><Icon d={icons.check} size={48} color="#2F855A" strokeW={2.4} /></div>
        <p style={{ fontSize: 16, fontWeight: 700, color: "#2F855A", marginBottom: 8 }}>{t("reportSubmitted")}</p>
        <button style={{ ...S.btn("primary"), marginTop: 16 }} onClick={onClose}>{t("back")}</button>
      </div>
    </Modal>
  );

  return (
    <Modal title={t("reportNew")} onClose={onClose} dirty={!!description.trim() || photos.length > 0}>
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
          {(() => {
            const eq = equipment.find(e => e.id === eqId);
            if (!eq) return null;
            return (
              <div style={{ marginTop: 8 }}>
                {(+eq.total || 1) > 1 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <label style={{ ...S.label, marginBottom: 0 }}>{t("reportQty")}</label>
                    <input type="number" min={1} max={eq.total} style={{ ...S.input, width: 80 }} value={qty} onChange={e => setQty(e.target.value)} />
                    <span style={{ fontSize: 11, color: "var(--text-muted,#5F7A91)" }}>/ {eq.total}</span>
                  </div>
                )}
                <p style={{ margin: "6px 0 0", fontSize: 11, color: "#C53030" }}>⚠ {t("reportOutOfService")}</p>
              </div>
            );
          })()}
        </div>

        <div>
          <label style={S.label}>{t("reportJob")}</label>
          <select style={S.select} value={jobId} onChange={e => setJobId(e.target.value)}>
            <option value="">{t("reportNoJob")}</option>
            {jobChoices.map(j => <option key={j.id} value={j.id}>{j.name}{j.production ? ` · ${j.production}` : ""}{(j.dates || [])[0] ? ` · ${formatDate(j.dates[0])}` : ""}</option>)}
          </select>
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
                <img src={p} alt="" style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 8, display: "block", border: "2px solid var(--accent,#2563EB)" }} />
                <button onClick={() => setPhotos(ps => ps.filter((_, j) => j !== i))} style={{ position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: "50%", background: "#C53030", border: "2px solid var(--surface,#FFFFFF)", color: "#fff", fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1, padding: 0 }}>×</button>
              </div>
            ))}
            <button style={{ ...S.btn("ghost"), flexDirection: "column", gap: 3, width: 72, height: 72, borderRadius: 8, border: "2px dashed var(--border-color,#D8E1EC)", fontSize: 10, fontWeight: 600 }} onClick={() => camRef.current.click()}>
              <Icon d={icons.camera} size={20} color="var(--text-muted,#7B8FA3)" />{t("reportCamera")}
            </button>
            <button style={{ ...S.btn("ghost"), flexDirection: "column", gap: 3, width: 72, height: 72, borderRadius: 8, border: "2px dashed var(--border-color,#D8E1EC)", fontSize: 10, fontWeight: 600 }} onClick={() => galRef.current.click()}>
              <Icon d={icons.photo} size={20} color="var(--text-muted,#7B8FA3)" />{t("reportGallery")}
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
