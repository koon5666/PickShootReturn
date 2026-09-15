#!/usr/bin/env node
// roster-ops track walk-through (P1-10, P1-14, P2-11, P2-16, P3-8) against a LOCAL,
// freshly seeded server (tests/local-server.mjs + tests/seed.mjs default profile).
//
//   node tests/walk-roster-ops.mjs <PORT>
//
// Admin 1280x900: 2-column dashboard (rail + schedule, header New Job, no FAB), the
// bell lists the same needs-action items and deep-links, Team only points at the
// Dashboard for gear requests, crew roster on a job (KV: crew + checkoutRoles), LINE
// push gated on real changes, Reports page (4 tabs), per-tenant theme in KV, QR label
// window renders inline SVG. Admin 390px: single column + FAB. Crew Nong / Arthit
// 390x844: my jobs first / other crews collapsed, call + pickup times, Invoice tab my
// jobs + show all. Offline: boot from cache with /api/data blocked, create a job,
// reconnect -> the job reaches KV (no reload-and-discard); crew profile save queued
// offline and drained. Screenshots in tests/.walk-roster-shots/.
import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { apiClient } from "./apiclient.mjs";

const PUPPETEER = process.env.PUPPETEER_CORE
  || "/private/tmp/claude-501/-Users-koonya-inta/bd16a78f-33be-43a8-91b5-db242cf9f6df/scratchpad/puptest/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const { default: puppeteer } = await import(PUPPETEER);

const port = parseInt(process.argv[2], 10);
if (!(port > 0)) { console.error("usage: node tests/walk-roster-ops.mjs <PORT>"); process.exit(2); }
const URL = `http://127.0.0.1:${port}`;
const SHOTS = resolve(dirname(fileURLToPath(import.meta.url)), ".walk-roster-shots");
mkdirSync(SHOTS, { recursive: true });

const ALLOW = [
  /WebSocket connection to 'ws:\/\/[^']*\/api\/(session|chat)/i,
  /\/api\/profile\/[^ ]* .*404/i,
  /\/api\/notify/i,
  /Failed to load resource: the server responded with a status of (404|500|503)/i,
  /Failed to load resource: net::ERR_FAILED/i, // offline simulation
  /Failed to load resource: net::ERR_INTERNET_DISCONNECTED/i,
  /409/, // the offline reconnect deliberately hits a 409 and rebases (P1-14)
];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const fail = (msg) => { console.error("\nWALK FAILED: " + msg); process.exitCode = 1; throw new Error(msg); };
let shotN = 0;
const errors = [];
const notifyCalls = [];

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox"] });
let page;
let blockData = false; // offline simulation: fail every /api/data request

async function newPage(viewport, { keepStorage = false } = {}) {
  if (page) await page.close();
  page = await browser.newPage();
  await page.setViewport(viewport);
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error") errors.push("console: " + m.text()); });
  page.on("response", r => { if (r.status() >= 400 && r.status() !== 409 && !/\/api\/session|\/api\/profile\/|\/api\/notify/.test(r.url())) errors.push(`http ${r.status()} ${r.url()}`); });
  await page.setRequestInterception(true);
  page.on("request", req => {
    if (req.url().includes("/api/notify") && req.method() === "POST") { try { notifyCalls.push(JSON.parse(req.postData() || "{}")); } catch { notifyCalls.push({}); } }
    if (blockData && req.url().includes("/api/data")) return req.abort("failed");
    req.continue();
  });
  // Fresh localStorage for every NEW tab, but a reload of the same tab keeps it
  // (the session + offline cache must survive the reloads below).
  if (!keepStorage) await page.evaluateOnNewDocument(() => { try { if (!sessionStorage.getItem("walk_cleared")) { localStorage.clear(); sessionStorage.setItem("walk_cleared", "1"); } } catch {} });
  // The session is a cookie now (P0-2), shared by every tab of this browser: a fresh
  // tab must start logged out, so drop the cookies too.
  if (!keepStorage) { const cdp = await page.createCDPSession(); await cdp.send("Network.clearBrowserCookies"); await cdp.detach(); }
  await page.goto(URL, { waitUntil: "networkidle0", timeout: 60_000 });
}
const shot = async (name) => { const p = `${SHOTS}/${String(++shotN).padStart(2, "0")}-${name}.png`; await page.screenshot({ path: p }); return p; };
const bodyText = () => page.evaluate(() => document.body.innerText);
const hasText = async (txt) => (await bodyText()).toLowerCase().includes(txt.toLowerCase());
async function waitText(txt, ms = 15_000) {
  try { await page.waitForFunction(t => document.body.innerText.toLowerCase().includes(t), { timeout: ms }, txt.toLowerCase()); }
  catch { await shot("fail"); fail(`text "${txt}" never appeared (see ${SHOTS})`); }
}
async function clickText(txt, tag = "button", exact = true) {
  const pos = await page.evaluate((txt, tag, exact) => {
    const norm = s => s.replace(/\s+/g, " ").trim().toLowerCase();
    const want = norm(txt);
    const el = [...document.querySelectorAll(tag)].find(e => exact ? norm(e.textContent) === want : norm(e.textContent).includes(want));
    if (!el) return null;
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    return [r.x + r.width / 2, r.y + r.height / 2];
  }, txt, tag, exact);
  if (!pos) { await shot("fail"); fail(`no <${tag}> with text "${txt}" (see ${SHOTS})`); }
  await page.mouse.click(pos[0], pos[1]);
}
async function clickSel(sel) {
  const pos = await page.evaluate((sel) => { const el = document.querySelector(sel); if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, sel);
  if (!pos) { await shot("fail"); fail(`no element ${sel}`); }
  await page.mouse.click(pos[0], pos[1]);
}
const count = (sel) => page.evaluate(s => document.querySelectorAll(s).length, sel);
// Click the calendar day `d` inside the job form (the dashboard calendar behind the modal has the same numbers).
async function clickJobDay(d) {
  const pos = await page.evaluate((d) => { const el = [...document.querySelectorAll('[data-testid="job-calendar"] div')].find(e => e.textContent.trim() === String(d)); if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, d);
  if (!pos) { await shot("fail"); fail(`no job calendar day ${d}`); }
  await page.mouse.click(pos[0], pos[1]);
}
async function pin(digits) { for (const d of digits) await clickText(d); await clickText("Unlock", "button", false); }
async function adminLogin(viewport = { width: 1280, height: 900 }, opts) {
  await newPage(viewport, opts);
  await waitText("Crew / ทีมงาน");
  await clickText("Rental house admin", "button", false);
  await waitText("Enter PIN");
  await pin("9999");
  await waitText("Overview");
}
async function crewLogin(name, digits) {
  await newPage({ width: 390, height: 844, isMobile: true, hasTouch: false });
  await waitText("Crew / ทีมงาน");
  await clickText("Crew / ทีมงาน", "button", false);
  await waitText("Select account");
  await clickText("Select account", "button", false);
  await waitText(name, 5_000);
  await clickText(name, "span");
  await pin(digits);
  await waitText("Today's Jobs");
}
// Auth (P0-2): every /api route needs the session cookie, so KV reads/writes go
// through tests/apiclient.mjs as the owner (set up in the health check below).
let kvAdmin = null;
const kv = async () => kvAdmin.get("/api/data");
const step = async (name, fn) => { process.stdout.write(`- ${name}\n`); await fn(); };

try {
  const health = await fetch(URL + "/api/public").catch(() => null);
  if (!health || health.status !== 200) fail(`GET ${URL}/api/public -> ${health ? health.status : "unreachable"}; boot + seed first (tests/README.md)`);
  kvAdmin = await apiClient(URL).loginAdmin("9999").catch(e => fail("owner login 9999 failed: seed first. " + e.message));
  const seed = await kv();
  if (!(seed.employees || []).some(e => e.name === "Nong")) fail("server is not seeded with the default profile");
  const nong = seed.employees.find(e => e.name === "Nong");

  // ── ADMIN: dashboard layout (P2-11) ─────────────────────────────────────
  await step("admin dashboard 1280: rail + schedule, header New Job, no FAB", async () => {
    await adminLogin();
    await sleep(400);
    const layout = await page.evaluate(() => {
      const g = document.querySelector('[data-testid="dash-grid"]');
      const rail = document.querySelector('[data-testid="needs-action-rail"]');
      const col = document.querySelector('[data-testid="schedule-column"]');
      return { display: getComputedStyle(g).display, railX: rail.getBoundingClientRect().x, colX: col.getBoundingClientRect().x, railTop: rail.getBoundingClientRect().y,
        fab: !!document.querySelector('[data-testid="dash-fab"]'), newJob: !!document.querySelector('[data-testid="dash-new-job"]'),
        cards: ["approvals-card", "stillout-card", "gear-requests-card"].map(id => { const el = document.getElementById(id); return el ? Math.round(el.getBoundingClientRect().y) : null; }),
        damage: !!document.querySelector('[data-testid="damage-card"]'), height: document.documentElement.scrollHeight };
    });
    await shot("admin-dashboard-1280");
    if (layout.display !== "grid" || !(layout.colX > layout.railX + 200)) fail(`expected a 2-column grid, got ${JSON.stringify(layout)}`);
    if (layout.fab) fail("FAB still rendered on desktop");
    if (!layout.newJob) fail("header New Job button missing on desktop");
    if (layout.cards.some(y => y === null || y > 900)) fail(`needs-action cards not above the fold: ${JSON.stringify(layout.cards)}`);
    if (!layout.damage) fail("open damage card missing from the rail");
    console.log(`  ok  grid; rail cards at y=${layout.cards.join(",")}; page height ${layout.height}px`);
  });
  await step("admin: bell lists the same needs-action items and deep-links to the gear requests card", async () => {
    await clickText("Notifications", "button", false);
    await sleep(300);
    const txt = await bodyText();
    for (const want of ["Overdue", "Admin Approvals", "Equipment Requests", "Damage Reports"]) if (!txt.toLowerCase().includes(want.toLowerCase())) fail(`bell popover missing "${want}"`);
    await shot("admin-bell");
    await clickText("Equipment Requests", "p", false);
    await sleep(700);
    const y = await page.evaluate(() => document.getElementById("gear-requests-card").getBoundingClientRect().y);
    if (!(y >= 0 && y < 850)) fail(`Equipment Requests notification did not land on the gear requests card (y=${y})`);
    console.log("  ok  bell -> Dashboard gear requests card");
  });
  await step("admin Team: gear requests handled in one place (pointer only)", async () => {
    await clickText("Team"); await waitText("Team");
    await sleep(300);
    if (!(await count('[data-testid="team-requests-link"]'))) fail("Team pointer card missing");
    const approveButtons = await page.evaluate(() => [...document.querySelectorAll("button")].filter(b => /^approve$/i.test(b.textContent.trim())).length);
    if (approveButtons) fail("Team page still renders Approve buttons for gear requests");
    await shot("admin-team");
    await clickText("Go to gear requests", "button", false);
    await waitText("Overview");
    await sleep(600);
    const y = await page.evaluate(() => document.getElementById("gear-requests-card").getBoundingClientRect().y);
    if (!(y >= 0 && y < 850)) fail(`Team link did not land on the gear requests card (y=${y})`);
    console.log("  ok  Team -> Dashboard gear requests");
  });

  // ── ADMIN: crew roster on a job (P1-10) ─────────────────────────────────
  await kvAdmin.put("/api/data", { lineGroupId: "Gwalk" });
  await step("admin: put Nong (1st AC, pickup 06:30, call 07:30) on Netflix; KV crew + checkoutRoles; LINE push once", async () => {
    await page.reload({ waitUntil: "networkidle0" });
    await waitText("Overview");
    await clickText("Job Bookings"); await waitText("Job Bookings");
    await clickText("Confirmed", "button", false);
    await sleep(300);
    if (!(await hasText("No crew assigned yet"))) fail("job card should say no crew assigned yet");
    // edit Netflix
    await clickSel('[data-testid="job-edit-job2"]');
    await waitText("Edit Job");
    notifyCalls.length = 0;
    await clickSel('[data-testid="add-crew"]');
    await sleep(200);
    await page.select('[data-testid="crew-row"] select', nong.id);
    await page.type('[data-testid="crew-row"] input[list]', "1st AC");
    await page.evaluate(() => {
      const set = (el, v) => { const proto = Object.getPrototypeOf(el); const d = Object.getOwnPropertyDescriptor(proto, "value"); d.set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); };
      const [pickup, call] = document.querySelectorAll('[data-testid="crew-row"] input[type="time"]');
      set(pickup, "06:30"); set(call, "07:30");
    });
    await shot("admin-job-crew-form");
    await clickText("Save Job", "button", false);
    await sleep(2500);
    const d = await kv();
    const j = d.jobs.find(x => x.id === "job2");
    if (!j || !Array.isArray(j.crew) || j.crew.length !== 1) fail(`job2.crew not saved: ${JSON.stringify(j && j.crew)}`);
    if (j.crew[0].employeeId !== nong.id || j.crew[0].role !== "1st AC" || j.crew[0].callTime !== "07:30" || j.crew[0].pickupTime !== "06:30") fail(`crew row wrong: ${JSON.stringify(j.crew[0])}`);
    if (JSON.stringify(j.checkoutRoles) !== JSON.stringify({ barcode: [nong.id], photo: [nong.id] })) fail(`checkoutRoles not defaulted from roster: ${JSON.stringify(j.checkoutRoles)}`);
    if (!(await hasText("Nong (1st AC)"))) fail("job card does not list the crew");
    if (notifyCalls.length !== 1) fail(`expected exactly 1 LINE push for a roster change, got ${notifyCalls.length}`);
    if (!/Crew updated/.test(notifyCalls[0].message) || !/Nong \(1st AC\)/.test(notifyCalls[0].message) || !/pickup 06:30, call 07:30/.test(notifyCalls[0].message)) fail(`push text wrong: ${notifyCalls[0].message}`);
    if (JSON.stringify(notifyCalls[0].userIds) !== JSON.stringify(["Gwalk"])) fail("push should go to the group");
    await shot("admin-job-card-crew");
    console.log("  ok  roster saved, lanes defaulted, one push: " + notifyCalls[0].message.split("\n")[0]);
  });
  await step("admin: a contact-person edit sends NO push; a date change does", async () => {
    notifyCalls.length = 0;
    await clickSel('[data-testid="job-edit-job2"]');
    await waitText("Edit Job");
    await page.type('input[placeholder="Name"]', " x");
    await clickText("Save Job", "button", false);
    await sleep(800);
    if (notifyCalls.length !== 0) fail(`contact edit pushed ${notifyCalls.length} LINE message(s)`);
    await clickSel('[data-testid="job-edit-job2"]');
    await waitText("Edit Job");
    // toggle one more shoot day (the 28th of the shown month, never in the seed)
    await clickJobDay(28);
    await clickText("Save Job", "button", false);
    await sleep(800);
    if (await hasText("Gear conflict")) { await clickText("Save anyway", "button", false); await sleep(800); }
    if (notifyCalls.length !== 1) fail(`date change should push once, got ${notifyCalls.length}`);
    if (!/\[Updated\]/.test(notifyCalls[0].message)) fail(`date change headline: ${notifyCalls[0].message.split("\n")[0]}`);
    console.log("  ok  push gate: contact edit silent, date change pushes");
  });

  // ── ADMIN: reports (P2-16) ──────────────────────────────────────────────
  await step("admin Insights: utilisation / not returned / customer / statement", async () => {
    await clickText("Insights"); await waitText("Utilisation");
    await sleep(400);
    const utilRows = await count('[data-testid="util-table"] tbody tr');
    if (utilRows !== 6) fail(`utilisation rows: ${utilRows}`);
    const first = await page.evaluate(() => document.querySelector('[data-testid="util-table"] tbody tr').innerText);
    if (!/Sony|V-Mount/.test(first) || !/%/.test(first) || !/unit-days/.test(first)) fail(`utilisation first row: ${first}`);
    await shot("reports-util");
    await clickSel('[data-testid="reports-tab-overdue"]'); await sleep(300);
    if ((await count('[data-testid="overdue-table"] tbody tr')) !== 2) fail("not-returned table should have 2 rows");
    if (!(await hasText("OVERDUE"))) fail("overdue badge missing");
    await shot("reports-overdue");
    await clickSel('[data-testid="reports-tab-customer"]'); await sleep(300);
    await page.select('[data-testid="customer-select"]', "Bangkok Pictures Co., Ltd.");
    await sleep(300);
    const totals = await page.evaluate(() => document.querySelector('[data-testid="customer-totals"]')?.innerText || "");
    if (!/1 job/.test(totals) || !/6 unit/.test(totals)) fail(`customer totals: ${totals}`);
    await shot("reports-customer");
    await clickSel('[data-testid="reports-tab-statement"]'); await sleep(300);
    if ((await count('[data-testid="statement-company"]')) !== 1) fail("statement should group 1 customer this month");
    if (!(await hasText("INV-NG-26-0001")) || !(await hasText("3,500.00"))) fail("statement row missing Nong's invoice");
    await shot("reports-statement");
    console.log("  ok  four report tabs render from the seed");
  });

  // ── ADMIN: theme per tenant (P3-8) ──────────────────────────────────────
  await step("admin Settings: palette change lands in KV theme + localStorage cache", async () => {
    await clickText("Settings"); await waitText("Navigation Order", 8_000);
    await clickText("Amber", "button", false);
    await sleep(2500);
    const d = await kv();
    if (!d.theme || d.theme.palette !== "black-yellow" || d.theme.style !== "flat") fail(`KV theme: ${JSON.stringify(d.theme)}`);
    const ls = await page.evaluate(() => localStorage.getItem("psr_theme"));
    if (!/black-yellow/.test(ls || "")) fail(`localStorage cache: ${ls}`);
    await shot("settings-theme-amber");
    await clickText("Blue", "button", false);
    await sleep(2500);
    if ((await kv()).theme.palette !== "white-blue") fail("theme did not switch back");
    console.log("  ok  theme persisted per tenant");
  });
  await step("admin Equipment: QR label window renders inline SVG (no CDN script)", async () => {
    await page.reload({ waitUntil: "networkidle0" });
    await waitText("Overview");
    await clickText("Equipment"); await waitText("Equipment Library");
    const target = new Promise(res => browser.once("targetcreated", res));
    await clickText("All QR", "button", false);
    const t = await target;
    const popup = await t.page();
    await sleep(800);
    const info = await popup.evaluate(() => ({ svgs: document.querySelectorAll("svg").length, cdn: !!document.querySelector('script[src*="jsdelivr"]'), labels: document.querySelectorAll(".label").length, paths: [...document.querySelectorAll("svg path")].filter(p => p.getAttribute("d").length > 100).length }));
    await popup.screenshot({ path: `${SHOTS}/${String(++shotN).padStart(2, "0")}-qr-labels.png` });
    await popup.close();
    if (info.cdn) fail("QR window still loads the CDN script");
    if (info.svgs !== 6 || info.labels !== 6 || info.paths !== 6) fail(`QR window: ${JSON.stringify(info)}`);
    console.log("  ok  6 inline SVG labels, no external script");
  });
  await step("admin dashboard 390: single column, FAB present", async () => {
    await page.setViewport({ width: 390, height: 844 });
    await clickText("Dashboard"); // bottom nav
    await waitText("Overview");
    await sleep(500);
    const info = await page.evaluate(() => ({ display: getComputedStyle(document.querySelector('[data-testid="dash-grid"]')).display, fab: !!document.querySelector('[data-testid="dash-fab"]'), newJob: !!document.querySelector('[data-testid="dash-new-job"]'), reportsNav: [...document.querySelectorAll("nav button")].some(b => /Insights/.test(b.textContent)) }));
    await shot("admin-dashboard-390");
    if (info.display === "grid" || !info.fab || info.newJob) fail(`phone layout wrong: ${JSON.stringify(info)}`);
    if (!info.reportsNav) fail("Insights missing from the bottom nav");
    console.log("  ok  phone: stacked, FAB back, Reports in nav");
  });

  // ── CREW (P1-10) ────────────────────────────────────────────────────────
  await step("crew Nong: Netflix is MY job with pickup + call time; TVC Toyota (open) still listed", async () => {
    await crewLogin("Nong", "1111");
    await sleep(500);
    const mine = await count('[data-testid="my-job-card"]');
    if (mine < 1) fail("no my-job-card for Nong");
    const times = await page.evaluate(() => document.querySelector('[data-testid="my-times"]')?.innerText || "");
    if (!/06:30/.test(times) || !/07:30/.test(times)) fail(`my times: "${times}"`);
    if (!(await hasText("1st AC"))) fail("role badge missing");
    if (await count('[data-testid="toggle-other-jobs"]')) fail("Nong should have no other-crew jobs to toggle");
    await shot("crew-nong-today");
    console.log("  ok  Nong sees her job with times");
  });
  await step("crew Arthit: Netflix collapsed under other crews' jobs; Invoice tab offers my jobs + show all", async () => {
    await crewLogin("Arthit", "2222");
    await sleep(500);
    if (!(await hasText("Nothing assigned to you here"))) fail("Arthit should see the empty-mine message on Today");
    if (await count('[data-testid="my-job-card"]')) fail("Arthit should have no my-job cards today");
    await shot("crew-arthit-today-collapsed");
    await clickSel('[data-testid="toggle-other-jobs"]');
    await sleep(300);
    if ((await count('[data-testid="other-job-card"]')) !== 1) fail("other-job-card not shown after toggle");
    if (!(await hasText("Other crew")) || !(await hasText("Nong (1st AC)"))) fail("other job card should name the crew");
    await shot("crew-arthit-today-expanded");
    await clickText("Invoice"); await waitText("My Invoices");
    await sleep(300);
    const before = await page.evaluate(() => document.querySelector('[data-testid="invoice-jobs-card"]').innerText);
    if (!/TVC Toyota/.test(before) || /Netflix/.test(before)) fail(`invoice job list before show-all: ${before}`);
    await clickSel('[data-testid="invoice-show-all"]');
    await sleep(300);
    const after = await page.evaluate(() => document.querySelector('[data-testid="invoice-jobs-card"]').innerText);
    if (!/Netflix/.test(after) || !/Other crew/.test(after)) fail(`invoice job list after show-all: ${after}`);
    await shot("crew-arthit-invoice-showall");
    console.log("  ok  Arthit: collapsed on Today, my-jobs-only invoicing with show all");
  });

  // ── OFFLINE (P1-14) ─────────────────────────────────────────────────────
  await step("offline admin: boot from cache, create a job, reconnect -> job reaches KV", async () => {
    await adminLogin();                       // warm the cache + session
    await sleep(500);
    blockData = true;
    await page.reload({ waitUntil: "networkidle0" });
    await waitText("Offline", 20_000);
    await waitText("Nothing waiting to sync");
    await shot("offline-admin-clean");
    await clickSel('[data-testid="dash-new-job"]');
    await waitText("New Job");
    await page.type('input[placeholder="e.g. TVC Toyota — Hero Film"]', "Offline Job Walk");
    await clickJobDay(27);
    await clickText("Save Job", "button", false);
    await sleep(500);
    if (!(await hasText("1 change(s) waiting to sync"))) fail("offline banner does not count the pending job");
    await shot("offline-admin-dirty");
    // Meanwhile another device renames the pencil job: the reconnect must merge, not overwrite.
    const before = await kv();
    await kvAdmin.put("/api/data", { jobs: before.jobs.map(j => j.id === "job3" ? { ...j, name: "Music Video (renamed elsewhere)" } : j) });
    blockData = false;
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.waitForNavigation({ waitUntil: "networkidle0", timeout: 30_000 }).catch(() => {});
    await sleep(1500);
    const d = await kv();
    if (!d.jobs.some(j => j.name === "Offline Job Walk")) fail("job created offline was discarded on reconnect");
    if (!d.jobs.some(j => j.name === "Music Video (renamed elsewhere)")) fail("the other device's edit was overwritten by the offline delta (409 rebase did not happen)");
    await waitText("Overview");
    if (await hasText("Offline.")) fail("still offline after reconnect");
    await shot("offline-admin-reconnected");
    console.log("  ok  offline job synced on reconnect, page reloaded clean");
  });
  await step("offline crew: profile save is queued and drained on reconnect", async () => {
    await crewLogin("Nong", "1111");
    await sleep(500);
    blockData = true;
    await page.reload({ waitUntil: "networkidle0" });
    await waitText("Offline", 20_000);
    await clickText("Profile"); await waitText("My Profile");
    const phoneSel = await page.evaluate(() => { const el = document.querySelector('input[type="tel"]'); if (!el) return null; el.scrollIntoView({ block: "center" }); el.setAttribute("data-walk", "phone"); return "input[data-walk=phone]"; });
    if (!phoneSel) fail("phone input not found on Profile");
    await page.click(phoneSel, { clickCount: 3 });
    await page.type(phoneSel, "099-000-1234");
    await clickText("Save Profile", "button", false);
    await waitText("Saved on this device", 8_000);
    if (!(await hasText("1 change(s) waiting to sync"))) fail("crew banner does not count the queued profile save");
    await shot("offline-crew-queued");
    blockData = false;
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.waitForNavigation({ waitUntil: "networkidle0", timeout: 30_000 }).catch(() => {});
    await sleep(1000);
    const prof = await kvAdmin.get("/api/profile/" + nong.id);
    if (prof.phone !== "099-000-1234") fail(`queued profile save not drained: phone=${prof.phone}`);
    console.log("  ok  queued profile save reached KV after reconnect");
  });

  const bad = errors.filter(e => !ALLOW.some(rx => rx.test(e)));
  if (bad.length) { console.error("\nUnexpected errors:\n  " + bad.join("\n  ")); fail(`${bad.length} unexpected page/console error(s)`); }
  console.log(`\nWALK PASSED (${shotN} screenshots in ${SHOTS})`);
} catch (e) {
  if (!process.exitCode) { console.error("\nWALK FAILED: " + (e && e.message)); process.exitCode = 1; }
} finally {
  await browser.close();
}
