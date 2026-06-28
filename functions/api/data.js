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

export async function onRequestPut({ request, env }) {
  const body = await request.json();
  const ops = [];
  for (const k of FIELDS) {
    if (body[k] === undefined) continue;               // field not sent → leave untouched
    if (k === "lineGroupId" && body[k] === null) { ops.push(env.KV.delete("lineGroupId")); continue; }
    ops.push(env.KV.put(k, JSON.stringify(body[k])));
  }
  await Promise.all(ops);
  return Response.json({ ok: true }, { headers: CORS });
}
