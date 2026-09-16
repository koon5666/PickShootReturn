import { stripPhoto, mergePhotoArray, mergeById, mergeInvoices, withoutTombstones } from "../_lib/merge.js";
import { FIELDS, readAllFields, readField, inlineField, prepareWrite, commitWrites } from "../_lib/store.js";
import { PHOTO_FIELDS } from "../_lib/photos.js";
import { isStale, VERSIONED } from "../_lib/versions.js";
import { requireSession, stripCredentials } from "../_lib/auth.js";
import { protectEmployees, protectRequests, adoptPlainAdminPin } from "../_lib/accounts.js";
import { forbiddenFields, restrictOwn, mergeOwnedWhole, ownInvoices, OWNER_KEY, SERVER_OWNED_FIELDS, COMPANY_FILLABLE } from "../_lib/roles.js";

// Same-origin API: no Access-Control-Allow-* headers on purpose (P0-2).
const CORS = {};

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
//
// ── Auth (P0-2) ──────────────────────────────────────────────────────────────
// Every request needs the session cookie (functions/_lib/auth.js). GET never
// returns a credential (adminPin / adminPinHash / employees[].pin|pinHash /
// staff[].pinHash / member-register requestedPin*). PUT: an admin may write any
// client field; an employee only checkouts / equipmentRequests / adminRequests /
// invoices / reports / productionCompanies and inside them only their own records
// (functions/_lib/roles.js). Employee credentials come from KV on every admin
// employees write (a plaintext `pin` from an old client or the seed script is
// hashed on the spot); `adminPin` sent by an admin becomes the hashed owner PIN.
// Server-owned fields (adminPinHash, staff, calendarToken, auditLog) are never
// written through PUT.

function leanAdminRequests(arr) {
  return Array.isArray(arr)
    ? arr.map(r => (r && r.status !== "pending") ? stripPhoto(r) : r)
    : arr;
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const auth = await requireSession(context);
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const full = url.searchParams.get("full") === "1" && auth.session.role === "admin"; // escape hatch: full payload w/ photos (admin)
  const { values, versions } = await readAllFields(env.KV);
  const out = stripCredentials(values);
  if (auth.session.role !== "admin") {
    delete out.auditLog; // actor log is for the house only
    // A share link's revoke token is a secret of the invoice's owner: a crew
    // session only sees the tokens of its own documents.
    if (Array.isArray(out.invoices)) out.invoices = out.invoices.map(i => (i && i.share && i.share.token && i.employeeId !== auth.session.id) ? { ...i, share: { ...i.share, token: undefined } } : i);
  }
  delete versions.adminPin; delete versions.adminPinHash;
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

export async function onRequestPut(context) {
  const { request, env } = context;
  const auth = await requireSession(context);
  if (!auth.ok) return auth.response;
  const session = auth.session;
  const isAdmin = session.role === "admin";
  let body;
  try { body = await request.json(); } catch { return Response.json({ ok: false, error: "invalid JSON body" }, { status: 400, headers: CORS }); }
  if (!body || typeof body !== "object") return Response.json({ ok: false, error: "invalid JSON body" }, { status: 400, headers: CORS });
  const denied = forbiddenFields(body, session, FIELDS);
  if (denied.length) return Response.json({ ok: false, error: "forbidden", fields: denied }, { status: 403, headers: CORS });
  const sentV = body && typeof body._v === "object" ? body._v : null;
  // Owner PIN sent in the clear by an old client / the seed script: hash it now.
  if (isAdmin && body.adminPin !== undefined && body.adminPin !== null) {
    if (!(await adoptPlainAdminPin(env.KV, body.adminPin))) return Response.json({ ok: false, error: "adminPin must be 4-6 digits" }, { status: 400, headers: CORS });
  }

  // Phase 1: compute every value to store (no writes yet), collecting stale
  // conflicts and oversize values so a PUT is all-or-nothing.
  const prepared = [];
  const deletes = [];
  const conflicts = [];
  const currentV = {};
  const metaByField = {};
  for (const k of FIELDS) {
    if (body[k] === undefined) continue;               // field not sent → leave untouched
    if (k === "adminPin" || SERVER_OWNED_FIELDS.has(k)) continue; // handled above / never via PUT
    if (k === "lineGroupId" && body[k] === null) { deletes.push("lineGroupId"); continue; }

    let value = body[k];
    const merged = (k === "invoices" || PHOTO_ARRAYS.has(k) || MERGE_ARRAYS.has(k)) && Array.isArray(value);
    // Whole-value fields a crew session may write only inside its own records:
    // productionCompanies (P2-9) and reports (a damage report belongs to the crew
    // who filed it; a stale or hostile crew copy can neither rewrite nor drop
    // another crew's report). Both merges are stale-safe, so a crew PUT of these
    // is not version-checked (an admin write is).
    const ownedWhole = !isAdmin && (k === "productionCompanies" || k === "reports") && Array.isArray(value);
    const needExisting = merged || ownedWhole || k === "employees" || PHOTO_FIELDS[k] || (VERSIONED.has(k) && sentV && (k in sentV));
    const cur = needExisting ? await readField(env.KV, k) : null;
    const existing = cur && Array.isArray(cur.value) ? cur.value : [];
    if (merged) {
      if (k === "invoices") {
        // Employee sessions: ownership is the SESSION, never a client-declared id.
        const owner = isAdmin ? "admin" : session.id;
        if (!isAdmin) value = ownInvoices(value, existing, owner);
        value = mergeInvoices(value, existing, owner, { restoredAt: cur.meta.restoredAt || 0 });
      } else {
        if (!isAdmin) value = restrictOwn(value, existing, session.id, OWNER_KEY[k]);
        if (k === "adminRequests") value = protectRequests(value, existing); // requested PIN hash comes from KV, never the client
        if (PHOTO_ARRAYS.has(k)) value = mergePhotoArray(value, existing, { clearedAt: cur.meta.clearedAt || 0, restoredAt: cur.meta.restoredAt || 0 });
        else value = mergeById(value, existing, { restoredAt: cur.meta.restoredAt || 0 });
      }
    } else if (ownedWhole) {
      // Crew never deletes a report (the UI only appends / the house resolves), so
      // every KV report survives; a crew may drop only a production house it added.
      value = k === "reports"
        ? mergeById(restrictOwn(value, existing, session.id, OWNER_KEY[k]), existing)
        : mergeOwnedWhole(value, existing, session.id, OWNER_KEY[k], { fillable: COMPANY_FILLABLE }); // crew may fill an EMPTY address / tax id / branch on a house-registered company
    } else if (k === "employees" && Array.isArray(value)) {
      value = await protectEmployees(value, existing);
      if (VERSIONED.has(k) && sentV && (k in sentV)) { currentV[k] = cur.v; if (isStale(k, sentV, cur.v)) conflicts.push(k); }
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
