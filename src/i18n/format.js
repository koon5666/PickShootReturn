// Locale-aware date/plural helpers (P1-6 / P3-1). Pure ESM so node tests can run
// them. The app sets the language once (setFormatLang) and every formatDate call
// site follows without threading `lang` through 9,000 lines of JSX.
let FORMAT_LANG = "en";
export const setFormatLang = (lang) => { FORMAT_LANG = lang === "th" ? "th" : "en"; };
export const getFormatLang = () => FORMAT_LANG;
export const localeOf = (lang = FORMAT_LANG) => (lang === "th" ? "th-TH" : "en-GB");

// "2026-09-16" -> "16 Sept 2026" / "16 ก.ย. 2569". Falls back to the input on garbage.
export function formatDate(d, { lang = FORMAT_LANG, year = true } = {}) {
  if (!d) return "";
  const dt = d instanceof Date ? d : new Date(typeof d === "string" && d.length === 10 ? d + "T00:00:00" : d);
  if (Number.isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString(localeOf(lang), { day: "2-digit", month: "short", ...(year ? { year: "numeric" } : {}) });
}
// Short day+month only: "16 Sept" / "16 ก.ย."
export const formatDay = (d, opts = {}) => formatDate(d, { ...opts, year: false });

// Timestamp -> "16 Sept, 14:05" / "16 ก.ย. 14:05"
export function formatDateTime(ts, { lang = FORMAT_LANG, hour12 = false } = {}) {
  if (ts == null || ts === "") return "";
  const dt = new Date(ts);
  if (Number.isNaN(dt.getTime())) return String(ts);
  return dt.toLocaleString(localeOf(lang), { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12 });
}

// Long day heading: "Wednesday, 16 September" / "วันพุธที่ 16 กันยายน"
export function formatLongDay(dt = new Date(), { lang = FORMAT_LANG } = {}) {
  return new Date(dt).toLocaleDateString(localeOf(lang), { weekday: "long", day: "2-digit", month: "long" });
}

// Count phrases without hard-coded English plurals: keys `<key>` (many) and
// `<key>One` (exactly one) both contain "{n}". Thai tracks set both to the same
// text since Thai has no plural. Falls back to the many form.
export function tCount(t, key, n) {
  const num = Number(n) || 0;
  const one = t(`${key}One`);
  const tpl = (num === 1 && one !== `${key}One`) ? one : t(key);
  return String(tpl).replace("{n}", num);
}

// Stored English enum values -> translated labels (SHOOT_TIMES / LOCATIONS keep
// their English values in KV; only the display changes).
const SHOOT_TIME_KEYS = { "Day": "shootTimeDay", "Night": "shootTimeNight", "Half Day / Half Night": "shootTimeHalfDN", "Half Night / Half Day": "shootTimeHalfND" };
const LOCATION_KEYS = { "Local (Bangkok)": "locLocal", "Out of Town": "locOutOfTown", "Overseas": "locOverseas" };
export const shootTimeLabel = (t, v) => (SHOOT_TIME_KEYS[v] ? t(SHOOT_TIME_KEYS[v]) : (v || ""));
export const locationLabel = (t, v) => (LOCATION_KEYS[v] ? t(LOCATION_KEYS[v]) : (v || ""));

// Request / approval statuses as stored ("pending", "approved", "denied", "rejected", "withdrawn").
const STATUS_KEYS = { pending: "stPending", approved: "stApproved", denied: "stDenied", rejected: "stRejected", withdrawn: "stWithdrawn", open: "reportStatusOpen", solved: "reportStatusSolved", discarded: "reportStatusDiscarded" };
export const statusLabel = (t, s) => { const k = STATUS_KEYS[String(s || "").toLowerCase()]; return k ? t(k) : String(s || ""); };
