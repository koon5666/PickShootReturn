#!/usr/bin/env node
// Headless walk-through of the inventory-logic flows (availability, conflicts,
// delete guards, dashboard Not Returned + Receive, damage out-of-service, item
// history) against a FRESHLY seeded local server. It MUTATES the seed (cancels
// TVC Toyota, receives the batteries, files a report), so boot a clean state first:
//
//   node tests/local-server.mjs <PORT> ./.wrangler-local --session <you>   (fresh dir)
//   node tests/seed.mjs <PORT>
//   node tests/walk-inventory.mjs <PORT>
//
// Same puppeteer-core / Chrome conventions as tests/smoke.mjs. Screenshots land in
// tests/.walk-shots/ (gitignored). Exit 1 + a clear message on the first failure.
import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const PUPPETEER = process.env.PUPPETEER_CORE
  || "/private/tmp/claude-501/-Users-koonya-inta/bd16a78f-33be-43a8-91b5-db242cf9f6df/scratchpad/puptest/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const { default: puppeteer } = await import(PUPPETEER);
const port = parseInt(process.argv[2], 10);
if (!(port > 0)) { console.error("usage: node tests/walk-inventory.mjs <PORT>"); process.exit(2); }
const URL = `http://127.0.0.1:${port}`;
const SHOTS = resolve(dirname(fileURLToPath(import.meta.url)), ".walk-shots");
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const errors = [];
const dialogs = [];
let dialogAccept = true;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox"] });
let page;
let n = 0;
const shot = async (name) => { const p = `${SHOTS}/${String(++n).padStart(2, "0")}-${name}.png`; await page.screenshot({ path: p, fullPage: true }); console.log("  shot", p); };
const text = () => page.evaluate(() => document.body.innerText);
const expectText = async (t, label) => { const b = (await text()).toLowerCase(); t = String(t); if (!b.includes(t.toLowerCase())) { console.log("  BODY:", b.slice(0, 3000)); throw new Error(`${label || "expected"}: missing "${t}"`); } console.log("  ok:", t); };
const expectNoText = async (t, label) => { const b = (await text()).toLowerCase(); if (b.includes(String(t).toLowerCase())) throw new Error(`${label || "expected absent"}: found "${t}"`); console.log("  ok absent:", t); };
async function clickText(sel, txt, opt = {}) {
  const h = await page.evaluateHandle((sel, txt, exact) => [...document.querySelectorAll(sel)].find(e => exact ? e.innerText.trim() === txt : e.innerText.trim().includes(txt)), sel, txt, !!opt.exact);
  const el = h.asElement();
  if (!el) throw new Error(`no ${sel} with text "${txt}"`);
  await el.click(opt);
  await sleep(opt.wait ?? 350);
}
async function newPage(viewport) {
  if (page) await page.close();
  page = await browser.newPage();
  await page.setViewport(viewport);
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error" && !/api\/session|api\/chat|api\/profile|status of (404|503)/.test(m.text())) errors.push("console: " + m.text()); });
  page.on("dialog", async d => { dialogs.push(d.message()); console.log("  dialog:", d.message().replace(/\n/g, " | ")); if (dialogAccept) await d.accept(); else await d.dismiss(); });
  await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch {} });
  await page.goto(URL, { waitUntil: "networkidle0", timeout: 60_000 });
}
async function adminLogin() {
  await clickText("button", "Admin");
  for (const d of "9999") await clickText("button", d, { wait: 60 });
  await clickText("button", "Unlock", { wait: 1500 });
}
async function goPage(label) { await clickText("nav button, aside button, button", label, { wait: 700 }); }
// Click a button inside the smallest card that mentions `name` (btnText = label, or -N = Nth from the end)
async function clickInCard(name, btnText) {
  const ok = await page.evaluate((name, btnText) => {
    const cards = [...document.querySelectorAll("div")].filter(d => d.innerText.includes(name) && d.querySelector("button")).sort((a, b) => a.innerText.length - b.innerText.length);
    for (const card of cards) {
      const btns = [...card.querySelectorAll("button")];
      const b = typeof btnText === "number" ? btns[btns.length + btnText] : btns.find(x => x.innerText.includes(btnText));
      if (b) { b.click(); return true; }
    }
    return false;
  }, name, btnText);
  if (!ok) throw new Error(`no button ${btnText} in card ${name}`);
  await sleep(600);
}

try {
  console.log("== admin dashboard");
  await newPage({ width: 1280, height: 900 });
  await adminLogin();
  await expectText("Booked today");
  await expectText("Physically out");
  await expectText("5 unit(s) · 2 item(s)");           // FX6 x1 + V-Mount x4
  await expectText("4 × V-Mount 150Wh");
  await expectText("1 × Sony FX6");
  await expectText("OVERDUE 2d");
  await expectText("081-111-1111");                    // Nong's phone from profile
  await expectText("Receive");
  await expectText("picked 3d ago");
  await shot("dashboard");
  // bell popover
  await page.click('[title="Notifications"], button[aria-label="Notifications"]').catch(async () => { await clickText("button", "Notifications").catch(() => {}); });
  await sleep(400);
  const hasOverdue = (await text()).includes("Overdue gear");
  console.log("  notifications popover has 'Overdue gear':", hasOverdue);
  await shot("notif");
  if (!hasOverdue) throw new Error("no Overdue gear row in notifications");
  await page.keyboard.press("Escape"); await sleep(200);

  console.log("== equipment page");
  await goPage("Equipment");
  await expectText("Sony FX6");
  await expectText("CONFLICT -1");                      // RS3: damage report + assigned to Netflix today
  await expectText("Over-booked by 1");
  await expectText("overdue on TVC Toyota since");
  await expectText("out of service (damage report)");
  await shot("equipment");
  // badges: FX6 Unavail, V-Mount 4/8
  const badges = await page.evaluate(() => [...document.querySelectorAll("span")].map(s => s.innerText.trim()).filter(t => /^(\d+\/\d+|Unavail\.|CONFLICT -?\d+)$/.test(t)));
  console.log("  badges:", badges.join(" "));
  if (!badges.includes("4/8")) throw new Error("V-Mount should read 4/8");
  if (!badges.includes("Unavail.")) throw new Error("FX6 should read Unavail.");

  console.log("== equipment delete guard (FX6 has 1 out)");
  dialogAccept = true;
  const cards = await page.$$("div");
  // click the trash button inside the FX6 card
  await page.evaluate(() => {
    const card = [...document.querySelectorAll("div")].find(d => d.innerText.startsWith("Camera\nSony FX6") || (d.innerText.includes("Sony FX6") && d.querySelectorAll("button").length >= 4 && d.innerText.length < 400));
    const btns = card ? [...card.querySelectorAll("button")] : [];
    const del = btns[btns.length - 1]; if (del) del.click();
  });
  await sleep(500);
  if (!dialogs.some(d => d.includes("Can't delete"))) throw new Error("expected delete blocked alert");
  await expectText("Sony FX6", "FX6 still present after blocked delete");

  console.log("== history modal (FX6)");
  await page.evaluate(() => {
    const card = [...document.querySelectorAll("div")].find(d => d.innerText.includes("Sony FX6") && d.querySelectorAll("button").length >= 4 && d.innerText.length < 400);
    const btns = [...card.querySelectorAll("button")]; btns[btns.length - 3].click();
  });
  await sleep(500);
  await expectText("Showing 1 of 1");
  await expectText("Export CSV");
  await shot("history");
  // date filter: a range in the far past → no match
  await page.evaluate(() => { const i = [...document.querySelectorAll('input[type="date"]')]; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(i[0], "2020-01-01"); i[0].dispatchEvent(new Event("input", { bubbles: true })); set.call(i[1], "2020-01-02"); i[1].dispatchEvent(new Event("input", { bubbles: true })); });
  await sleep(300);
  await expectText("No events in this range.");
  await expectText("Showing 0 of 0");
  await shot("history-filtered");
  await clickText("button", "Clear");
  await expectText("Showing 1 of 1");
  // close the modal via its header X (first button inside the fixed overlay)
  await page.evaluate(() => { const h = [...document.querySelectorAll("h3")].find(x => x.innerText.startsWith("History")); h && h.parentElement.querySelector("button").click(); });
  await sleep(300);

  console.log("== jobs: assign modal on Netflix (Confirmed)");
  await goPage("Job Bookings");
  await clickText("button", "Confirmed (");
  await sleep(300);
  await clickInCard("Netflix Series Ep.3", "Assign Gear");
  await expectText("Sony FX6");
  await expectText("1 of 2 free");                       // FX6: own booking excluded, 1 still out on Toyota
  await expectText("4 of 8 free");                       // V-Mount
  await expectText("Grip · Unavailable");                 // RS3: own booking excluded, damaged unit = 0 free
  await expectText("Open damage report on this item");
  await expectText("worst day");
  await shot("assign-netflix");
  await clickText("button", "Cancel", { exact: true });

  console.log("== jobs: Pencil job can hold gear");
  await clickText("button", "Pencil (");
  await sleep(300);
  await expectText("Assign Gear");
  await clickInCard("Music Video Ploy Band", "Assign Gear");
  await expectText("Pencil job: this is a soft hold");
  // assign the tripods x2 to the pencil job
  await clickText("p", "Sachtler Flowtech 75", { exact: true });
  await expectText("Sachtler Flowtech 75 ×1");
  await shot("assign-pencil");
  await clickText("button", "Save Assignment");
  await sleep(800);
  await expectText("1 assigned");

  console.log("== jobs: edit Netflix dates → conflict dialog (RS3 damaged)");
  await clickText("button", "Confirmed (");
  await sleep(300);
  await clickInCard("Netflix Series Ep.3", -2);
  await expectText("Edit Job");
  // add a shoot day: click the first unselected calendar day after the selected ones
  await page.evaluate(() => {
    const cells = [...document.querySelectorAll("div")].filter(d => /^\d{1,2}$/.test(d.innerText.trim()) && d.style.cursor === "pointer");
    const sel = cells.filter(c => c.style.fontWeight === "700");
    const last = sel[sel.length - 1];
    const idx = cells.indexOf(last);
    (cells[idx + 1] || cells[idx - 1]).click();
  });
  await sleep(300);
  await clickText("button", "Save Job", { wait: 600 });
  await expectText("Gear conflict");
  await expectText("DJI RS3 Pro · need 1, 0 free");
  await expectText("out of service (damage report)");
  await shot("job-conflict");
  await clickText("button", "Back to dates");
  await expectNoText("Gear conflict");
  await clickText("button", "Save Job", { wait: 600 });
  await clickText("button", "Save anyway", { wait: 900 });
  await expectNoText("Edit Job", "modal closed after Save anyway");
  await expectText("3 days");

  console.log("== jobs: delete Toyota (gear out) → steer to Cancelled");
  dialogAccept = true;
  await clickInCard("TVC Toyota", -1);
  if (!dialogs.some(d => d.includes("Set this job to Cancelled instead"))) throw new Error("expected cancel-instead confirm");
  await clickText("button", "Cancelled (");
  await sleep(300);
  await expectText("TVC Toyota");
  await shot("jobs-cancelled");

  console.log("== dashboard still lists the cancelled job's gear + Receive");
  await goPage("Dashboard");
  await sleep(500);
  await expectText("4 × V-Mount 150Wh");
  await expectText("TVC Toyota");
  const rowsBefore = await page.$$('[data-testid="stillout-row"]');
  console.log("  still-out rows:", rowsBefore.length);
  // Receive the V-Mounts
  await page.evaluate(() => { const row = [...document.querySelectorAll('[data-testid="stillout-row"]')].find(r => r.innerText.includes("V-Mount")); row.querySelector('[data-testid="receive-btn"]').click(); });
  await sleep(2500);
  if (!dialogs.some(d => d.includes("received back"))) throw new Error("expected receive confirm");
  await expectNoText("4 × V-Mount 150Wh", "V-Mount received");
  await expectText("1 unit(s) · 1 item(s)");
  await shot("dashboard-after-receive");
  // persisted? reload and check
  await page.reload({ waitUntil: "networkidle0" });
  await sleep(800);
  await adminLogin();
  await expectText("1 unit(s) · 1 item(s)", "receive persisted after reload");

  console.log("== equipment: V-Mount back to 8/8");
  await goPage("Equipment");
  const badges2 = await page.evaluate(() => [...document.querySelectorAll("span")].map(s => s.innerText.trim()).filter(t => /^(\d+\/\d+|Unavail\.|CONFLICT -?\d+)$/.test(t)));
  console.log("  badges:", badges2.join(" "));
  if (!badges2.includes("8/8")) throw new Error("V-Mount should be 8/8 after receive");
  await clickText("button", "Reports");
  await sleep(400);
  await expectText("Out of service");
  await clickText("p", "Tilt motor makes", { wait: 400 });
  await expectText("Repair cost");
  await page.type('input[placeholder="0"]', "1500");
  await clickText("button", "Save details");
  await sleep(300);
  await expectText("฿1,500");
  await shot("reports-admin");

  console.log("== crew: Nong");
  await newPage({ width: 390, height: 844 });
  await clickText("button", "Employee Login");
  await clickText("button", "Select account", { wait: 400 });
  await clickText("span", "Nong", { wait: 300, exact: true });
  for (const d of "1111") await clickText("button", d, { wait: 60 });
  await clickText("button", "Unlock", { wait: 1500 });
  await expectText("OVERDUE 2d");
  await expectText("Due");
  await shot("crew-today");
  await clickText("button", "Gear", { wait: 700 });
  await expectText("overdue on TVC Toyota since");
  await shot("crew-gear");
  await clickText("button", "New Report", { wait: 500 });
  await page.select("select", "eq_vmount");
  await sleep(200);
  await expectText("Units affected");
  await expectText("held out of service");
  await expectText("Not on a job");
  await page.evaluate(() => { const i = document.querySelector('input[type="number"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(i, "2"); i.dispatchEvent(new Event("input", { bubbles: true })); });
  const sels = await page.$$("select");
  await sels[1].select("job1");
  await page.type("textarea", "Two batteries swollen");
  await shot("crew-report");
  await clickText("button", "Submit", { wait: 800 });
  await clickText("button", "Back", { wait: 500 }).catch(() => {});
  await sleep(2500);
  await clickText("button", "Today", { wait: 600 });
  await clickText("button", "Request", { wait: 600 });
  // pick a date 3 days ahead: click first enabled future day in the calendar
  await page.evaluate(() => {
    const cells = [...document.querySelectorAll("div")].filter(d => /^\d{1,2}$/.test(d.innerText.trim()) && d.style.cursor === "pointer");
    const today = new Date().getDate();
    const c = cells.find(x => +x.innerText.trim() === today + 3) || cells[cells.length - 1];
    c.click();
  });
  await sleep(400);
  await expectText("1 of 2 free");     // FX6: 1 still out on Toyota
  await expectText("6 of 8 free");     // V-Mount: 2 out of service from the new report
  await shot("crew-request");
  await clickText("button", "Cancel", { wait: 300, exact: true }).catch(() => {});

  console.log("== TH copy check");
  await clickText("button", "TH", { exact: true, wait: 600 });
  await expectText("เกินกำหนด 2 วัน");
  await expectText("กำหนดคืน");
  await shot("crew-today-th");

  if (errors.length) { console.log("PAGE ERRORS:", errors); throw new Error("page errors"); }
  console.log("\nWALK PASSED");
} catch (e) {
  console.error("\nWALK FAILED:", e.message);
  try { await shot("FAIL"); } catch {}
  process.exitCode = 1;
} finally {
  await browser.close();
}
