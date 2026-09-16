#!/usr/bin/env node
// API-level walk for the "one id, one record" hardening (security re-review of
// fix/review-2026-09) against a LOCAL seeded server (tests/local-server.mjs +
// tests/seed.mjs default profile). Reproduces the reviewer's attack as crew Nong
// (e_nong / 1111) and checks the legacy-collision path as the owner.
//
//   node tests/walk-dedupe.mjs <PORT>
//
//   1. 300 copies of another crew's report / pick event / a shared house in a
//      crew PUT -> KV keeps ONE record, as KV had it (no growth, no rewrite)
//   2. 300 copies of an own invoice / report -> one record
//   3. more than CREW_MAX_NEW_RECORDS new ids in one crew PUT -> 413, KV untouched
//   4. two REAL returns sharing an id (one per loan, same millisecond) -> both
//      survive, the second re-keyed "<id>#1", its photo reachable, a GET -> PUT
//      round trip leaves the ids alone (idempotent)
//   5. still-out / availability figures are the same before and after
// It adds a few records (Arthit's pick event, a re-keyed return), so run it on a
// state you can throw away.
import { apiClient } from "./apiclient.mjs";
import { jobCheckoutState } from "../src/logic/checkoutState.js";

const port = parseInt(process.argv[2], 10);
if (!(port > 0)) { console.error("usage: node tests/walk-dedupe.mjs <PORT>"); process.exit(2); }
const URL = `http://127.0.0.1:${port}`;
const fail = (m) => { console.error("\nDEDUPE WALK FAILED: " + m); process.exit(1); };
const step = (n) => console.log("- " + n);
const copies = (rec, n = 300) => Array.from({ length: n }, () => ({ ...rec }));
const ids = (arr) => (arr || []).map(e => e.id);
const uniq = (arr) => new Set(ids(arr)).size === (arr || []).length;

const owner = await apiClient(URL).loginAdmin("9999").catch(() => fail("owner login 9999 failed: seed first"));
const nong = await apiClient(URL).loginEmployee("e_nong", "1111").catch(() => fail("crew login failed: seed first"));
const arthit = await apiClient(URL).loginEmployee("e_arthit", "2222").catch(() => fail("crew login failed: seed first"));
const kv = () => owner.get("/api/data");
const putAs = async (who, body) => { const r = await who.put("/api/data", body); return { status: r.status, body: await r.json().catch(() => ({})) }; };

step("setup: Arthit files a report and picks a unit on job2 (foreign records for Nong)");
let d = await arthit.get("/api/data");
const repArthit = { id: "rep_arthit", employeeId: "e_arthit", eqId: "eq_tripod", eqName: "Sachtler Flowtech 75", description: "Leg lock slips.", photos: [], ts: Date.now() - 5000, status: "open", reportedBy: { id: "e_arthit", name: "Arthit" } };
const pickArthit = { id: "co_arthit_rs3", jobId: "job2", requestId: null, jobName: "Netflix Series Ep.3", eqId: "eq_rs3", qty: 1, employeeId: "e_arthit", employeeName: "Arthit", type: "pick", ts: Date.now() - 4000, photo: null, location: null };
let r = await putAs(arthit, { reports: [...d.reports, repArthit], checkouts: [...d.checkouts, pickArthit] });
if (r.status !== 200) fail("setup PUT " + r.status + " " + JSON.stringify(r.body));
const base = await kv();
const counts0 = { reports: base.reports.length, checkouts: base.checkouts.length, invoices: base.invoices.length, productionCompanies: base.productionCompanies.length };
const stillOut0 = JSON.stringify(Object.fromEntries(base.jobs.map(j => [j.id, jobCheckoutState(j, base.checkouts, {}).outUnits])));
console.log("  baseline", JSON.stringify(counts0), "outUnits", stillOut0);

step("1. crew Nong: 300 copies of Arthit's report / pick event / a shared house");
d = await nong.get("/api/data");
r = await putAs(nong, { reports: [...d.reports, ...copies({ ...repArthit, status: "discarded", description: "TAMPERED" })] });
if (r.status !== 200) fail("reports PUT " + r.status);
r = await putAs(nong, { checkouts: [...d.checkouts, ...copies({ ...pickArthit, qty: 4 })] });
if (r.status !== 200) fail("checkouts PUT " + r.status);
r = await putAs(nong, { productionCompanies: [...d.productionCompanies, ...copies({ ...d.productionCompanies[0], name: "RENAMED" })] });
if (r.status !== 200) fail("productionCompanies PUT " + r.status);
let now = await kv();
if (now.reports.length !== counts0.reports || !uniq(now.reports)) fail(`reports grew: ${counts0.reports} -> ${now.reports.length} ids=${ids(now.reports)}`);
if (now.reports.find(x => x.id === "rep_arthit").description !== repArthit.description) fail("Arthit's report was rewritten by Nong");
if (now.checkouts.length !== counts0.checkouts || !uniq(now.checkouts)) fail(`checkouts grew: ${counts0.checkouts} -> ${now.checkouts.length}`);
if (now.checkouts.find(x => x.id === "co_arthit_rs3").qty !== 1) fail("Arthit's pick event was rewritten");
if (now.productionCompanies.length !== counts0.productionCompanies || !uniq(now.productionCompanies)) fail(`productionCompanies grew: ${counts0.productionCompanies} -> ${now.productionCompanies.length}`);
if (now.productionCompanies[0].name === "RENAMED") fail("shared house renamed by crew");
const stillOut1 = JSON.stringify(Object.fromEntries(now.jobs.map(j => [j.id, jobCheckoutState(j, now.checkouts, {}).outUnits])));
if (stillOut1 !== stillOut0) fail(`still-out changed: ${stillOut0} -> ${stillOut1}`);
console.log("  ok  every field unchanged, still-out unchanged");

step("2. crew Nong: 300 copies of her own invoice and own report");
d = await nong.get("/api/data");
r = await putAs(nong, { invoices: copies({ ...d.invoices.find(i => i.id === "inv_seed1"), status: "Pending" }) });
if (r.status !== 200) fail("invoices PUT " + r.status + " " + JSON.stringify(r.body));
r = await putAs(nong, { reports: [...d.reports.filter(x => x.id !== "rep_seed1"), ...copies(d.reports.find(x => x.id === "rep_seed1"))] });
if (r.status !== 200) fail("own reports PUT " + r.status);
now = await kv();
if (now.invoices.length !== counts0.invoices || !uniq(now.invoices)) fail(`invoices grew: ${counts0.invoices} -> ${now.invoices.length}`);
if (now.reports.length !== counts0.reports || !uniq(now.reports)) fail(`reports grew: ${counts0.reports} -> ${now.reports.length}`);
console.log("  ok  invoices", now.invoices.length, "reports", now.reports.length);

step("3. crew Nong: more new ids than the cap in one PUT -> 413, nothing written");
d = await nong.get("/api/data");
const spam = Array.from({ length: 201 }, (_, i) => ({ id: "rep_spam" + i, employeeId: "e_nong", eqId: "eq_fx6", description: "spam " + i, photos: [], ts: Date.now(), status: "open" }));
r = await putAs(nong, { reports: [...d.reports, ...spam] });
if (r.status !== 413 || r.body.error !== "too many new records" || r.body.field !== "reports" || r.body.count !== 201) fail(`cap: ${r.status} ${JSON.stringify(r.body)}`);
// 300 DIFFERING copies of one own id are distinct records (re-keyed), so the cap catches them too
r = await putAs(nong, { reports: [...d.reports, ...Array.from({ length: 300 }, (_, i) => ({ ...d.reports.find(x => x.id === "rep_seed1"), description: "variant " + i }))] });
if (r.status !== 413) fail("300 differing own copies should hit the cap, got " + r.status);
now = await kv();
if (now.reports.length !== counts0.reports) fail("a refused PUT wrote something");
// under the cap a crew still adds her own records normally
r = await putAs(nong, { reports: [...d.reports, { id: "rep_ok", employeeId: "e_nong", eqId: "eq_fx6", description: "real report", photos: [], ts: Date.now(), status: "open" }] });
if (r.status !== 200) fail("a normal report add was refused: " + r.status);
now = await kv();
if (now.reports.length !== counts0.reports + 1) fail("normal add did not land");
console.log("  ok  413 { field: reports, count: 201, limit:", r.body.limit ?? 200, "}, normal add still works");

step("4. owner: two real returns share one id (one per loan) -> both kept, second re-keyed #1");
d = await kv();
const PHOTO = "data:image/jpeg;base64,/9j/dedupe-walk-photo";
const ts = Date.now();
const retA = { id: "co" + ts + "eq_fx6", jobId: "job1", requestId: null, jobName: "TVC Toyota", eqId: "eq_fx6", qty: 1, employeeId: "admin", employeeName: "Admin", type: "return", ts, photo: null, location: null, adminApproved: true };
const retB = { ...retA, jobId: null, requestId: "req_seed1", jobName: "", photo: PHOTO, location: { lat: 13.7, lng: 100.5, acc: 9 } };
r = await putAs(owner, { checkouts: [...d.checkouts, retA, retB] });
if (r.status !== 200) fail("collision PUT " + r.status + " " + JSON.stringify(r.body));
now = await kv();
const twinA = now.checkouts.find(x => x.id === retA.id), twinB = now.checkouts.find(x => x.id === retA.id + "#1");
if (!twinA || !twinB) fail("a colliding return was lost: " + JSON.stringify(ids(now.checkouts).filter(x => x.startsWith("co" + ts))));
if (twinA.requestId !== null || twinB.requestId !== "req_seed1") fail("twins carry the wrong loan");
if (!uniq(now.checkouts)) fail("GET still shows a duplicate id");
const ph = await owner.get(`/api/photo?field=checkouts&ids=${encodeURIComponent(retA.id + "#1")}`);
if (ph.photos[retA.id + "#1"] !== PHOTO) fail("re-keyed twin's photo not reachable: " + JSON.stringify(Object.keys(ph.photos)));
// GET -> PUT round trip (what a client does) leaves both ids alone
r = await putAs(owner, { checkouts: now.checkouts });
if (r.status !== 200) fail("round-trip PUT " + r.status);
const again = await kv();
if (JSON.stringify(ids(again.checkouts).sort()) !== JSON.stringify(ids(now.checkouts).sort())) fail("round trip changed the ids");
const full = await owner.get("/api/data?full=1");
if (full.checkouts.find(x => x.id === retA.id + "#1").photo !== PHOTO) fail("full GET lost the twin's photo");
console.log("  ok ", retA.id, "and", retA.id + "#1", "both in KV, photo served, ids stable across a round trip");

step("5. crew sees the same unique ids and the same still-out as the owner");
const cd = await nong.get("/api/data");
if (!uniq(cd.checkouts) || !uniq(cd.reports) || !uniq(cd.invoices)) fail("crew GET shows a duplicate id");
const soOwner = JSON.stringify(Object.fromEntries(again.jobs.map(j => [j.id, jobCheckoutState(j, again.checkouts, {}).outUnits])));
const soCrew = JSON.stringify(Object.fromEntries(cd.jobs.map(j => [j.id, jobCheckoutState(j, cd.checkouts, {}).outUnits])));
if (soOwner !== soCrew) fail("owner and crew disagree on still-out");
console.log("  ok  outUnits", soOwner);

step("6. browser: the owner dashboard after the twins exist (real Chrome, no console errors)");
{
  const PUPPETEER = process.env.PUPPETEER_CORE
    || "/private/tmp/claude-501/-Users-koonya-inta/bd16a78f-33be-43a8-91b5-db242cf9f6df/scratchpad/puptest/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
  const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const { default: puppeteer } = await import(PUPPETEER);
  const { mkdirSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname, resolve } = await import("node:path");
  const SHOTS = resolve(dirname(fileURLToPath(import.meta.url)), ".dedupe-shots") + "/"; // (URL above is the server base)
  mkdirSync(SHOTS, { recursive: true });
  const ALLOW = [/ws:\/\/[^']*\/api\/(session|chat)/i, /\/api\/profile\/[^ ]* .*404/i, /Failed to load resource: the server responded with a status of (404|503)/i];
  const errors = [];
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    page.on("pageerror", e => errors.push("pageerror: " + e.message));
    page.on("console", m => { if (m.type() === "error" && !ALLOW.some(re => re.test(m.text()))) errors.push("console: " + m.text()); if (m.type() === "warning" && /same key|duplicate key/i.test(m.text())) errors.push("react: " + m.text()); });
    await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch {} });
    await page.goto(URL, { waitUntil: "networkidle0", timeout: 60_000 });
    const text = () => page.evaluate(() => document.body.innerText);
    const wait = async (t, ms = 15_000) => { try { await page.waitForFunction(x => document.body.innerText.toLowerCase().includes(x), { timeout: ms }, t.toLowerCase()); } catch { await page.screenshot({ path: SHOTS + "fail.png" }); fail(`"${t}" never appeared`); } };
    const click = async (txt, tag = "button", exact = true) => {
      const pos = await page.evaluate((txt, tag, exact) => { const norm = s => s.replace(/\s+/g, " ").trim().toLowerCase(); const el = [...document.querySelectorAll(tag)].find(e => exact ? norm(e.textContent) === norm(txt) : norm(e.textContent).includes(norm(txt))); if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, txt, tag, exact);
      if (!pos) { await page.screenshot({ path: SHOTS + "fail.png" }); fail(`no <${tag}> "${txt}"`); }
      await page.mouse.click(pos[0], pos[1]);
    };
    await wait("Crew / ทีมงาน");
    await click("Rental house admin", "button", false); await wait("Enter PIN");
    for (const d of "9999") await click(d);
    await click("Unlock", "button", false);
    await wait("Overview");
    await new Promise(r => setTimeout(r, 800));
    const body = await text();
    // Not returned = the 4 batteries on job1 (FX6 came back through twin A, counted
    // once) + Arthit's RS3 on job2 from the setup -> "5 units · 2 items", no FX6 row
    const card = (body.match(/NOT RETURNED([\s\S]*?)GEAR REQUESTS/i) || ["", ""])[1];
    if (!/5 units\s*·\s*2 items/i.test(card) || /Sony FX6/i.test(card)) { await page.screenshot({ path: SHOTS + "fail.png" }); fail("dashboard Not returned should read 5 units · 2 items without an FX6 row, got: " + card.replace(/\s+/g, " ").slice(0, 200)); }
    await page.screenshot({ path: SHOTS + "01-dashboard.png" });
    for (const [nav, expect] of [["Equipment", "Equipment Library"], ["Checkout", "Active Jobs"], ["Insights", "Utilisation"]]) { await click(nav); await wait(expect, 10_000); await new Promise(r => setTimeout(r, 300)); }
    await page.screenshot({ path: SHOTS + "02-insights.png" });
    if (errors.length) fail("browser errors: " + errors.join(" | "));
    console.log("  ok  Not returned = 5 units · 2 items and no FX6 row, Equipment / Checkout / Insights render, no console errors (shots in " + SHOTS + ")");
  } finally { await browser.close(); }
}

console.log("\nDEDUPE WALK PASSED");
