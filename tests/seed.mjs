#!/usr/bin/env node
// Seed a LOCAL PickShootReturn server (see tests/local-server.mjs) with test data.
//
//   node tests/seed.mjs <PORT> [profile]
//     profile "default"   (omit)  Lucky Cam Rental scenario, admin PIN 9999,
//                                 crew Nong 1111 / Arthit 2222 / Ploy 3333
//     profile "prod-copy"         real data from ~/psr-backups/2026-09-16_pre-theme/data-full.json
//                                 (read-only source; lineGroupId is forced to null so no
//                                 local run can ever push to the real LINE group)
//
// PUT /api/data MERGES per field (checkouts/adminRequests/equipmentRequests/invoices keep
// KV-only ids), so seeding is additive: for a clean slate boot the server on a fresh
// --persist-to dir. Only ever talks to 127.0.0.1:<PORT>.
//
// Auth (P0-2): every /api route needs a session. The seed logs in as the owner
// first: on a FRESH state the owner PIN is the bootstrap default 1234 (nothing set
// yet); after the default seed it is 9999 (the plaintext `adminPin` the seed PUTs
// is hashed server-side). Crew PINs are seeded as plaintext `pin` and hashed by the
// server as well, so Nong 1111 / Arthit 2222 / Ploy 3333 keep working.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { apiClient } from "./apiclient.mjs";

const port = parseInt(process.argv[2], 10);
const profile = process.argv[3] || "default";
if (!(port > 0)) { console.error("usage: node tests/seed.mjs <PORT> [default|prod-copy]"); process.exit(2); }
const base = `http://127.0.0.1:${port}`;
const PROD_COPY = join(homedir(), "psr-backups", "2026-09-16_pre-theme", "data-full.json");

// Dates in the app's timezone (Asia/Bangkok), YYYY-MM-DD, offset in days from today.
const TZ = "Asia/Bangkok";
const day = (offset = 0) => {
  const d = new Date(Date.now() + offset * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
};
const at = (offsetDays, hh = 9) => { const d = new Date(day(offsetDays) + "T00:00:00+07:00"); d.setHours(d.getHours() + hh); return d.getTime(); };
const BKK = { lat: 13.7563, lng: 100.5018, acc: 12 };

export function buildDefaultSeed() {
  const E = { nong: "e_nong", arthit: "e_arthit", ploy: "e_ploy" };
  const employees = [
    { id: E.nong, name: "Nong", pin: "1111" },
    { id: E.arthit, name: "Arthit", pin: "2222" },
    { id: E.ploy, name: "Ploy", pin: "3333" },
  ];
  const equipment = [
    { id: "eq_fx6", name: "Sony FX6", category: "Camera", total: 2, notes: "Body only, 2 units", photo: null },
    { id: "eq_lens", name: "Sony 24-70 GM II", category: "Lens", total: 1, notes: "", photo: null },
    { id: "eq_vmount", name: "V-Mount 150Wh", category: "Power", total: 8, notes: "Charge after every job", photo: null },
    { id: "eq_rs3", name: "DJI RS3 Pro", category: "Grip", total: 1, notes: "", photo: null },
    { id: "eq_aputure", name: "Aputure 600d Pro", category: "Lighting", total: 3, notes: "V-mount plate", photo: null },
    { id: "eq_tripod", name: "Sachtler Flowtech 75", category: "Grip", total: 4, notes: "", photo: null },
  ];
  const productionCompanies = [
    { id: "co_bkkpics", name: "Bangkok Pictures Co., Ltd.", address: "99/1 Sukhumvit 55, Watthana\nBangkok 10110\nTax ID 0105551234567" },
    { id: "co_netflix", name: "Netflix Thailand", address: "1 Rama IV Rd, Bangkok 10500" },
    { id: "co_indie", name: "Indie House", address: "" },
  ];
  const job1 = { id: "job1", name: "TVC Toyota", production: "Bangkok Pictures Co., Ltd.", dates: [day(-2)], pickupDate: day(-3), status: "Confirmed",
    shootTime: "Day", location: "Local (Bangkok)", locationCity: "", contactPerson: "Khun Bee", contactPlatform: "LINE", dateOverrides: {},
    assignedEquipment: [{ eqId: "eq_fx6", qty: 1 }, { eqId: "eq_lens", qty: 1 }, { eqId: "eq_vmount", qty: 4 }], checkoutMode: "span", checkoutRoles: { barcode: "anyone", photo: "anyone" } };
  const job2 = { id: "job2", name: "Netflix Series Ep.3", production: "Netflix Thailand", dates: [day(0), day(1)], status: "Confirmed",
    shootTime: "Night", location: "Out of Town", locationCity: "Kanchanaburi", contactPerson: "P'Ann", contactPlatform: "Phone", dateOverrides: {},
    assignedEquipment: [{ eqId: "eq_fx6", qty: 1 }, { eqId: "eq_rs3", qty: 1 }, { eqId: "eq_aputure", qty: 2 }, { eqId: "eq_tripod", qty: 2 }], checkoutMode: "span", checkoutRoles: { barcode: "anyone", photo: "anyone" } };
  const job3 = { id: "job3", name: "Music Video Ploy Band", production: "Indie House", dates: [day(7), day(8)], status: "Pencil",
    shootTime: "Day", location: "Local (Bangkok)", locationCity: "", contactPerson: "", contactPlatform: "", dateOverrides: {}, assignedEquipment: [], checkoutMode: "span" };
  const pick = (eqId, qty, ts) => ({ id: "co" + ts + eqId, jobId: "job1", requestId: null, jobName: job1.name, eqId, qty, employeeId: E.nong, employeeName: "Nong", type: "pick", ts, photo: null, location: BKK });
  const checkouts = [
    pick("eq_fx6", 1, at(-3, 8)), pick("eq_lens", 1, at(-3, 8) + 1000), pick("eq_vmount", 4, at(-3, 8) + 2000),
    { id: "co" + at(-2, 20) + "eq_lens", jobId: "job1", requestId: null, jobName: job1.name, eqId: "eq_lens", qty: 1, employeeId: E.nong, employeeName: "Nong", type: "return", ts: at(-2, 20), photo: null, location: BKK },
  ];
  const invoices = [{
    id: "inv_seed1", invoiceNo: "INV-NG-26-0001", revisions: 0, employeeId: E.nong, employeeName: "Nong", jobId: "job1", jobName: job1.name,
    productionCompany: "Bangkok Pictures Co., Ltd.", shootDates: [day(-2)], position: "1st AC", status: "Pending", docType: "invoice",
    items: [{ id: "it1", description: "1st AC day rate", qty: 1, rate: 3500, vat: false, auto: "labor" }], callWrap: { [day(-2)]: { call: "06:00", wrap: "18:00" } },
    invoiceHeader: "Nong", showWatermark: false, vatEnabled: false, vatType: "exclusive", createdAt: at(-1, 10), updatedAt: at(-1, 10),
  }];
  const equipmentRequests = [{
    id: "req_seed1", employeeId: E.arthit, employeeName: "Arthit", items: [{ eqId: "eq_aputure", eqName: "Aputure 600d Pro", qty: 1 }],
    eqId: "eq_aputure", eqName: "Aputure 600d Pro", qty: 1, useDates: [day(3)], purpose: "practice", productionName: "", jobName: "", reason: "Lighting test at home", status: "pending", requestedAt: at(-1, 15),
  }];
  const adminRequests = [{
    id: "ar_seed1", type: "equipment", status: "pending", submittedAt: new Date(at(-1, 16)).toISOString(), employeeId: E.nong, employeeName: "Nong",
    name: "Tilta Nucleus-M", category: "Accessories", total: 1, notes: "Follow focus for the FX6 kit", photo: null,
  }];
  const reports = [{
    id: "rep_seed1", employeeId: E.nong, eqId: "eq_rs3", eqName: "DJI RS3 Pro", description: "Tilt motor makes a grinding noise when balancing.", photos: [], ts: at(-1, 18), status: "open", reportedBy: { id: E.nong, name: "Nong" },
  }];
  return {
    data: {
      companyName: "Lucky Cam Rental", adminPin: "9999", employees, equipment, productionCompanies, jobs: [job1, job2, job3], checkouts, invoices,
      equipmentRequests, adminRequests, reports, timezone: TZ, timeFormat: "24",
      kpiConfig: { startDate: day(-30), resetMonths: 12, maxPoints: 100 },
      punishments: [{ id: "pun1", label: "Late return", points: 5, description: "Gear back after the return day" }, { id: "pun2", label: "Missing photo", points: 2, description: "No verification photo" }],
      kpiEvents: [], photoVerification: true, verificationConfig: { mode: "photo" }, invoicePresets: [{ description: "Travel fee", rate: 500 }], chatEnabled: false,
    },
    profiles: {
      [E.nong]: { firstName: "Nong", lastName: "Srisuk", nickname: "Nong", phone: "081-111-1111", email: "nong@example.com", invoicePrefix: "NG", positions: [{ id: "pos_nong", name: "1st AC", dayRate: "3500", hoursPerDay: "12", variableOT: false, otMultiplier: "1.5", otTiers: [] }] },
      [E.arthit]: { firstName: "Arthit", lastName: "Kaew", nickname: "Arthit", phone: "082-222-2222", invoicePrefix: "AT", positions: [{ id: "pos_arthit", name: "Gaffer", dayRate: "4000", hoursPerDay: "12", variableOT: true, otMultiplier: "1.5", otTiers: [{ untilHour: 14, mult: 1.5 }, { untilHour: 16, mult: 2 }] }] },
      [E.ploy]: { firstName: "Ploy", lastName: "Chan", nickname: "Ploy", phone: "083-333-3333", invoicePrefix: "PL", positions: [{ id: "pos_ploy", name: "Producer", dayRate: "6000", hoursPerDay: "12", variableOT: false, otMultiplier: "1.5", otTiers: [] }] },
      admin: { firstName: "Somchai", lastName: "Owner", phone: "02-000-0000", invoicePrefix: "LCR", showCompanyName: true, positions: [{ id: "pos_admin", name: "Camera package", dayRate: "12000", hoursPerDay: "12", variableOT: false, otMultiplier: "1.5", otTiers: [] }] },
    },
  };
}

export function buildProdCopySeed() {
  const data = JSON.parse(readFileSync(PROD_COPY, "utf8"));
  data.lineGroupId = null; // never let a local run reach the real LINE group
  return { data, profiles: {} };
}

let client = null;
async function put(path, body) {
  const r = await client.put(path, body);
  if (!r.ok) throw new Error(`PUT ${path} -> ${r.status} ${await r.text().catch(() => "")}`);
  return r;
}

// Owner login for seeding: try the seed PIN (a re-seed), then the fresh-state
// default, then any PIN given as SEED_ADMIN_PIN.
async function loginOwner() {
  const pins = [...new Set([process.env.SEED_ADMIN_PIN, "9999", "1234"].filter(Boolean))];
  for (const pin of pins) {
    try { return await apiClient(base).loginAdmin(pin); } catch {}
  }
  throw new Error(`could not log in as owner with ${pins.join("/")}; pass SEED_ADMIN_PIN=<pin>`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const health = await fetch(base + "/api/public").catch(() => null);
  if (!health || health.status !== 200) { console.error(`no server at ${base} (GET /api/public ${health ? health.status : "unreachable"}); boot one with tests/local-server.mjs`); process.exit(1); }
  client = await loginOwner();
  const before = await client.get("/api/data");
  const nonEmpty = Object.keys(before).filter(k => before[k] !== null && before[k] !== undefined);
  if (nonEmpty.length) console.log(`note: KV already has ${nonEmpty.length} field(s) (${nonEmpty.slice(0, 5).join(", ")}…); PUT merges, use a fresh --persist-to dir for a clean slate`);

  const seed = profile === "prod-copy" ? buildProdCopySeed() : profile === "default" ? buildDefaultSeed() : null;
  if (!seed) { console.error("unknown profile " + profile); process.exit(2); }
  // One PUT per field: keeps each request small (prod-copy is ~40 MB) and shows progress.
  for (const [k, v] of Object.entries(seed.data)) {
    if (v === undefined) continue;
    await put("/api/data", { [k]: v });
    const size = JSON.stringify(v).length;
    console.log(`  ${k.padEnd(20)} ${Array.isArray(v) ? v.length + " rows" : typeof v}${size > 100_000 ? ` (${(size / 1048576).toFixed(1)} MB)` : ""}`);
  }
  for (const [id, prof] of Object.entries(seed.profiles)) { await put(`/api/profile/${id}`, prof); console.log(`  profile_${id}`); }
  // The seed changed the owner PIN (adminPin): log in again with it for the final read.
  client = await loginOwner();
  const after = await client.get("/api/data");
  console.log(`seeded profile "${profile}" on ${base}: ${(after.employees || []).length} employees, ${(after.equipment || []).length} gear, ${(after.jobs || []).length} jobs, ${(after.checkouts || []).length} checkouts, company "${after.companyName}"`);
}
