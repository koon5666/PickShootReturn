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
  "photoVerification", "navOrder", "verificationConfig", "invoicePresets",
];

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet({ env }) {
  const vals = await Promise.all(FIELDS.map(k => env.KV.get(k, "json")));
  const out = {};
  FIELDS.forEach((k, i) => { out[k] = vals[i]; });
  return Response.json(out, { headers: CORS });
}

// Arrays where concurrent sessions may append entries independently.
// On PUT: incoming entries win for shared IDs, KV-only IDs are preserved.
// invoices uses soft-delete (_deleted:true) instead of array removal, so deleted
// records stay in the incoming payload and propagate to KV naturally — no special
// delete-tracking needed. checkouts/adminRequests/equipmentRequests are append-only.
const MERGE_ARRAYS = new Set(["checkouts", "adminRequests", "equipmentRequests"]);

export async function onRequestPut({ request, env }) {
  const body = await request.json();
  const ops = [];
  for (const k of FIELDS) {
    if (body[k] === undefined) continue;               // field not sent → leave untouched
    if (k === "lineGroupId" && body[k] === null) { ops.push(env.KV.delete("lineGroupId")); continue; }

    if (k === "invoices" && Array.isArray(body[k])) {
      const existing = (await env.KV.get("invoices", "json")) || [];
      const employeeId = body._invoiceEmployeeId; // set by non-admin sessions
      if (employeeId && employeeId !== "admin") {
        // Employee session: only owns its own invoices. Preserve every other employee's
        // invoices (including admin's soft-deletes) exactly as they are in KV.
        const incomingIds = new Set(body.invoices.map(e => e.id));
        const otherKv = existing.filter(e => e.employeeId !== employeeId);
        const myKvOnly = existing.filter(e => e.employeeId === employeeId && !incomingIds.has(e.id));
        ops.push(env.KV.put("invoices", JSON.stringify([...body.invoices, ...otherKv, ...myKvOnly])));
      } else {
        // Admin session: append-only merge across all invoices.
        const incomingIds = new Set(body.invoices.map(e => e.id));
        ops.push(env.KV.put("invoices", JSON.stringify([...body.invoices, ...existing.filter(e => !incomingIds.has(e.id))])));
      }
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
