import { stripPhoto, mergePhotoArray, mergeById, mergeInvoices, withoutTombstones } from "../_lib/merge.js";
import { FIELDS, readAllFields, readField, inlineField, prepareWrite, commitWrites } from "../_lib/store.js";
import { PHOTO_FIELDS } from "../_lib/photos.js";
import { isStale, VERSIONED } from "../_lib/versions.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// FIELDS (every top-level field, one KV key each) lives in functions/_lib/store.js.
// Keep it in sync with the app's DATA_FIELDS (src/App.jsx); the backup module
// imports the same list.

// ── Storage shape (P0-1) ─────────────────────────────────────────────────────
// Base64 photos are NOT stored inline any more: on PUT every `data:` URI in
// checkouts / adminRequests / equipment / reports moves to its own key
// (photo:<field>:<id>) and the array keeps { photo: null, hasPhoto: true }
// (functions/_lib/photos.js). This keeps every field value far below KV's 25 MiB
// cap (prod checkouts had reached 20.8 MiB). GET re-inlines the photos the client
// renders immediately (equipment, reports, pending admin requests) and keeps
// checkouts + resolved admin requests lean; those are fetched lazily through
// /api/photo. POST /api/migrate-photos moves the existing inline photos out.
//
// ── Versions (P1-13) ─────────────────────────────────────────────────────────
// Every field value carries a version in its KV metadata. GET returns
// `_v: { field: version }`; a PUT may send back the `_v` it loaded and gets a
// 409 { conflicts: [...], _v } when one of the whole-value fields was written by
// someone else in between (functions/_lib/versions.js). Id-merged arrays are not
// version-checked (their merge is already safe from a stale session).
//
// ── Tombstones (P0-5) ────────────────────────────────────────────────────────
// Records with `_deleted: true` are honoured by every merge (deletion sticks even
// if a stale device re-saves the live copy) and stripped from the GET payload
// for checkouts / adminRequests / equipmentRequests. Invoices keep them (the UI
// filters `_deleted` itself). POST /api/tombstone writes one.

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
  const { values, versions } = await readAllFields(env.KV);
  const out = { ...values };
  for (const f of ["checkouts", "adminRequests", "equipmentRequests"]) out[f] = withoutTombstones(out[f]);
  // Re-inline photos the client renders immediately.
  const [equipment, reports, adminRequests] = await Promise.all([
    inlineField(env.KV, "equipment", out.equipment),
    inlineField(env.KV, "reports", out.reports),
    inlineField(env.KV, "adminRequests", out.adminRequests, full ? undefined : (r => r && r.status === "pending")),
  ]);
  out.equipment = equipment;
  out.reports = reports;
  out.adminRequests = adminRequests;
  if (full) {
    out.checkouts = await inlineField(env.KV, "checkouts", out.checkouts);
  } else {
    out.checkouts = Array.isArray(out.checkouts) ? out.checkouts.map(stripPhoto) : out.checkouts;
    out.adminRequests = leanAdminRequests(out.adminRequests);
  }
  out._v = versions;
  return Response.json(out, { headers: CORS });
}

// Arrays where per-entry base64 photos live and must never be clobbered by a
// client that loaded the lean (photo-stripped) payload and then re-saves.
const PHOTO_ARRAYS = new Set(["checkouts", "adminRequests"]);
// Other arrays where concurrent sessions may append entries independently.
// On PUT: incoming entries win for shared IDs, KV-only IDs are preserved.
const MERGE_ARRAYS = new Set(["equipmentRequests"]);

export async function onRequestPut({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return Response.json({ ok: false, error: "invalid JSON body" }, { status: 400, headers: CORS }); }
  const sentV = body && typeof body._v === "object" ? body._v : null;

  // Phase 1: compute every value to store (no writes yet), collecting stale
  // conflicts and oversize values so a PUT is all-or-nothing.
  const prepared = [];
  const deletes = [];
  const conflicts = [];
  const currentV = {};
  const metaByField = {};
  for (const k of FIELDS) {
    if (body[k] === undefined) continue;               // field not sent → leave untouched
    if (k === "lineGroupId" && body[k] === null) { deletes.push("lineGroupId"); continue; }

    let value = body[k];
    const merged = (k === "invoices" || PHOTO_ARRAYS.has(k) || MERGE_ARRAYS.has(k)) && Array.isArray(value);
    const needExisting = merged || PHOTO_FIELDS[k] || (VERSIONED.has(k) && sentV && (k in sentV));
    const cur = needExisting ? await readField(env.KV, k) : null;
    const existing = cur && Array.isArray(cur.value) ? cur.value : [];
    if (merged) {
      if (k === "invoices") value = mergeInvoices(value, existing, body._invoiceEmployeeId);
      else if (PHOTO_ARRAYS.has(k)) value = mergePhotoArray(value, existing, { clearedAt: cur.meta.clearedAt || 0 });
      else value = mergeById(value, existing);
    } else if (VERSIONED.has(k) && sentV && (k in sentV)) {
      currentV[k] = cur.v;
      if (isStale(k, sentV, cur.v)) conflicts.push(k);
    }
    if (cur) metaByField[k] = cur.meta;
    prepared.push(prepareWrite(k, value, PHOTO_FIELDS[k] ? existing : undefined));
  }

  if (conflicts.length) {
    return Response.json({ ok: false, error: "stale", conflicts, _v: currentV }, { status: 409, headers: CORS });
  }
  const tooBig = prepared.find(p => p.size);
  if (tooBig) {
    return Response.json({ ok: false, error: tooBig.size.error, field: tooBig.field, bytes: tooBig.size.bytes, limit: tooBig.size.limit }, { status: 413, headers: CORS });
  }

  // Phase 2: write photo keys, then values (fresh versions), then deletes.
  const written = await commitWrites(env.KV, prepared, metaByField);
  await Promise.all(deletes.map(k => env.KV.delete(k)));
  return Response.json({ ok: true, _v: written }, { headers: CORS });
}
