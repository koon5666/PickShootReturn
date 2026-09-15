#!/usr/bin/env node
// Proof of the photo migration (P0-1) on the PROD COPY: a local KV loaded with the
// raw inline dataset (tests/prod-copy-kv.mjs), never the real KV.
//
//   node tests/prod-copy-kv.mjs ./.wrangler-prod
//   node tests/local-server.mjs <PORT> ./.wrangler-prod --no-build
//   node tests/migrate-proof.mjs <PORT>
//
// Prints before/after sizes, runs POST /api/migrate-photos in batches (same call
// the Settings > Photo storage button makes), then checks: record counts
// identical, every photo byte-identical at its original position (duplicate ids
// included), /api/photo by id, lean GET markers, and a backup + restore round trip.
const port = parseInt(process.argv[2], 10);
if (!(port > 0)) { console.error("usage: node tests/migrate-proof.mjs <PORT>"); process.exit(2); }
const B = `http://127.0.0.1:${port}`;
const isD = s => typeof s === "string" && s.startsWith("data:");
const src = JSON.parse((await import("node:fs")).readFileSync(process.env.HOME + "/psr-backups/2026-09-16_pre-theme/data-full.json", "utf8"));
// Auth (P0-2): the endpoints need an owner session; the prod copy's legacy
// plaintext adminPin logs in once and is upgraded to a hash on the way.
const { apiClient } = await import("./apiclient.mjs");
const owner = await apiClient(B).loginAdmin(String(src.adminPin));
const j = (r) => r.json();
const get = (p) => owner.get(p);
const post = (p, b) => owner.post(p, b).then(r => r.json());
const expect = {}; // photoKey -> data from the source of truth
for (const f of ["checkouts", "adminRequests", "equipment"]) for (const e of src[f] || []) if (e && isD(e.photo)) expect[`${f}:${e.id}`] = e.photo;
for (const e of src.reports || []) if (e && Array.isArray(e.photos)) e.photos.forEach((p, i) => { if (isD(p)) expect[`reports:${e.id}:${i}`] = p; });
console.log("source of truth:", Object.keys(expect).length, "photos");

const t0 = Date.now();
let st = await get("/api/migrate-photos");
console.log("BEFORE:", JSON.stringify(Object.fromEntries(Object.entries(st.fields).map(([k, v]) => [k, { records: v.records, inline: v.inline, MiB: +(v.bytes / 1048576).toFixed(2) }]))));
// lean GET works even before migration (strips inline)
let d = await get("/api/data");
const leanBytes = JSON.stringify(d).length;
console.log("lean GET before:", (leanBytes / 1048576).toFixed(2), "MiB, checkouts", d.checkouts.length, "adminRequests", d.adminRequests.length);
// /api/photo fallback before migration
const sampleId = src.checkouts.find(c => isD(c.photo)).id;
let ph = await get(`/api/photo?field=checkouts&ids=${sampleId}`);
console.log("photo fallback before migration:", ph.photos[sampleId] === expect["checkouts:" + sampleId] ? "OK" : "MISMATCH");

// run the migration in batches (same call the Settings button makes)
let calls = 0, moved = 0;
for (;;) {
  const r = await post("/api/migrate-photos", { limit: 20 });
  calls++;
  if (!r.ok) { console.log("FAILED:", r); process.exit(1); }
  moved += r.moved;
  console.log(`  batch ${calls}: moved ${r.moved}, remaining ${r.remaining}`, r.results.map(x => `${x.field}:${x.moved}`).join(" "));
  if (!r.remaining) break;
  if (!r.moved) { console.log("stuck"); process.exit(1); }
}
console.log(`migration: ${moved} photos in ${calls} calls, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
// idempotent re-run
const again = await post("/api/migrate-photos", { limit: 20 });
console.log("re-run moved:", again.moved, "remaining:", again.remaining);

st = await get("/api/migrate-photos");
console.log("AFTER:", JSON.stringify(Object.fromEntries(Object.entries(st.fields).map(([k, v]) => [k, { records: v.records, inline: v.inline, MiB: +(v.bytes / 1048576).toFixed(3) }]))));

// verify: every record present, every photo retrievable byte-identical
d = await get("/api/data");
let lost = 0;
for (const f of ["checkouts", "adminRequests", "equipment", "reports", "jobs", "employees", "invoices", "productionCompanies", "equipmentRequests"]) {
  const a = (src[f] || []).length, b = (d[f] || []).length;
  if (a !== b) { lost++; console.log(`RECORD COUNT MISMATCH ${f}: ${a} -> ${b}`); }
}
console.log("record counts identical:", lost === 0 ? "YES" : "NO");
const full = await get("/api/data?full=1");
// position-by-position against the source (duplicate ids included): every photo byte-identical
const verify = (data) => { let ok = 0, total = 0, bad = [];
  for (const f of ["checkouts", "adminRequests", "equipment"]) (src[f] || []).forEach((e, i) => { if (isD(e.photo)) { total++; if (data[f][i] && data[f][i].id === e.id && data[f][i].photo === e.photo) ok++; else bad.push(`${f}[${i}]`); } });
  (src.reports || []).forEach((e, i) => (e.photos || []).forEach((p, k) => { if (isD(p)) { total++; if (data.reports[i]?.photos?.[k] === p) ok++; else bad.push(`reports[${i}][${k}]`); } }));
  return { ok, total, bad }; };
let v = verify(full);
console.log(`photos byte-identical at the same position (?full=1): ${v.ok}/${v.total}`, v.bad.length ? "BAD: " + v.bad.join(",") : "");
// /api/photo by id (the client's lazy path) for every unique checkout/adminRequest id
let okId = 0, totId = 0;
for (const f of ["checkouts", "adminRequests"]) {
  const ids = [...new Set(src[f].filter(e => isD(e.photo)).map(e => e.id))];
  for (let i = 0; i < ids.length; i += 25) {
    const chunk = ids.slice(i, i + 25);
    const r = await get(`/api/photo?field=${f}&ids=${chunk.map(encodeURIComponent).join(",")}`);
    for (const id of chunk) { totId++; if (isD(r.photos[id]) && src[f].some(e => e.id === id && e.photo === r.photos[id])) okId++; }
  }
}
console.log(`/api/photo by id serves a valid photo for every id: ${okId}/${totId}`);
// full=1 also inlines checkouts
console.log("?full=1 checkouts with photo:", full.checkouts.filter(c => isD(c.photo)).length, "adminRequests:", full.adminRequests.filter(c => isD(c.photo)).length);
// lean payload for the boot
d = await get("/api/data");
console.log("lean GET after:", (JSON.stringify(d).length / 1048576).toFixed(2), "MiB; hasPhoto markers on checkouts:", d.checkouts.filter(c => c.hasPhoto).length, "; pending adminRequests inline:", d.adminRequests.filter(r => r.status === "pending" && isD(r.photo)).length, "; equipment inline:", d.equipment.filter(e => isD(e.photo)).length, "; report photos inline:", d.reports.reduce((n, r) => n + (r.photos || []).filter(isD).length, 0));
// backup of the migrated dataset, then restore it (round trip)
const bk = await owner.put("/api/backup", {}).then(j);
console.log("backup:", bk.id, "photos", bk.backup.photoCount, "counts", JSON.stringify(bk.backup.counts));
const rs = await post("/api/backup", { id: bk.id });
console.log("restore:", rs.ok, "safety", rs.safetyId, "orphans", rs.orphanPhotosRemoved);
const after = await get("/api/data?full=1");
v = verify(after);
console.log(`after backup+restore round trip, photos byte-identical at the same position: ${v.ok}/${v.total}`, v.bad.length ? "BAD: " + v.bad.join(",") : "");
// KV key count for the photo namespace
const st2 = await get("/api/migrate-photos");
console.log("final field sizes:", JSON.stringify(Object.fromEntries(Object.entries(st2.fields).map(([k, x]) => [k, +(x.bytes / 1024).toFixed(1) + " KiB"]))));
