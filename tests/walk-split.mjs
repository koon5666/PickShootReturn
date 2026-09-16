#!/usr/bin/env node
// P3-8 code split walk-through: the crew portal, the admin pages, the document
// views and the settings panel are lazy chunks (src/views/*.jsx behind
// React.lazy in App.jsx). Real Chrome, real mouse clicks, against a seeded local
// server (tests/local-server.mjs + tests/seed.mjs default profile).
//
//   node tests/walk-split.mjs <PORT>
//
//   1. admin 1280x900: login -> Dashboard renders from the admin chunk; the crew
//      chunk is NEVER fetched; Documents (invoice chunk) and Settings (settings
//      chunk) open; every page of the sidebar renders with no "Loading…" left
//   2. crew 390x844: login -> Today from the crew chunk; the admin + settings
//      chunks are NEVER fetched; Create Document opens (invoice chunk, imported
//      by the crew chunk); no page error, no console error
//   3. failed chunk: with the settings chunk blocked at the network, the first
//      open reloads the page once (vite:preloadError hook in main.jsx), the
//      second open shows the view boundary card with a Reload button instead
//      of a blank screen
// Screenshots in tests/.split-shots/ (gitignored).
import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PUPPETEER = process.env.PUPPETEER_CORE
  || "/private/tmp/claude-501/-Users-koonya-inta/bd16a78f-33be-43a8-91b5-db242cf9f6df/scratchpad/puptest/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const { default: puppeteer } = await import(PUPPETEER);

const port = parseInt(process.argv[2], 10);
if (!(port > 0)) { console.error("usage: node tests/walk-split.mjs <PORT>"); process.exit(2); }
const URL = `http://127.0.0.1:${port}`;
const SHOTS = resolve(dirname(fileURLToPath(import.meta.url)), ".split-shots");
mkdirSync(SHOTS, { recursive: true });
const ALLOW = [/ws:\/\/[^']*\/api\/(session|chat)/i, /\/api\/profile\/[^ ]* .*404/i, /Failed to load resource: the server responded with a status of (404|503)/i];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const fail = (m) => { console.error("\nSPLIT WALK FAILED: " + m); process.exitCode = 1; throw new Error(m); };
let shotN = 0;
const errors = [];
const chunks = new Set(); // asset chunk names fetched by the current page
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox"] });
let page;
let blockSettingsChunk = false;

async function newPage(viewport) {
  if (page) await page.close();
  page = await browser.newPage();
  await page.setViewport(viewport);
  chunks.clear();
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("console", async m => {
    if (m.type() !== "error") return;
    // an Error object argument prints as JSHandle@error: resolve its message so the allowlist can judge it
    const parts = await Promise.all(m.args().map(a => a.evaluate(v => (v && v.message) ? v.message : String(v)).catch(() => m.text())));
    const text = parts.join(" ") || m.text();
    if (!ALLOW.some(re => re.test(text))) errors.push("console: " + text);
  });
  page.on("request", r => { const m = r.url().match(/\/assets\/([a-zA-Z0-9-]+?)-[\w-]+\.js$/); if (m) chunks.add(m[1]); });
  page.on("response", r => { if (r.status() >= 400 && !/\/api\/session|\/api\/profile\//.test(r.url())) errors.push(`http ${r.status()} ${r.url()}`); });
  await page.setRequestInterception(true);
  page.on("request", r => { if (blockSettingsChunk && /\/assets\/settings-[\w-]+\.js$/.test(r.url())) r.abort(); else r.continue(); });
  // fresh first run only: window.name survives the reload the failed-chunk step expects, sessionStorage must too
  await page.evaluateOnNewDocument(() => { if (window.name === "psr-split-walk") return; try { localStorage.clear(); sessionStorage.clear(); } catch {} window.name = "psr-split-walk"; });
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
async function pin(digits) { for (const d of digits) await clickText(d); await clickText("Unlock", "button", false); }
const step = async (name, fn) => { process.stdout.write(`- ${name}\n`); await fn(); };
const noLoading = async () => { if (await hasText("Loading…")) { await shot("fail"); fail("a Loading… fallback is still on screen"); } };
const assertErrors = (where) => { if (errors.length) { console.error(errors.join("\n")); fail(`errors during ${where}`); } };

try {
  await step("admin: login, dashboard from the admin chunk, crew chunk never fetched", async () => {
    await newPage({ width: 1280, height: 900 });
    await waitText("Crew / ทีมงาน");
    if ([...chunks].some(c => /^(crew|admin|invoice|settings)$/.test(c))) fail("a view chunk was fetched before login: " + [...chunks].join(","));
    await clickText("Rental house admin", "button", false);
    await waitText("Enter PIN");
    await pin("9999");
    await waitText("Overview");
    await sleep(600);
    await noLoading();
    await shot("admin-dashboard");
    if (!chunks.has("admin")) fail("admin chunk not fetched: " + [...chunks].join(","));
    if (chunks.has("crew")) fail("an admin session fetched the crew chunk");
    console.log("  ok  chunks so far:", [...chunks].join(", "));
  });
  await step("admin: every sidebar page renders, Documents = invoice chunk", async () => {
    for (const [nav, expect] of [["Equipment", "Equipment Library"], ["Job Bookings", "Job Bookings"], ["Invoice", "Invoice"], ["Team", "Team"], ["Checkout", "Active Jobs"], ["Insights", "Utilisation"], ["Dashboard", "Overview"]]) {
      await clickText(nav); await waitText(expect, 10_000); await sleep(350); await noLoading();
    }
    await clickText("Invoice"); await waitText("Invoice"); await sleep(400);
    await shot("admin-invoice");
    if (!chunks.has("invoice")) fail("invoice chunk not fetched on the Documents page");
    if (chunks.has("crew")) fail("an admin session fetched the crew chunk");
    console.log("  ok  invoice chunk loaded, pages render");
  });
  await step("admin: Settings = settings chunk, opens and closes", async () => {
    await clickText("Settings"); await waitText("Navigation Order", 8_000); await sleep(300); await noLoading();
    await shot("admin-settings");
    if (!chunks.has("settings")) fail("settings chunk not fetched");
    await page.keyboard.press("Escape"); await sleep(300);
    if (await hasText("Navigation Order")) { // no Escape handler: use the close button next to the heading
      const pos = await page.evaluate(() => { const h = [...document.querySelectorAll("h1,h2,h3")].find(e => /settings/i.test(e.textContent)); let n = h && h.parentElement; for (let i = 0; i < 4 && n; i++, n = n.parentElement) { const b = [...n.querySelectorAll("button")].find(b => b.textContent.trim() === "" && b.querySelector("svg")); if (b) { const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; } } return null; });
      if (pos) await page.mouse.click(pos[0], pos[1]);
      await sleep(300);
    }
    console.log("  ok  chunks:", [...chunks].join(", "));
    await clickText("Log out"); await waitText("Crew / ทีมงาน");
  });
  assertErrors("admin walk");

  await step("crew: login, Today from the crew chunk, admin + settings chunks never fetched", async () => {
    await newPage({ width: 390, height: 844, isMobile: true, hasTouch: false });
    await waitText("Crew / ทีมงาน");
    await clickText("Crew / ทีมงาน", "button", false);
    await waitText("Select account");
    await clickText("Select account", "button", false);
    await waitText("Nong", 5_000);
    await clickText("Nong", "span");
    await pin("1111");
    await waitText("Today's Jobs");
    await sleep(600);
    await noLoading();
    await shot("crew-today");
    if (!chunks.has("crew")) fail("crew chunk not fetched");
    if (chunks.has("admin") || chunks.has("settings")) fail("a crew session fetched an admin chunk: " + [...chunks].join(","));
    await clickText("Invoice"); await waitText("My Invoices");
    await clickText("Create Invoice"); await waitText("Create Document", 8_000); await sleep(300);
    await shot("crew-create-document");
    if (!chunks.has("invoice")) fail("invoice chunk not loaded for the crew document modal");
    console.log("  ok  chunks:", [...chunks].join(", "));
    await page.evaluate(() => fetch("/api/logout", { method: "POST" })); // one browser = one cookie jar
  });
  assertErrors("crew walk");

  await step("failed chunk: settings blocked -> one reload, then the view boundary card", async () => {
    blockSettingsChunk = true;
    await newPage({ width: 1280, height: 900 });
    await waitText("Crew / ทีมงาน");
    await clickText("Rental house admin", "button", false);
    await waitText("Enter PIN");
    await pin("9999");
    await waitText("Overview");
    await sleep(2500); // let the idle prefetch fail quietly
    const reloaded = page.waitForNavigation({ waitUntil: "networkidle0", timeout: 20_000 }).then(() => true).catch(() => false);
    await clickText("Settings");
    if (!(await reloaded)) { await shot("fail"); fail("first failed chunk load did not reload the page"); }
    await waitText("Overview"); // session cookie survives the reload
    await sleep(2500);
    await clickText("Settings");
    await waitText("could not load", 10_000);
    await shot("chunk-failed-boundary");
    if (!(await hasText("Reload"))) fail("boundary card has no Reload button");
    if (!(await hasText("Overview"))) fail("the admin shell disappeared behind the boundary");
    blockSettingsChunk = false;
    // the boundary's Reload brings the panel back once the chunk is reachable again
    const nav = page.waitForNavigation({ waitUntil: "networkidle0", timeout: 20_000 }).catch(() => {});
    await clickText("Reload");
    await nav;
    await waitText("Overview");
    await clickText("Settings"); await waitText("Navigation Order", 8_000);
    await shot("settings-after-reload");
    console.log("  ok  reload once, then the boundary card; Reload recovers");
  });
  // the blocked chunk logs aborted-fetch console errors by design: drop those
  await sleep(300);
  // (a bare "JSHandle@error" is React's boundary log whose Error argument could not be read because the page reloaded right after)
  const real = errors.filter(e => !/settings-[\w-]+\.js|Failed to fetch dynamically imported module|net::ERR_FAILED|Loading chunk|view failed to load|view chunk missing|Importing a module script failed|Unable to preload|^console: JSHandle@error$/i.test(e));
  if (real.length) { console.error(real.join("\n")); fail("unexpected errors during the failed-chunk step"); }
  console.log("\nSPLIT WALK PASSED (screenshots in " + SHOTS + ")");
} finally {
  await browser.close();
}
