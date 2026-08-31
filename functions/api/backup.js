// Manual server-side snapshot backup (admin "Create Backup"). Same per-field
// storage as backup_auto so the whole dataset (photos + profiles) is captured
// without exceeding the 25 MiB per-key KV limit. GET reassembles into one JSON.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const FIELDS = [
  "equipment", "jobs", "checkouts", "employees", "reports", "productionCompanies",
  "invoices", "companyName", "equipmentRequests", "adminRequests", "adminPin",
  "lineGroupId", "timezone", "timeFormat", "kpiConfig", "punishments", "kpiEvents",
  "photoVerification", "navOrder", "verificationConfig", "invoicePresets", "chatEnabled",
];
const PREFIX = "bak_man";
const LEGACY = "backup_manual";

async function snapshot(env) {
  const raws = await Promise.all(FIELDS.map(k => env.KV.get(k)));
  const ops = [];
  FIELDS.forEach((k, i) => ops.push(env.KV.put(`${PREFIX}:f:${k}`, raws[i] ?? "null")));
  const list = await env.KV.list({ prefix: "profile_" });
  const profRaws = await Promise.all(list.keys.map(x => env.KV.get(x.name)));
  const profiles = {};
  list.keys.forEach((x, i) => { try { profiles[x.name] = profRaws[i] ? JSON.parse(profRaws[i]) : null; } catch { profiles[x.name] = null; } });
  ops.push(env.KV.put(`${PREFIX}:profiles`, JSON.stringify(profiles)));
  const savedAt = Date.now();
  ops.push(env.KV.put(`${PREFIX}:meta`, JSON.stringify({ savedAt, fields: FIELDS, profileKeys: list.keys.map(k => k.name) })));
  await Promise.all(ops);
  return savedAt;
}

async function reassemble(env) {
  const meta = await env.KV.get(`${PREFIX}:meta`, "json");
  if (!meta) return null;
  const raws = await Promise.all(meta.fields.map(k => env.KV.get(`${PREFIX}:f:${k}`)));
  const out = { savedAt: meta.savedAt };
  meta.fields.forEach((k, i) => { try { out[k] = raws[i] ? JSON.parse(raws[i]) : null; } catch { out[k] = null; } });
  out._profiles = (await env.KV.get(`${PREFIX}:profiles`, "json")) || {};
  return out;
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet({ env }) {
  const snap = await reassemble(env);
  if (snap) return Response.json(snap, { headers: CORS });
  const legacy = await env.KV.get(LEGACY); // pre-redesign single-blob backup
  if (legacy) return new Response(legacy, { headers: { ...CORS, "Content-Type": "application/json" } });
  return new Response(null, { status: 404, headers: CORS });
}

export async function onRequestPut({ env }) {
  try {
    const savedAt = await snapshot(env);
    return Response.json({ ok: true, savedAt }, { headers: CORS });
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 500, headers: CORS });
  }
}
