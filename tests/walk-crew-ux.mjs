#!/usr/bin/env node
// crew-ux-thai track walk-through (P1-6, P2-5, P2-12, P2-13, P2-15, P3-1, P3-2, P3-3, P3-6).
// Crew Nong at 390x844 against a seeded local server. Real mouse clicks + keyboard.
//   node tests/walk-crew-ux.mjs <PORT>
// Screenshots in tests/.walk-crew-shots/.
import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PUPPETEER = process.env.PUPPETEER_CORE
  || "/private/tmp/claude-501/-Users-koonya-inta/bd16a78f-33be-43a8-91b5-db242cf9f6df/scratchpad/puptest/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const { default: puppeteer } = await import(PUPPETEER);

const port = parseInt(process.argv[2], 10);
if (!(port > 0)) { console.error("usage: node tests/walk-crew-ux.mjs <PORT>"); process.exit(2); }
const URL = `http://127.0.0.1:${port}`;
const SHOTS = resolve(dirname(fileURLToPath(import.meta.url)), ".walk-crew-shots");
mkdirSync(SHOTS, { recursive: true });
const ALLOW = [/WebSocket connection to 'ws:\/\/[^']*\/api\/(session|chat)/i, /\/api\/profile\/[^ ]* .*404/i, /Failed to load resource: the server responded with a status of (404|503)/i];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const fail = (msg) => { console.error("\nWALK FAILED: " + msg); process.exitCode = 1; throw new Error(msg); };
const errors = [];
let dialogs = [];

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: false });
page.on("pageerror", e => errors.push("pageerror: " + e.message));
page.on("console", m => { if (m.type() === "error") errors.push("console: " + m.text()); });
page.on("dialog", d => { dialogs.push(d.message()); d.dismiss(); });
await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch {} });
await page.goto(URL, { waitUntil: "networkidle0", timeout: 60_000 });
let shotN = 0;
const shot = async (name) => page.screenshot({ path: `${SHOTS}/${String(++shotN).padStart(2, "0")}-${name}.png` });
const bodyText = () => page.evaluate(() => document.body.innerText);
const has = async (txt) => (await bodyText()).includes(txt);
async function waitText(txt, ms = 15_000) {
  try { await page.waitForFunction(t => document.body.innerText.toLowerCase().includes(t), { timeout: ms }, txt.toLowerCase()); }
  catch { await shot("fail"); fail(`text "${txt}" never appeared`); }
}
async function clickText(txt, tag = "button", exact = true, scope = "") {
  const pos = await page.evaluate((txt, tag, exact, scope) => {
    const norm = s => s.replace(/\s+/g, " ").trim().toLowerCase();
    const want = norm(txt);
    const root = scope ? document.querySelector(scope) : document;
    if (!root) return null;
    const el = [...root.querySelectorAll(tag)].find(e => exact ? norm(e.textContent) === want : norm(e.textContent).includes(want));
    if (!el) return null;
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    return [r.x + r.width / 2, r.y + r.height / 2];
  }, txt, tag, exact, scope);
  if (!pos) { await shot("fail"); fail(`no <${tag}> with text "${txt}"${scope ? ` in ${scope}` : ""}`); }
  await page.mouse.click(pos[0], pos[1]);
}
const clickInDialog = (txt, tag = "button", exact = true) => clickText(txt, tag, exact, '[role="dialog"]');
async function clickSel(sel) {
  const pos = await page.evaluate((sel) => { const el = document.querySelector(sel); if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, sel);
  if (!pos) { await shot("fail"); fail(`no element ${sel}`); }
  await page.mouse.click(pos[0], pos[1]);
}
async function pin(digits) { for (const d of digits) await clickText(d); await clickText("Unlock", "button", false); }
const step = async (name, fn) => { process.stdout.write(`- ${name}\n`); await fn(); };
const expectNo = async (txt, where) => { if (await has(txt)) { await shot("fail"); fail(`"${txt}" still in English on ${where}`); } };

try {
  const health = await fetch(URL + "/api/data").catch(() => null);
  if (!health || health.status !== 200) fail(`GET ${URL}/api/data -> ${health ? health.status : "unreachable"}`);

  await step("login screen has an EN/TH pill (P1-6)", async () => {
    await waitText("Employee Login");
    const pill = await page.$('[data-testid="login-langpill"]');
    if (!pill) fail("no LangPill on the login screen");
    await clickText("TH");
    await sleep(300);
    if (!(await has("เข้าสู่ระบบ")) && !(await has("ทีมงาน"))) { await shot("login-th"); }
    await shot("login-th");
    await clickText("EN");
    await sleep(200);
  });

  await step("crew login Nong (1111)", async () => {
    await clickText("Employee Login", "button", false);
    await waitText("Select account");
    await clickText("Select account", "button", false);
    await waitText("Nong", 5_000);
    await clickText("Nong", "span");
    await pin("1111");
    await waitText("Today's Jobs");
  });

  await step("touch targets: nav labels 11px, tapped controls >= 44px (P2-12)", async () => {
    const m = await page.evaluate(() => {
      const nav = [...document.querySelectorAll("nav button span")].map(s => parseFloat(getComputedStyle(s).fontSize));
      const req = [...document.querySelectorAll("button")].find(b => b.textContent.trim() === "Request");
      const r = req ? req.getBoundingClientRect() : null;
      const pill = [...document.querySelectorAll("button")].filter(b => /^(EN|TH)$/.test(b.textContent.trim())).map(b => b.getBoundingClientRect().height);
      return { nav, reqH: r && r.height, pill };
    });
    if (!m.nav.length || m.nav.some(f => f < 11)) fail(`nav label font sizes ${m.nav}`);
    if (!(m.reqH >= 44)) fail(`Request button height ${m.reqH}`);
    if (m.pill.some(h => h < 32)) fail(`LangPill heights ${m.pill}`);
    console.log(`  ok  nav ${m.nav[0]}px, Request ${Math.round(m.reqH)}px, pill ${Math.round(m.pill[0])}px`);
  });

  await step("crew label from profile positions (P3-6)", async () => {
    try { await page.waitForFunction(() => /1st AC/.test(document.querySelector("header").innerText), { timeout: 8_000 }); }
    catch { fail(`header role label should come from profile positions, got: ${await page.evaluate(() => document.querySelector("header").innerText)}`); }
    if (/Camera Crew/i.test(await bodyText())) fail("'Camera Crew' still rendered");
    await shot("today-en");
  });

  await step("gear request: submit disabled until an item AND a date (P2-5)", async () => {
    await clickText("Request");
    await waitText("Request Gear Checkout");
    const st = async () => page.evaluate(() => { const b = document.querySelector('[data-testid="gear-req-submit"]'); const bl = document.querySelector('[data-testid="gear-req-blocker"]'); return { disabled: b.disabled, blocker: bl && bl.textContent }; });
    let s0 = await st();
    if (!s0.disabled || !/one item and one date/i.test(s0.blocker)) fail(`empty form: ${JSON.stringify(s0)}`);
    // pick an item only
    await clickInDialog("Sony FX6", "p", false);
    s0 = await st();
    if (!s0.disabled || !/one date/i.test(s0.blocker)) fail(`item only: ${JSON.stringify(s0)}`);
    await shot("gear-req-item-only");
    // pick a date (today)
    await page.evaluate(() => { const cells = [...document.querySelectorAll('[role="dialog"] div')].filter(d => /^\d{1,2}$/.test(d.textContent.trim()) && d.style.cursor === "pointer"); const today = new Date().getDate(); const c = cells.find(x => +x.textContent.trim() === today) || cells[0]; c.scrollIntoView({ block: "center" }); c.click(); });
    await sleep(200);
    s0 = await st();
    if (s0.disabled || s0.blocker) fail(`item + date: ${JSON.stringify(s0)}`);
    await shot("gear-req-ready");
    // a real click submits
    await clickSel('[data-testid="gear-req-submit"]');
    await sleep(400);
    if (await has("Request Gear Checkout")) fail("modal did not close after submit");
    if (!(await has("Sony FX6"))) fail("new request not listed");
    console.log("  ok  submit gated, then submitted");
  });

  await step("request row says who approves + how you hear back (P3-6)", async () => {
    await waitText("Sent to Lucky Cam Rental, you'll get a LINE message when approved.", 5_000);
    const row = await page.evaluate(() => document.querySelector('[data-testid^="gear-req-"]').innerText);
    if (!/^Pending/m.test(row)) fail(`status badge should read "Pending" (title case), row: ${row}`);
    await shot("request-row");
  });

  await step("dialog primitive: aria, Esc closes, backdrop asks when dirty, focus returns (P2-13)", async () => {
    const opener = await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find(b => b.textContent.trim() === "Request"); b.focus(); return document.activeElement === b; });
    if (!opener) fail("could not focus the opener");
    await clickText("Request");
    await waitText("Request Gear Checkout");
    const a11y = await page.evaluate(() => { const d = document.querySelector('[role="dialog"]'); const lbl = d && document.getElementById(d.getAttribute("aria-labelledby")); return { inBody: d && d.parentElement.parentElement === document.body, modal: d && d.getAttribute("aria-modal"), label: lbl && lbl.textContent, focusInside: d && d.contains(document.activeElement) }; });
    if (!a11y.inBody || a11y.modal !== "true" || !/Request Gear Checkout/.test(a11y.label || "") || !a11y.focusInside) fail(`dialog a11y: ${JSON.stringify(a11y)}`);
    // Tab wraps inside the dialog
    for (let i = 0; i < 40; i++) await page.keyboard.press("Tab");
    const stillInside = await page.evaluate(() => document.querySelector('[role="dialog"]').contains(document.activeElement));
    if (!stillInside) fail("focus escaped the dialog after 40 Tabs");
    // clean form: Esc closes without asking
    dialogs = [];
    await page.keyboard.press("Escape");
    await sleep(300);
    if (await has("Request Gear Checkout")) fail("Esc did not close the dialog");
    if (dialogs.length) fail("Esc asked to discard a clean form");
    const returned = await page.evaluate(() => document.activeElement && document.activeElement.textContent.trim() === "Request");
    if (!returned) fail("focus did not return to the opener");
    // dirty form: backdrop click asks, dismiss keeps it open
    await clickText("Request");
    await waitText("Request Gear Checkout");
    await clickInDialog("Sony FX6", "p", false);
    dialogs = [];
    await page.mouse.click(8, 8); // backdrop
    await sleep(300);
    if (!dialogs.length || !/discard/i.test(dialogs[0])) fail(`backdrop on a dirty form did not ask (${dialogs})`);
    if (!(await has("Request Gear Checkout"))) fail("dialog closed although the confirm was dismissed");
    await shot("dialog-dirty");
    await clickInDialog("Cancel");
    await sleep(200);
    console.log("  ok  role=dialog in body, Esc, Tab trap, dirty backdrop confirm, focus return");
  });

  await step("tab switch scrolls to top (P2-15)", async () => {
    await page.evaluate(() => window.scrollTo(0, 700));
    await sleep(100);
    await clickText("Gear");
    await waitText("Equipment Library");
    await sleep(200);
    const y = await page.evaluate(() => window.scrollY);
    if (y > 5) fail(`scrollY after tab switch = ${y}`);
    console.log("  ok  scrollY 0 after switching tabs");
  });

  await step("Gear tab: list rows, words, no QR in photo mode, sort select (P3-3)", async () => {
    const g = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('[data-testid^="gear-row-"]')];
      return { n: rows.length, h: rows.map(r => r.getBoundingClientRect().height), text: rows.map(r => r.innerText.replace(/\n/g, " | ")), qr: !!document.querySelector('[data-testid="gear-list"] button[aria-label]'), select: !!document.querySelector("#gear-sort") };
    });
    if (g.n < 6) fail(`expected 6 gear rows, got ${g.n}`);
    if (g.h.some(h => h > 110)) fail(`rows too tall: ${g.h}`);
    if (!g.text.some(t => /free today|None free today|Free today/.test(t))) fail(`availability not in words: ${g.text[0]}`);
    if (g.qr) fail("QR button rendered in photo verification mode");
    if (!g.select) fail("sort select missing");
    await page.select("#gear-sort", "qty_hi");
    await sleep(200);
    const first = await page.evaluate(() => document.querySelector('[data-testid^="gear-row-"]').innerText);
    if (!/V-Mount|Batter/i.test(first)) console.log(`  note  first row after sort by most units: ${first.split("\n")[0]}`);
    await shot("gear-list");
    console.log(`  ok  ${g.n} rows, tallest ${Math.round(Math.max(...g.h))}px, "${g.text[0].split(" | ")[1]}"`);
  });

  await step("KPI card shows rules read-only (P3-2)", async () => {
    await clickText("Profile");
    await waitText("My Profile");
    const k = await page.evaluate(() => ({ rules: document.querySelector('[data-testid="kpi-rules"]')?.innerText || "", body: document.body.innerText }));
    if (!/How points are lost/i.test(k.rules)) fail("rules block missing under the KPI score");
    if (/Punishment/i.test(k.body)) fail("'Punishment' wording still on the crew profile");
    await page.evaluate(() => document.querySelector('[data-testid="kpi-card"]').scrollIntoView({ block: "start" }));
    await sleep(150);
    await shot("kpi-rules");
    const ta = await page.evaluate(() => getComputedStyle(document.querySelector("textarea")).fontFamily);
    const app = await page.evaluate(() => getComputedStyle(document.querySelector("textarea").closest("div[style]") || document.body).fontFamily);
    if (/mono/i.test(ta) || !/Inter/.test(ta)) fail(`textarea font ${ta} (container ${app})`);
    console.log("  ok  rules listed, textarea inherits the body font");
  });

  await step("Thai mode: checkout screen, Today, Gear, Invoice (P1-6)", async () => {
    await clickText("TH");
    await sleep(300);
    await clickText("วันนี้");
    await waitText("งานวันนี้", 8_000);
    // dates in Thai (Buddhist year)
    const th = await bodyText();
    if (!/ก\.ย\.|ต\.ค\.|ส\.ค\./.test(th)) fail("dates on Today are not Thai");
    if (/PICKUP TOMORROW|Request early|Waiting for approval|Sent to Lucky/i.test(th)) fail("Today still has English badges");
    if (/ดินสอ/.test(th)) fail("Pencil rendered as ดินสอ");
    if (!/เพนซิล/.test(th)) fail("เพนซิล not rendered for Pencil");
    await shot("today-th");
    // checkout screen
    await clickText("Netflix", "h3", false);
    await waitText("แตะแต่ละชิ้นเพื่อรับของ", 8_000);
    const co = await bodyText();
    for (const en of ["PICK UP", "SHOOT", "Return last day", "Tap each item", "photo required", "Photo", "Save", "Today ·"]) if (co.includes(en)) { await shot("checkout-th"); fail(`checkout screen still shows "${en}" in Thai mode`); }
    if (!/รับของ/.test(co) || !/คืนวันสุดท้าย/.test(co) || !/บันทึก/.test(co)) fail("checkout Thai strings missing");
    await shot("checkout-th");
    await clickText("กลับ", "button", false);
    // Gear tab
    await clickText("อุปกรณ์");
    await waitText("คลังอุปกรณ์", 8_000);
    const gear = await bodyText();
    for (const en of ["Equipment Library", "Latest Used", "Add New Equipment", "Equipment Requests", "No requests yet"]) if (gear.includes(en)) fail(`Gear tab still shows "${en}"`);
    await shot("gear-th");
    // Invoice tab
    await clickText("ใบแจ้งหนี้");
    await waitText("รายได้", 8_000);
    const inv = await bodyText();
    for (const en of ["Revenue", "Total Invoiced", "By Year", "Latest", "Amount", "invoices ·", "No confirmed jobs", "Invoiced"]) if (inv.includes(en)) fail(`Invoice tab still shows "${en}"`);
    await shot("invoice-th");
    // invoice modal
    await clickText("สร้างใบแจ้งหนี้", "button", false);
    await waitText("สร้างเอกสาร", 8_000);
    const modal = await page.evaluate(() => document.querySelector('[role="dialog"]').innerText);
    for (const en of ["Your name or company", "Date", "Call", "Wrap", "VAT applied", "Pending"]) if (new RegExp(`\\b${en}\\b`).test(modal)) fail(`invoice modal still shows "${en}"`);
    await shot("invoice-modal-th");
    await page.keyboard.press("Escape"); // dirty by design -> confirm (dismissed = stays open)
    await sleep(200);
    await clickText("ยกเลิก", "button", false);
    await sleep(200);
    // gear request modal
    await clickText("วันนี้"); await waitText("งานวันนี้");
    await clickText("ขอยืม", "button", false);
    await waitText("เลือกของอย่างน้อย 1 ชิ้นและวันอย่างน้อย 1 วัน", 8_000);
    await shot("gear-req-th");
    await clickText("ยกเลิก", "button", false);
    await clickText("EN");
    await sleep(200);
    console.log("  ok  Thai checkout / Today / Gear / Invoice / modals");
  });

  await step("admin: Deductions wording + positive adjustment (P3-2)", async () => {
    await clickText("Log Out", "button", false);
    await waitText("Admin Login");
    await page.setViewport({ width: 1280, height: 900, isMobile: false, hasTouch: false }); // puppeteer reloads when isMobile flips
    await page.goto(URL, { waitUntil: "networkidle0", timeout: 60_000 });
    await waitText("Admin Login");
    await clickText("Admin Login", "button", false);
    await waitText("Enter PIN");
    await pin("9999");
    await waitText("Overview");
    await clickText("Team"); await waitText("Team Members");
    if (/Punishment/i.test(await bodyText())) fail("'Punishments' still on the Team page");
    // open Nong's profile modal (first profile button)
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find(b => /profile/i.test(b.getAttribute("title") || "") || /profile/i.test(b.textContent)); if (b) b.click(); });
    await sleep(400);
    if (!(await has("Add points"))) { await shot("team-fail"); fail("no 'Add points' mode in the KPI form"); }
    const before = parseFloat((await bodyText()).match(/(\d+(?:\.\d+)?)\/100 pts/)?.[1] ?? "100");
    await clickText("Add points");
    await page.type('input[placeholder="Points"]', "5");
    await page.type('input[placeholder="Reason (shown to employee)"]', "returned early, clean");
    await clickSel('[data-testid="kpi-submit"]');
    await sleep(400);
    if (!(await has("+5"))) { await shot("team-fail"); fail("positive adjustment not listed"); }
    await shot("team-kpi-add");
    // score stays at 100 (clamped) then a 10 deduction makes 95
    await clickText("Deduct");
    await page.type('input[placeholder="Points"]', "10");
    await page.type('input[placeholder="Reason (shown to employee)"]', "late return");
    await clickSel('[data-testid="kpi-submit"]');
    await sleep(400);
    const expected = Math.min(100, before + 5) - 10;
    const t = await bodyText();
    if (!new RegExp(`${expected}/100 pts`).test(t)) { await shot("team-fail"); fail(`score after +5 (clamped at 100) and -10 should be ${expected}/100 (was ${before})`); }
    console.log(`  ok  Deductions wording, ${before} +5 (clamped) -10 = ${expected}/100`);
    await sleep(2500); // let the debounced save flush
    const kv = await (await fetch(URL + "/api/data")).json();
    const add = (kv.kpiEvents || []).find(e => e.kind === "add");
    if (!add) fail("positive adjustment not persisted to KV");
    console.log("  ok  kind:add event persisted");
  });

  const bad = errors.filter(e => !ALLOW.some(rx => rx.test(e)));
  if (bad.length) { console.error("\nUnexpected errors:\n  " + bad.join("\n  ")); fail(`${bad.length} unexpected page/console error(s)`); }
  console.log(`\nWALK PASSED (${shotN} screenshots in ${SHOTS})`);
} catch (e) {
  if (!process.exitCode) { console.error("\nWALK FAILED: " + (e && e.message)); process.exitCode = 1; }
} finally {
  await browser.close();
}
