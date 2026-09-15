// Per-item checkout history helpers (P3-5): date-range filter + paging + CSV.
// Pure except downloadText (a tiny DOM helper kept here so App.jsx stays lean).
import { isPickEvt, isReturnEvt } from "./availability.js";

// Events for one equipment item, newest first, optionally limited to [from..to]
// (YYYY-MM-DD, inclusive, in the given IANA timezone). Returns { rows, total }
// where rows is the first `limit` (0 = all) of the filtered list.
export function filterHistory(checkouts, eqId, { from, to, limit = 20, tz } = {}) {
  const dayOf = (ts) => {
    try { return new Intl.DateTimeFormat("en-CA", { timeZone: tz || undefined }).format(new Date(ts)); }
    catch { return new Date(ts).toISOString().slice(0, 10); }
  };
  const all = (checkouts || []).filter(c => c && c.eqId === eqId).sort((a, b) => (b.ts || 0) - (a.ts || 0));
  const filtered = all.filter(c => {
    if (!from && !to) return true;
    const d = dayOf(c.ts || 0);
    return (!from || d >= from) && (!to || d <= to);
  });
  return { rows: limit > 0 ? filtered.slice(0, limit) : filtered, total: filtered.length, all: all.length };
}

const csvCell = (v) => { const s = v === null || v === undefined ? "" : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

// CSV of history rows: Date,Time,Type,Job,Employee,Qty,GPS
export function historyCsv(rows, { eqName = "", tz } = {}) {
  const fmt = (ts) => {
    const d = new Date(ts || 0);
    try {
      return [new Intl.DateTimeFormat("en-CA", { timeZone: tz || undefined }).format(d), new Intl.DateTimeFormat("en-GB", { timeZone: tz || undefined, hour: "2-digit", minute: "2-digit" }).format(d)];
    } catch { return [d.toISOString().slice(0, 10), d.toISOString().slice(11, 16)]; }
  };
  const head = ["Date", "Time", "Type", "Equipment", "Job", "Employee", "Qty", "GPS"];
  const lines = [head.join(",")];
  for (const c of rows || []) {
    const [date, time] = fmt(c.ts);
    const type = isPickEvt(c.type) ? "Pick" : isReturnEvt(c.type) ? "Return" : (c.type || "");
    const gps = c.location && c.location.lat != null ? `${c.location.lat},${c.location.lng}` : "";
    lines.push([date, time, type, eqName, c.jobName || "", c.employeeName || "", c.qty ?? 1, gps].map(csvCell).join(","));
  }
  return lines.join("\n");
}

export function downloadText(filename, text, mime = "text/csv;charset=utf-8") {
  if (typeof document === "undefined") return;
  const blob = new Blob(["﻿" + text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
