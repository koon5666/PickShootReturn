#!/usr/bin/env node
// End-to-end walk-through of the checkout flows (track checkout-flows) against a
// LOCAL seeded server (tests/local-server.mjs + tests/seed.mjs default profile).
//
//   node tests/checkout-flows.mjs <PORT>
//
// Covers: one-tap camera (P2-14), photo preview Use/Retake + undo pick (P1-4),
// partial return qty/condition/note + Missing n (P1-1), daily-mode night shoot
// return path (P1-2), geo-gated return reason + Retry at shop + waiting card +
// approval outcome (P1-5), admin Checkout active jobs / Receive / Mark lost /
// title + dates (P0-4, P3-7). Screenshots in tests/.checkout-shots/ (gitignored).
// Adds its own fixtures to the seeded KV (a daily-mode night job); run on a fresh
// state dir for a clean slate.
import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { apiClient } from "./apiclient.mjs";

const PUPPETEER = process.env.PUPPETEER_CORE
  || "/private/tmp/claude-501/-Users-koonya-inta/bd16a78f-33be-43a8-91b5-db242cf9f6df/scratchpad/puptest/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const { default: puppeteer } = await import(PUPPETEER);

const port = parseInt(process.argv[2], 10);
if (!(port > 0)) { console.error("usage: node tests/checkout-flows.mjs <PORT>"); process.exit(2); }
const URL = `http://127.0.0.1:${port}`;
const SHOTS = resolve(dirname(fileURLToPath(import.meta.url)), ".checkout-shots");
mkdirSync(SHOTS, { recursive: true });
const PHOTO = `${SHOTS}/_fixture-photo.png`;

const ALLOW = [
  /WebSocket connection to 'ws:\/\/[^']*\/api\/(session|chat)/i,
  /\/api\/profile\/[^ ]* .*404/i,
  /Failed to load resource: the server responded with a status of (404|503)/i,
];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const fail = (msg) => { console.error("\nCHECKOUT E2E FAILED: " + msg); process.exitCode = 1; throw new Error(msg); };
let shotN = 0;
const errors = [];
const SHOP = { latitude: 13.7563, longitude: 100.5018, accuracy: 12 }; // seed BKK pick location
const FAR = { latitude: 13.9, longitude: 100.5018, accuracy: 8 };      // ~16 km north

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox"] });
await browser.defaultBrowserContext().overridePermissions(URL, ["geolocation"]);
let page;

async function newPage(viewport) {
  if (page) { try { await page.evaluate(() => fetch("/api/logout", { method: "POST" })); } catch {} await page.close(); } // one cookie jar per browser (P0-2)
  page = await browser.newPage();
  await page.setViewport(viewport);
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error") errors.push("console: " + m.text()); });
  page.on("response", r => { if (r.status() >= 400 && !/\/api\/session|\/api\/profile\//.test(r.url())) errors.push(`http ${r.status()} ${r.url()}`); });
  await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch {} });
  await page.setGeolocation(SHOP);
  await page.goto(URL, { waitUntil: "networkidle0", timeout: 60_000 });
}
const shot = async (name) => { const p = `${SHOTS}/${String(++shotN).padStart(2, "0")}-${name}.png`; await page.screenshot({ path: p, fullPage: true }); return p; };
const bodyText = () => page.evaluate(() => document.body.innerText);
const hasText = async (txt) => (await bodyText()).toLowerCase().includes(txt.toLowerCase());
async function waitText(txt, ms = 15_000) {
  try { await page.waitForFunction(t => document.body.innerText.toLowerCase().includes(t), { timeout: ms }, txt.toLowerCase()); }
  catch { await shot("fail"); fail(`text "${txt}" never appeared (see ${SHOTS})`); }
}
async function expectText(txt, why) { if (!(await hasText(txt))) { await shot("fail"); fail(`${why || "expected text"}: "${txt}" not on screen`); } }
async function expectNoText(txt, why) { if (await hasText(txt)) { await shot("fail"); fail(`${why || "unexpected text"}: "${txt}" is on screen`); } }
// Real mouse click on the first <tag> whose text matches, optionally scoped to a container [data-testid].
async function clickText(txt, tag = "button", exact = true, within = null) {
  const pos = await page.evaluate((txt, tag, exact, within) => {
    const norm = s => s.replace(/\s+/g, " ").trim().toLowerCase();
    const want = norm(txt);
    const root = within ? document.querySelector(`[data-testid="${within}"]`) : document;
    if (!root) return "noroot";
    const el = [...root.querySelectorAll(tag)].find(e => exact ? norm(e.textContent) === want : norm(e.textContent).includes(want));
    if (!el) return null;
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    return [r.x + r.width / 2, r.y + r.height / 2];
  }, txt, tag, exact, within);
  if (pos === "noroot") { await shot("fail"); fail(`no container [data-testid="${within}"]`); }
  if (!pos) { await shot("fail"); fail(`no <${tag}> with text "${txt}"${within ? ` in ${within}` : ""} (see ${SHOTS})`); }
  await page.mouse.click(pos[0], pos[1]);
}
// Tap a Photo-type button and prove the native file picker opened from that very tap (P2-14).
async function tapAndPickPhoto(txt, within) {
  const [chooser] = await Promise.all([
    page.waitForFileChooser({ timeout: 5_000 }).catch(() => null),
    clickText(txt, "button", false, within),
  ]);
  if (!chooser) { await shot("fail"); fail(`tapping "${txt}" did not open the file picker synchronously`); }
  await chooser.accept([PHOTO]);
}
async function pin(digits) { for (const d of digits) await clickText(d); await clickText("Unlock", "button", false); }
// Auth (P0-2): API reads/writes go through an owner session.
const kvAdmin = await apiClient(URL).loginAdmin("9999").catch(e => { console.error("owner login 9999 failed: seed first. " + e.message); process.exit(1); });
const kv = async () => kvAdmin.get("/api/data");
const step = async (name, fn) => { process.stdout.write(`- ${name}\n`); await fn(); };
const TZ = "Asia/Bangkok";
const day = (offset = 0) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + offset * 86_400_000));
const at = (offsetDays, hh) => { const d = new Date(day(offsetDays) + "T00:00:00+07:00"); d.setHours(d.getHours() + hh); return d.getTime(); };

try {
  const data = await kv();
  if (!(data.employees || []).some(e => e.name === "Nong")) fail("server is not seeded with the default profile");

  // Fixture: a daily-mode night shoot (yesterday + today) with the RS3 picked at 19:00 yesterday by Nong (P1-2).
  const nightJob = { id: "job_night", name: "Night Shoot Sathorn", production: "Netflix Thailand", dates: [day(-1), day(0)], status: "Confirmed", shootTime: "Night", location: "Local (Bangkok)", locationCity: "", contactPerson: "", contactPlatform: "", dateOverrides: {}, assignedEquipment: [{ eqId: "eq_tripod", qty: 1 }], checkoutMode: "daily", checkoutRoles: { barcode: "anyone", photo: "anyone" } };
  const nightPick = { id: "co_night_pick", jobId: "job_night", requestId: null, jobName: nightJob.name, eqId: "eq_tripod", qty: 1, employeeId: "e_nong", employeeName: "Nong", type: "pick", ts: at(-1, 19), photo: null, location: { lat: 13.7563, lng: 100.5018, acc: 12 } };
  if (!(data.jobs || []).some(j => j.id === "job_night")) {
    const r = await kvAdmin.put("/api/data", { jobs: [...data.jobs, nightJob], checkouts: [...data.checkouts, nightPick] });
    if (!r.ok) fail("fixture PUT failed " + r.status);
  }

  // ── CREW 390x844 ─────────────────────────────────────────────────────────
  await step("crew login Nong (1111)", async () => {
    await newPage({ width: 390, height: 844, isMobile: true, hasTouch: false });
    await page.screenshot({ path: PHOTO }); // any image works as the "camera" photo
    await waitText("Crew / ทีมงาน");
    await clickText("Crew / ทีมงาน", "button", false);
    await waitText("Select account");
    await clickText("Select account", "button", false);
    await waitText("Nong", 5_000);
    await clickText("Nong", "span");
    await pin("1111");
    await waitText("Today's Jobs");
    await expectText("Gear Out", "gear-out card");
    await expectText("2 out", "TVC Toyota shows 2 items out");
    await expectText("Night Shoot Sathorn", "daily-mode night job with gear picked at 19:00 yesterday must be on the gear-out card (P1-2)");
    await shot("crew-today");
  });

  await step("P1-2 daily mode: night-shoot gear has a return button after midnight", async () => {
    await clickText("Night Shoot Sathorn", "p", false);
    await waitText("Tap each item to return");
    await expectText("Sachtler Flowtech 75", "the tripod picked yesterday 19:00 is listed for return");
    await expectText("1 of 1 out");
    await shot("crew-night-return");
    await clickText("Back", "button", false);
    await waitText("Today's Jobs");
  });

  await step("P1-1/P1-5 partial return far from pickup -> reason + pending", async () => {
    await page.setGeolocation(FAR);
    await clickText("TVC Toyota", "p", false);
    await waitText("Tap each item to return");
    await expectText("4 of 4 out", "V-Mount shows count-based qty");
    await shot("crew-return-list");
    await tapAndPickPhoto("Photo", "item-eq_vmount");
    await waitText("Return photo", 10_000);
    await page.waitForSelector("[data-testid='return-qty']", { timeout: 10_000 });
    await expectText("Units coming back", "qty stepper on the preview (P1-1)");
    await expectText("Retake", "Retake offered before commit (P1-4)");
    await shot("crew-preview-return");
    await page.click("button[aria-label='minus']");
    const q = await page.$eval("[data-testid='return-qty']", e => e.textContent.trim());
    if (q !== "3") fail(`qty stepper should read 3 after minus, got ${q}`);
    await expectText("Missing 1", "remainder badge on the stepper");
    await clickText("Damaged");
    await page.type("input[placeholder*='battery']", "one battery left on the truck");
    await shot("crew-preview-partial");
    await waitText("Confirm Return", 10_000);
    await clickText("Confirm Return", "button", false);
    await waitText("Sent for admin approval");
    await expectText("km from the pick-up point", "distance + rule explained (P1-5)");
    await expectText("within 50 m", "rule threshold shown");
    await expectText("Retry at shop", "retry affordance");
    await expectNoText("All gear returned", "pending must not read as all returned");
    await shot("crew-return-pending");
  });

  await step("P1-5 retry at shop -> passes without approval, earlier request withdrawn", async () => {
    await page.setGeolocation(SHOP);
    // FX6 far first so both items are pending -> waiting card (not the green one)
    await page.setGeolocation(FAR);
    await tapAndPickPhoto("Photo", "item-eq_fx6");
    await waitText("Confirm Return", 10_000);
    await clickText("Confirm Return", "button", false);
    await waitText("waiting for approval", 10_000);
    await page.waitForSelector("[data-testid='pending-card']", { timeout: 5_000 });
    await expectNoText("All gear returned", "all pending: green card must not show");
    await shot("crew-all-pending");
    await page.setGeolocation(SHOP);
    await sleep(31_000); // getCurrentPosition uses maximumAge 30 s: let the cached FAR fix expire
    await tapAndPickPhoto("Retry at shop", "item-eq_fx6");
    await waitText("Return photo", 10_000);
    await page.waitForSelector("[data-testid='return-qty'], button", { timeout: 10_000 });
    await waitText("Confirm Return", 10_000);
    await clickText("Confirm Return", "button", false);
    await sleep(600);
    const fx6 = await page.$eval("[data-testid='item-eq_fx6']", e => e.innerText);
    if (!/Returned/i.test(fx6)) { await shot("fail"); fail("FX6 retry at shop did not return: " + fx6); }
    await shot("crew-after-retry");
    await clickText("Save", "button", false);
    await waitText("All saved", 15_000);
    const d = await kv();
    const reqs = (d.adminRequests || []).filter(r => r.type === "geo-return");
    const pendingV = reqs.find(r => r.eqId === "eq_vmount" && r.status === "pending");
    if (!pendingV) fail("pending geo-return request for the V-Mount not persisted");
    if (pendingV.qty !== 3 || pendingV.condition !== "damaged" || !/truck/.test(pendingV.note || "") || pendingV.distance < 10000 || pendingV.name !== "V-Mount 150Wh") fail("geo request missing qty/condition/note/distance/name: " + JSON.stringify({ qty: pendingV.qty, condition: pendingV.condition, note: pendingV.note, distance: pendingV.distance, name: pendingV.name }));
    const fxReqs = reqs.filter(r => r.eqId === "eq_fx6");
    if (!fxReqs.some(r => r.status === "withdrawn") || fxReqs.some(r => r.status === "pending")) fail("FX6 remote request should be withdrawn after the shop retry: " + JSON.stringify(fxReqs.map(r => r.status)));
    const fxRet = (d.checkouts || []).find(c => c.eqId === "eq_fx6" && c.type === "return" && c.jobId === "job1");
    if (!fxRet || fxRet.qty !== 1 || fxRet.condition !== "ok") fail("FX6 return event not persisted with qty 1");
    console.log("  ok  geo request + withdrawal + return persisted");
  });

  await step("P1-5 crew Today shows 'Returns waiting for approval'", async () => {
    await clickText("Back to", "button", false).catch(() => clickText("Back", "button", false));
    await waitText("Today's Jobs");
    await page.waitForSelector("[data-testid='geo-waiting-card']", { timeout: 5_000 });
    const card = await page.$eval("[data-testid='geo-waiting-card']", e => e.innerText);
    if (!/V-Mount 150Wh ×3/.test(card) || !/Return \(GPS\)/.test(card) || !/km from pick-up/.test(card) || !/Waiting/.test(card)) fail("waiting card lacks item/label/distance/status: " + card);
    await shot("crew-today-waiting");
  });

  await step("P1-4 pick with preview + undo (Netflix job)", async () => {
    await clickText("Netflix Series Ep.3", "h3", false);
    await waitText("Tap each item to check out");
    await tapAndPickPhoto("Photo", "item-eq_fx6");
    await waitText("Pick-up photo", 10_000);
    await waitText("Use photo", 10_000);
    await shot("crew-preview-pick");
    // Retake reopens the picker synchronously
    const [chooser2] = await Promise.all([page.waitForFileChooser({ timeout: 5_000 }).catch(() => null), clickText("Retake", "button", false)]);
    if (!chooser2) fail("Retake did not reopen the picker");
    await chooser2.accept([PHOTO]);
    await waitText("Use photo", 10_000);
    await clickText("Use photo", "button", false);
    await sleep(400);
    let row = await page.$eval("[data-testid='item-eq_fx6']", e => e.innerText);
    if (!/Out/.test(row) || !/Undo/.test(row)) fail("picked row should show Out + Undo: " + row);
    await shot("crew-picked-undo");
    await sleep(2_500); // let the debounced autosave persist the pick first
    await clickText("Undo", "button", false, "item-eq_fx6");
    await sleep(400);
    row = await page.$eval("[data-testid='item-eq_fx6']", e => e.innerText);
    if (/Undo/.test(row) || !/Photo/.test(row)) fail("undo should restore the Photo button: " + row);
    await shot("crew-after-undo");
    await clickText("Save", "button", false);
    await waitText("All saved", 15_000);
    const d = await kv();
    const picks = (d.checkouts || []).filter(c => c.jobId === "job2" && c.eqId === "eq_fx6");
    if (picks.length !== 1 || picks[0].type !== "void" || picks[0].qty !== 0 || picks[0].voidedType !== "pick") fail("undo tombstone not persisted: " + JSON.stringify(picks.map(p => [p.type, p.qty])));
    console.log("  ok  undo persisted as a void tombstone");
    await clickText("Back", "button", false);
    await waitText("Today's Jobs");
    await clickText("Log out", "button", false).catch(() => {});
  });

  // ── ADMIN 1280x900 ───────────────────────────────────────────────────────
  await step("admin login + Checkout page (P0-4/P3-7)", async () => {
    await newPage({ width: 1280, height: 900 });
    await waitText("Crew / ทีมงาน");
    await clickText("Rental house admin", "button", false);
    await waitText("Enter PIN");
    await pin("9999");
    await waitText("Overview");
    await clickText("Checkout");
    await waitText("Active jobs");
    const h1 = await page.$$eval("h1", hs => hs.map(h => h.textContent.trim()));
    if (!h1.includes("Gear Checkout")) fail("page title missing: " + JSON.stringify(h1));
    const ids = await page.$$eval("[data-testid^='admin-job-']", els => els.map(e => e.getAttribute("data-testid")));
    if (ids[0] !== "admin-job-job1") fail("overdue TVC Toyota must be listed first: " + JSON.stringify(ids));
    if (!ids.includes("admin-job-job_night") || !ids.includes("admin-job-job2")) fail("night job + Netflix missing from active list: " + JSON.stringify(ids));
    await expectText("Overdue");
    await expectNoText(day(-2), "raw ISO date must not render (formatDate)");
    await shot("admin-checkout-active");
  });

  await step("admin approves the pending V-Mount return from the dashboard", async () => {
    await clickText("Dashboard"); await waitText("Overview");
    await clickText("Approve", "button", false);
    await sleep(400);
    await shot("admin-dashboard-approved");
    await sleep(2_500);
    const d = await kv();
    const ret = (d.checkouts || []).find(c => c.jobId === "job1" && c.eqId === "eq_vmount" && c.type === "return");
    if (!ret || ret.qty !== 3 || ret.condition !== "damaged" || !ret.adminApproved || !ret.by) fail("approved geo return should carry qty 3 / damaged / adminApproved: " + JSON.stringify(ret));
    console.log("  ok  approval wrote a partial return event");
  });

  await step("P0-4 Receive partial + Mark lost on the admin Checkout page", async () => {
    await clickText("Checkout"); await waitText("Active jobs");
    await clickText("TVC Toyota", "p", false);
    await waitText("Picked by Nong");
    let row = await page.$eval("[data-testid='admin-item-eq_vmount']", e => e.innerText);
    if (!/1 of 4 out/.test(row) || !/Missing 1/.test(row)) fail("V-Mount should read 1 of 4 out + Missing 1: " + row);
    await shot("admin-job-return");
    await clickText("Mark lost", "button", false, "admin-item-eq_vmount");
    await waitText("Mark lost or written off");
    await clickText("Written off", "button", false);
    await page.type("[data-testid='lost-note']", "cell dead, scrapped");
    await shot("admin-lost-modal");
    await page.click("[data-testid='lost-confirm']");
    await sleep(400);
    row = await page.$eval("[data-testid='admin-item-eq_vmount']", e => e.innerText);
    if (!/Written off/.test(row)) fail("row should show Written off after marking lost: " + row);
    await shot("admin-after-lost");
    await clickText("Back", "button", false);
    await waitText("Active jobs");
    // Netflix: Receive flow on a pick-phase job -> Mark picked, then Return -> Receive
    await clickText("Netflix Series Ep.3", "p", false);
    await waitText("Mark picked");
    await clickText("Mark picked", "button", false, "admin-item-eq_aputure");
    await sleep(300);
    await clickText("Return", "button", true);
    await sleep(300);
    await clickText("Receive", "button", false, "admin-item-eq_aputure");
    await waitText("Receive gear");
    await page.click("button[aria-label='minus']");
    await shot("admin-receive-modal");
    await page.click("[data-testid='receive-confirm']");
    await sleep(400);
    row = await page.$eval("[data-testid='admin-item-eq_aputure']", e => e.innerText);
    if (!/1 of 2 out/.test(row) || !/Missing 1/.test(row)) fail("Aputure should read 1 of 2 out + Missing 1 after receiving 1: " + row);
    await shot("admin-after-receive");
    await sleep(2_500);
    const d = await kv();
    const lost = (d.checkouts || []).find(c => c.type === "lost" && c.eqId === "eq_vmount");
    if (!lost || lost.qty !== 1 || lost.condition !== "written_off" || !lost.by || lost.jobId !== "job1") fail("lost event not persisted: " + JSON.stringify(lost));
    const rec = (d.checkouts || []).find(c => c.type === "return" && c.eqId === "eq_aputure" && c.jobId === "job2");
    if (!rec || rec.qty !== 1 || !rec.adminApproved || rec.employeeId !== "admin") fail("admin receive event not persisted: " + JSON.stringify(rec));
    console.log("  ok  lost + receive events persisted");
  });

  await step("dashboard Not Returned reflects counts (Toyota clear, Aputure missing 1)", async () => {
    await clickText("Dashboard"); await waitText("Overview");
    const txt = await bodyText();
    if (/V-Mount 150Wh[^\n]*TVC Toyota/.test(txt)) fail("V-Mount should no longer be listed as not returned for Toyota");
    if (!/Aputure 600d Pro/.test(txt) || !/Missing 1/.test(txt)) fail("Aputure missing 1 should be in Not Returned");
    await shot("admin-dashboard-final");
  });

  await step("admin Settings shows production day / radius / home base", async () => {
    await clickText("Settings"); await waitText("Production day starts at", 8_000);
    await expectText("Return radius");
    await expectText("Shop location");
    await shot("admin-settings-checkout");
  });

  const bad = errors.filter(e => !ALLOW.some(rx => rx.test(e)));
  if (bad.length) { console.error("\nUnexpected errors:\n  " + bad.join("\n  ")); fail(`${bad.length} unexpected page/console error(s)`); }
  console.log(`\nCHECKOUT E2E PASSED (${shotN} screenshots in ${SHOTS}; ${errors.length - bad.length} allowlisted lines)`);
} catch (e) {
  if (!process.exitCode) { console.error("\nCHECKOUT E2E FAILED: " + (e && e.message)); process.exitCode = 1; }
} finally {
  await browser.close();
}
