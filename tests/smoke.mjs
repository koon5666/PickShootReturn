#!/usr/bin/env node
// End-to-end smoke test against a LOCAL, SEEDED server (tests/local-server.mjs +
// tests/seed.mjs default profile). Walks every admin page and modal at 1280x900,
// then the crew portal as Nong (1111) at 390x844, and fails on ANY page error or
// console error outside the local-only allowlist below.
//
//   node tests/smoke.mjs <PORT>          (npm run smoke -- <PORT>)
//
// Screenshots land in tests/.smoke-shots/ (gitignored). Exit code 1 + a clear
// message on the first failure.
//
// puppeteer-core is imported by absolute path from the shared scratchpad checkout
// (PUPPETEER_CORE env var overrides it; e.g. a node_modules of your own).
// Chrome: the installed Google Chrome, headless, swiftshader GL.
import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PUPPETEER = process.env.PUPPETEER_CORE
  || "/private/tmp/claude-501/-Users-koonya-inta/bd16a78f-33be-43a8-91b5-db242cf9f6df/scratchpad/puptest/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const { default: puppeteer } = await import(PUPPETEER);

const port = parseInt(process.argv[2], 10);
if (!(port > 0)) { console.error("usage: node tests/smoke.mjs <PORT>"); process.exit(2); }
const URL = `http://127.0.0.1:${port}`;
const SHOTS = resolve(dirname(fileURLToPath(import.meta.url)), ".smoke-shots");
mkdirSync(SHOTS, { recursive: true });

// Local-only noise that is NOT a failure: the presence/chat Durable Objects are not
// run locally (ws /api/session -> 503) and a fresh state has no profile_<id> (404).
const ALLOW = [
  /WebSocket connection to 'ws:\/\/[^']*\/api\/(session|chat)/i,
  /\/api\/profile\/[^ ]* .*404/i,
  /Failed to load resource: the server responded with a status of (404|503)/i,
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const fail = (msg) => { console.error("\nSMOKE FAILED: " + msg); process.exitCode = 1; throw new Error(msg); };
let shotN = 0;
const errors = [];

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox"] });
let page;

async function newPage(viewport) {
  if (page) await page.close();
  page = await browser.newPage();
  await page.setViewport(viewport);
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error") errors.push("console: " + m.text()); });
  page.on("response", r => { if (r.status() >= 400 && !/\/api\/session|\/api\/profile\//.test(r.url())) errors.push(`http ${r.status()} ${r.url()}`); });
  await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch {} });
  await page.goto(URL, { waitUntil: "networkidle0", timeout: 60_000 });
}
const shot = async (name) => { const p = `${SHOTS}/${String(++shotN).padStart(2, "0")}-${name}.png`; await page.screenshot({ path: p }); return p; };
const bodyText = () => page.evaluate(() => document.body.innerText);
const hasText = async (txt) => (await bodyText()).toLowerCase().includes(txt.toLowerCase());
async function waitText(txt, ms = 15_000) {
  try { await page.waitForFunction(t => document.body.innerText.toLowerCase().includes(t), { timeout: ms }, txt.toLowerCase()); }
  catch { await shot("fail"); fail(`text "${txt}" never appeared (see ${SHOTS})`); }
}
// Click the first element of `tag` whose text matches (case-insensitive; headings
// render uppercase via CSS so we never compare case). Real mouse event, so an
// overlay eating clicks is caught.
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
// Close a Modal / full-screen panel by its heading: the icon-only button that
// shares the heading's header row.
async function closeByTitle(title) {
  const pos = await page.evaluate((title) => {
    const norm = s => s.replace(/\s+/g, " ").trim().toLowerCase();
    const h = [...document.querySelectorAll("h1,h2,h3")].find(e => norm(e.textContent) === norm(title));
    if (!h) return null;
    let node = h.parentElement;
    for (let i = 0; i < 4 && node; i++, node = node.parentElement) {
      const btn = [...node.querySelectorAll("button")].find(b => b.textContent.trim() === "" && b.querySelector("svg"));
      if (btn) { const r = btn.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }
    }
    return null;
  }, title);
  if (!pos) { await shot("fail"); fail(`no close button next to heading "${title}"`); }
  await page.mouse.click(pos[0], pos[1]);
  await sleep(400);
  const hs = await page.evaluate(() => [...document.querySelectorAll("h1,h2,h3")].map(e => e.textContent.trim().toLowerCase()));
  if (hs.includes(title.toLowerCase())) { await shot("fail"); fail(`"${title}" did not close`); }
}
async function openAndClose(buttonText, title, tag = "button", exact = true) {
  await clickText(buttonText, tag, exact);
  await waitText(title, 8_000);
  await shot(title.replace(/\W+/g, "-").toLowerCase());
  await closeByTitle(title);
  console.log(`  ok  ${title} opens + closes`);
}
async function pin(digits) { for (const d of digits) await clickText(d); await clickText("Unlock", "button", false); }

const step = async (name, fn) => { process.stdout.write(`- ${name}\n`); await fn(); };

try {
  // ── health ──────────────────────────────────────────────────────────────
  const health = await fetch(URL + "/api/data").catch(() => null);
  if (!health || health.status !== 200) fail(`GET ${URL}/api/data -> ${health ? health.status : "unreachable"}; boot + seed first (tests/README.md)`);
  const data = await health.json();
  if (!(data.employees || []).some(e => e.name === "Nong" && e.pin === "1111") || data.adminPin !== "9999") fail("server is not seeded with the default profile (node tests/seed.mjs <PORT>)");

  // ── ADMIN 1280x900 ───────────────────────────────────────────────────────
  await step("admin login (9999)", async () => {
    await newPage({ width: 1280, height: 900 });
    await waitText("Admin Login");
    await clickText("Admin Login", "button", false);
    await waitText("Enter PIN");
    await pin("9999");
    await waitText("Overview");
    await shot("admin-dashboard");
    if (!(await hasText("Lucky Cam Rental"))) fail("company name not rendered on the dashboard");
  });
  const pages = [["Dashboard", "Overview"], ["Equipment", "Equipment Library"], ["Job Bookings", "Job Bookings"], ["Invoice", "Invoice"], ["Team", "Team"], ["Checkout", "Active Jobs"]];
  for (const [nav, expect] of pages) {
    await step(`admin page ${nav}`, async () => {
      await clickText(nav);
      await waitText(expect, 10_000);
      await sleep(500);
      await shot("admin-" + nav.replace(/\s+/g, "-").toLowerCase());
    });
  }
  await step("admin modals: New Job, Add Equipment, Settings", async () => {
    await clickText("Job Bookings"); await waitText("Job Bookings");
    await openAndClose("New Job", "New Job");
    await clickText("Equipment"); await waitText("Equipment Library");
    await openAndClose("Add", "Add Equipment");
    await clickText("Settings"); await waitText("Navigation Order", 8_000);
    await shot("settings");
    await closeByTitle("Settings");
    console.log("  ok  Settings opens + closes");
  });
  await step("admin: switch language TH and back", async () => {
    await clickText("Settings"); await waitText("Language");
    await clickText("ภาษาไทย", "button", false);
    await sleep(400);
    if (!(await hasText("ภาพรวม"))) fail("Thai nav label (ภาพรวม) not rendered after switching language");
    await shot("settings-th");
    await clickText("English", "button", false);
    await sleep(300);
    await closeByTitle("Settings");
    await clickText("Dashboard"); await waitText("Overview");
  });
  await step("admin: log out", async () => { await clickText("Log out"); await waitText("Admin Login"); });

  // ── CREW 390x844 ─────────────────────────────────────────────────────────
  await step("crew login Nong (1111)", async () => {
    await newPage({ width: 390, height: 844, isMobile: true, hasTouch: false });
    await waitText("Employee Login");
    await clickText("Employee Login", "button", false);
    await waitText("Select account");
    await clickText("Select account", "button", false);
    await waitText("Nong", 5_000);
    await clickText("Nong", "span");
    await pin("1111");
    await waitText("Today's Jobs");
    await shot("crew-today");
    if (!(await hasText("TVC Toyota"))) fail("overdue job (TVC Toyota, gear out) not shown on Today");
  });
  for (const [tab, expect] of [["Invoice", "My Invoices"], ["Gear", "Equipment Library"], ["Profile", "My Profile"], ["Today", "Today's Jobs"]]) {
    await step(`crew tab ${tab}`, async () => { await clickText(tab); await waitText(expect, 10_000); await sleep(400); await shot("crew-" + tab.toLowerCase()); });
  }
  await step("crew modal: Gear Request", async () => {
    await clickText("Today"); await waitText("Gear Requests");
    await openAndClose("Request", "Request Gear Checkout");
  });
  await step("crew modal: Create Document", async () => {
    await clickText("Invoice"); await waitText("My Invoices");
    await openAndClose("Create Invoice", "Create Document");
  });
  await step("crew: add a production house", async () => {
    const name = "Smoke Test Films " + Date.now().toString().slice(-5);
    await clickText("+ Add");
    await waitText("Add Production House", 5_000);
    await page.type("input[placeholder='e.g. Thai Film Co.']", name);
    await page.type("textarea", "12 Smoke Rd, Bangkok 10100");
    await clickText("Save");
    await sleep(500);
    if (!(await hasText(name))) fail("new production house not listed after Save");
    if (await hasText("Add Production House")) fail("Add Production House modal did not close after Save");
    await shot("crew-prodhouse-added");
    await sleep(3_500); // debounced save
    const kv = await (await fetch(URL + "/api/data")).json();
    if (!(kv.productionCompanies || []).some(c => c.name === name)) fail("new production house was not persisted to KV");
    console.log("  ok  production house persisted");
  });

  // ── errors ───────────────────────────────────────────────────────────────
  const bad = errors.filter(e => !ALLOW.some(rx => rx.test(e)));
  const noise = errors.length - bad.length;
  if (bad.length) { console.error("\nUnexpected errors:\n  " + bad.join("\n  ")); fail(`${bad.length} unexpected page/console error(s)`); }
  console.log(`\nSMOKE PASSED (${shotN} screenshots in ${SHOTS}; ${noise} allowlisted local-only console lines)`);
} catch (e) {
  if (!process.exitCode) { console.error("\nSMOKE FAILED: " + (e && e.message)); process.exitCode = 1; }
} finally {
  await browser.close();
}
