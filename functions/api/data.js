const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Every top-level field the app reads/writes. Each is stored under its own KV key.
// Keep this in sync with the app's load effect + savePayload.
const FIELDS = [
  "equipment", "jobs", "checkouts", "employees", "reports", "productionCompanies",
  "invoices", "companyName", "equipmentRequests", "adminRequests", "adminPin",
  "lineGroupId", "timezone", "timeFormat", "kpiConfig", "punishments", "kpiEvents",
  "photoVerification", "navOrder", "verificationConfig", "invoicePresets", "chatEnabled",
];

// ── Lean boot ────────────────────────────────────────────────────────────────
// The verification photos on checkouts + resolved admin requests are the bulk of
// the payload (tens of MB) but are only ever viewed on demand (equipment History
// modal; the Approvals "resolved/all" tab). GET returns them stripped to `null`
// with a `hasPhoto` flag; the base64 stays in KV and is fetched lazily via
// /api/photo?field=..&id=... . Pending admin-request photos are kept inline
// because the default Approvals view renders them immediately.
const isDataUri = (s) => typeof s === "string" && s.startsWith("data:");
function stripPhoto(entry) {
  if (entry && isDataUri(entry.photo)) {
    const { photo, ...rest } = entry;
    return { ...rest, photo: null, hasPhoto: true };
  }
  return entry;
}
function leanCheckouts(arr) {
  return Array.isArray(arr) ? arr.map(stripPhoto) : arr;
}
function leanAdminRequests(arr) {
  return Array.isArray(arr)
    ? arr.map(r => (r && r.status !== "pending") ? stripPhoto(r) : r)
    : arr;
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet({ env, request }) {
  const url = new URL(request.url);
  const full = url.searchParams.get("full") === "1"; // escape hatch: full payload w/ photos
  const vals = await Promise.all(FIELDS.map(k => env.KV.get(k, "json")));
  const out = {};
  FIELDS.forEach((k, i) => { out[k] = vals[i]; });
  if (!full) {
    out.checkouts = leanCheckouts(out.checkouts);
    out.adminRequests = leanAdminRequests(out.adminRequests);
  }
  return Response.json(out, { headers: CORS });
}

// Arrays where per-entry base64 photos live and must never be clobbered by a
// client that loaded the lean (photo-stripped) payload and then re-saves.
const PHOTO_ARRAYS = new Set(["checkouts", "adminRequests"]);
// Other arrays where concurrent sessions may append entries independently.
// On PUT: incoming entries win for shared IDs, KV-only IDs are preserved.
const MERGE_ARRAYS = new Set(["equipmentRequests"]);

// Merge an incoming photo-bearing array against KV, preserving each entry's
// photo when the incoming copy is absent/stripped (loaded lean). A real data:
// URI in the incoming entry always wins (new capture / re-shot photo).
function mergePhotoArray(incoming, existing) {
  const exMap = new Map((existing || []).map(e => [e.id, e]));
  const incomingIds = new Set(incoming.map(e => e.id));
  const merged = incoming.map(inc => {
    const kv = exMap.get(inc.id);
    const photo = isDataUri(inc.photo) ? inc.photo : ((kv && kv.photo) ?? inc.photo ?? null);
    const { hasPhoto, ...rest } = inc; // never persist the transient lean marker
    return { ...rest, photo };
  });
  // keep KV-only entries (added by another session, not in this payload)
  for (const e of (existing || [])) if (!incomingIds.has(e.id)) merged.push(e);
  return merged;
}

export async function onRequestPut({ request, env }) {
  const body = await request.json();
  const ops = [];
  for (const k of FIELDS) {
    if (body[k] === undefined) continue;               // field not sent → leave untouched
    if (k === "lineGroupId" && body[k] === null) { ops.push(env.KV.delete("lineGroupId")); continue; }

    if (k === "invoices" && Array.isArray(body[k])) {
      const existing = (await env.KV.get("invoices", "json")) || [];
      const existingMap = new Map(existing.map(e => [e.id, e]));
      // Preserve write-once fields (set by one device, must not be wiped by a
      // stale session on another device that loaded before the field was set).
      const mergeInv = (inc) => {
        const kv = existingMap.get(inc.id);
        if (!kv) return inc;
        return {
          ...inc,
          paidDate: inc.paidDate || kv.paidDate || null,
          whTaxDoc: inc.whTaxDoc || kv.whTaxDoc || null,
        };
      };
      const employeeId = body._invoiceEmployeeId; // set by non-admin sessions
      if (employeeId && employeeId !== "admin") {
        // Employee session: only owns its own invoices. Preserve every other employee's
        // invoices (including admin's soft-deletes) exactly as they are in KV.
        const incomingIds = new Set(body.invoices.map(e => e.id));
        const otherKv = existing.filter(e => e.employeeId !== employeeId);
        const myKvOnly = existing.filter(e => e.employeeId === employeeId && !incomingIds.has(e.id));
        ops.push(env.KV.put("invoices", JSON.stringify([...body.invoices.map(mergeInv), ...otherKv, ...myKvOnly])));
      } else {
        // Admin session: append-only merge across all invoices.
        const incomingIds = new Set(body.invoices.map(e => e.id));
        ops.push(env.KV.put("invoices", JSON.stringify([...body.invoices.map(mergeInv), ...existing.filter(e => !incomingIds.has(e.id))])));
      }
      continue;
    }

    if (PHOTO_ARRAYS.has(k) && Array.isArray(body[k])) {
      const existing = (await env.KV.get(k, "json")) || [];
      ops.push(env.KV.put(k, JSON.stringify(mergePhotoArray(body[k], existing))));
      continue;
    }

    if (MERGE_ARRAYS.has(k) && Array.isArray(body[k])) {
      // Read-merge-write: keep KV entries whose IDs aren't in the incoming set so that
      // a session with stale state doesn't silently erase another session's additions.
      const existing = (await env.KV.get(k, "json")) || [];
      const incomingIds = new Set(body[k].map(e => e.id));
      const merged = [...body[k], ...existing.filter(e => !incomingIds.has(e.id))];
      ops.push(env.KV.put(k, JSON.stringify(merged)));
      continue;
    }

    ops.push(env.KV.put(k, JSON.stringify(body[k])));
  }
  await Promise.all(ops);
  return Response.json({ ok: true }, { headers: CORS });
}
