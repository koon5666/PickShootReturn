#!/usr/bin/env node
// Auth track walk-through (P0-2, P2-6, P2-8, P2-10) against a LOCAL, FRESHLY
// SEEDED server (tests/local-server.mjs on a fresh --persist-to dir + tests/seed.mjs).
// Real Chrome, real mouse events, screenshots in tests/.auth-shots/.
//
//   node tests/walk-auth.mjs <PORT>
//
// Covers: login screen layout (crew primary, admin link, LangPill, PIN hint),
// server lockout after 5 wrong PINs, admin never sees a PIN (Settings / Team /
// Approvals), staff accounts + actor stamps, register with contact -> pending
// state -> approve -> approved state, crew PIN self-change, a crew page cannot
// PUT another crew's invoice, httpOnly cookie, logout really ends the session.
import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { apiClient } from "./apiclient.mjs";

const PUPPETEER = process.env.PUPPETEER_CORE
  || "/private/tmp/claude-501/-Users-koonya-inta/bd16a78f-33be-43a8-91b5-db242cf9f6df/scratchpad/puptest/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const { default: puppeteer } = await import(PUPPETEER);

const port = parseInt(process.argv[2], 10);
if (!(port > 0)) { console.error("usage: node tests/walk-auth.mjs <PORT>"); process.exit(2); }
const URL = `http://127.0.0.1:${port}`;
const SHOTS = resolve(dirname(fileURLToPath(import.meta.url)), ".auth-shots");
mkdirSync(SHOTS, { recursive: true });

const ALLOW = [
  /WebSocket connection to 'ws:\/\/[^']*\/api\/(session|chat)/i,
  /\/api\/profile\/[^ ]* .*404/i,
  /Failed to load resource: the server responded with a status of (401|404|429|503)/i,
];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const fail = (msg) => { console.error("\nAUTH WALK FAILED: " + msg); process.exitCode = 1; throw new Error(msg); };
let shotN = 0;
const errors = [];
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox"] });
let page;
// One browser = one cookie jar: a new page for another persona first ends the
// current session (POST /api/logout) unless keepSession is set.
async function newPage(viewport, { keepStorage = false, keepSession = false } = {}) {
  if (page) {
    if (!keepSession) { try { await page.evaluate(() => fetch("/api/logout", { method: "POST" })); } catch {} }
    await page.close();
  }
  page = await browser.newPage();
  await page.setViewport(viewport);
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error") errors.push("console: " + m.text()); });
  page.on("response", r => { if (r.status() >= 400 && !/\/api\/(session|profile\/|login|pin|register)/.test(r.url())) errors.push(`http ${r.status()} ${r.url()}`); });
  if (!keepStorage) await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch {} });
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
// Last matching element (a modal renders after the page, so its button wins).
async function clickLastText(txt, tag = "button") {
  const pos = await page.evaluate((txt, tag) => {
    const norm = s => s.replace(/\s+/g, " ").trim().toLowerCase();
    const els = [...document.querySelectorAll(tag)].filter(e => norm(e.textContent) === norm(txt));
    const el = els[els.length - 1];
    if (!el) return null;
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    return [r.x + r.width / 2, r.y + r.height / 2];
  }, txt, tag);
  if (!pos) { await shot("fail"); fail(`no <${tag}> with text "${txt}"`); }
  await page.mouse.click(pos[0], pos[1]);
}
async function typeInto(selector, text, { clear = true } = {}) {
  const el = await page.$(selector);
  if (!el) { await shot("fail"); fail(`no element ${selector}`); }
  await el.click({ clickCount: clear ? 3 : 1 });
  if (clear) await page.keyboard.press("Backspace");
  await el.type(text);
}
// nth input inside the card whose section title matches
async function typeInCard(title, inputIndex, text) {
  const ok = await page.evaluate((title, i, text) => {
    const norm = s => s.replace(/\s+/g, " ").trim().toLowerCase();
    const p = [...document.querySelectorAll("p")].find(e => norm(e.textContent) === norm(title));
    if (!p) return false;
    const card = p.parentElement;
    const inp = card.querySelectorAll("input")[i];
    if (!inp) return false;
    inp.focus(); inp.setAttribute("data-walk", "target");
    return true;
  }, title, inputIndex, text);
  if (!ok) { await shot("fail"); fail(`no input #${inputIndex} in card "${title}"`); }
  await typeInto("input[data-walk='target']", text);
  await page.evaluate(() => document.querySelector("input[data-walk='target']")?.removeAttribute("data-walk"));
}
async function pin(digits) { for (const d of digits) await clickText(d); await clickText("Unlock", "button", false); }
// Close the full-screen Settings panel by its header close (icon-only) button.
async function closeSettings() {
  const pos = await page.evaluate(() => {
    const h = [...document.querySelectorAll("h1,h2,h3")].find(e => e.textContent.trim().toLowerCase() === "settings");
    if (!h) return null;
    let n = h.parentElement;
    for (let i = 0; i < 4 && n; i++, n = n.parentElement) {
      const b = [...n.querySelectorAll("button")].find(x => x.textContent.trim() === "" && x.querySelector("svg"));
      if (b) { const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }
    }
    return null;
  });
  if (!pos) { await shot("fail"); fail("no Settings close button"); }
  await page.mouse.click(pos[0], pos[1]);
  await sleep(400);
}
const step = async (name, fn) => { process.stdout.write(`- ${name}\n`); await fn(); };
const admin = apiClient(URL);

try {
  if ((await fetch(URL + "/api/public")).status !== 200) fail("no server; boot + seed first");
  await admin.loginAdmin("9999").catch(e => fail("owner 9999 login failed (fresh seed needed): " + e.message));

  // ── P2-10 login screen ───────────────────────────────────────────────────
  await step("login screen: crew primary, admin link, hint, LangPill, TH", async () => {
    await newPage({ width: 390, height: 844, isMobile: true });
    await waitText("Crew / ทีมงาน");
    const txt = await bodyText();
    if (!/Your PIN comes from the rental house/i.test(txt)) fail("PIN hint missing");
    if (!/Rental house admin/i.test(txt)) fail("admin link missing");
    const order = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].map(x => x.textContent.trim());
      return { crew: b.findIndex(t => t.includes("Crew / ทีมงาน")), admin: b.findIndex(t => t.includes("Rental house admin")), en: b.includes("EN"), th: b.includes("TH") };
    });
    if (!(order.crew >= 0 && order.admin > order.crew && order.en && order.th)) fail("login button order / LangPill wrong: " + JSON.stringify(order));
    const primaryBg = await page.evaluate(() => getComputedStyle([...document.querySelectorAll("button")].find(x => x.textContent.includes("Crew / ทีมงาน"))).backgroundColor);
    if (primaryBg !== "rgb(37, 99, 235)") fail("crew button is not the primary (bg " + primaryBg + ")");
    await shot("login-choose-en");
    await clickText("TH");
    await sleep(300);
    if (!(await hasText("PIN ขอได้จากทางร้านเช่า"))) fail("Thai hint not rendered after TH");
    await shot("login-choose-th");
    await clickText("EN");
    if (await hasText("psr_session")) fail("?");
    const cookie = await page.evaluate(() => document.cookie);
    if (/psr_session/.test(cookie)) fail("session cookie readable by script (must be httpOnly)");
  });

  // ── server lockout ───────────────────────────────────────────────────────
  await step("5 wrong crew PINs -> server lockout countdown", async () => {
    await clickText("Crew / ทีมงาน", "button", false);
    await waitText("Select account");
    await clickText("Select account", "button", false);
    await waitText("Arthit", 5_000);
    await clickText("Arthit", "span");
    for (let i = 0; i < 4; i++) { await pin("0000"); await sleep(350); }
    if (!(await hasText("Incorrect PIN"))) fail("no incorrect-PIN feedback");
    await pin("0000"); await sleep(600);
    if (!(await hasText("Too many attempts"))) fail("no lockout after 5 failures");
    await shot("login-lockout");
    // a reload does NOT reset it (the limit is in KV, not in React state)
    await page.reload({ waitUntil: "networkidle0" });
    await waitText("Crew / ทีมงาน");
    await clickText("Crew / ทีมงาน", "button", false);
    await clickText("Select account", "button", false); await waitText("Arthit", 5_000); await clickText("Arthit", "span");
    await pin("2222"); await sleep(600);
    if (!(await hasText("Too many attempts"))) fail("lockout did not survive a reload");
    await shot("login-lockout-after-reload");
  });

  // ── admin: no PIN anywhere, staff, team, approvals ───────────────────────
  await step("admin login (owner 9999) -> Settings: no PIN shown, staff accounts", async () => {
    await newPage({ width: 1280, height: 900 });
    await waitText("Crew / ทีมงาน");
    await clickText("Rental house admin", "button", false);
    await waitText("Enter PIN");
    if (await hasText("Admin account")) fail("staff dropdown shown although no staff exist yet");
    await pin("9999");
    await waitText("Overview");
    await clickText("Settings"); await waitText("Admin accounts", 8_000);
    const txt = await bodyText();
    if (/9999|Current admin PIN/i.test(txt)) fail("Settings shows the admin PIN");
    if (!/My PIN/i.test(txt) || !/Current PIN/i.test(txt)) fail("My PIN section (with current PIN field) missing");
    await page.evaluate(() => { const p = [...document.querySelectorAll("p")].find(e => e.textContent.trim() === "Admin accounts"); p && p.scrollIntoView({ block: "start" }); });
    await shot("settings-staff-before");
    // owner display name
    await typeInCard("Admin accounts", 0, "Somchai");
    await page.keyboard.press("Tab");
    await sleep(700);
    // add counter staff Bee 2468
    await typeInCard("Admin accounts", 1, "Bee");
    await typeInCard("Admin accounts", 2, "2468");
    await typeInCard("Admin accounts", 3, "2468");
    await clickText("Add account");
    await waitText("Account added", 5_000);
    await shot("settings-staff-added");
    const staff = await admin.get("/api/staff");
    if (!staff.staff.some(s => s.name === "Bee" && s.role === "counter") || !staff.staff.some(s => s.id === "owner" && s.name === "Somchai")) fail("staff not stored: " + JSON.stringify(staff));
    if (JSON.stringify(staff).includes("pinHash")) fail("staff endpoint leaks pinHash");
    // change own PIN with a wrong current PIN -> refused
    await typeInCard("My PIN", 0, "0000"); await typeInCard("My PIN", 1, "9999"); await typeInCard("My PIN", 2, "9999");
    await clickText("Change Admin PIN"); await waitText("Current PIN is incorrect", 5_000);
    await shot("settings-mypin-wrong");
  });

  await step("Team: no show toggle, Reset PIN + Add member go to the server", async () => {
    await closeSettings();
    await clickText("Team"); await waitText("Team Members");
    const txt = await bodyText();
    if (/PIN:\s*[•\d]/.test(txt) || /\bshow\b/.test(txt) || /1111|2222|3333/.test(txt)) fail("Team page still renders a PIN or a show toggle");
    await shot("team-no-pins");
    // Reset Ploy's PIN
    const rows = await page.evaluate(() => [...document.querySelectorAll("button")].filter(b => b.textContent.includes("Reset PIN")).length);
    if (rows < 3) fail("Reset PIN buttons missing: " + rows);
    await page.evaluate(() => { const row = [...document.querySelectorAll("p")].find(p => p.textContent.trim() === "Ploy")?.closest("div")?.parentElement; const b = [...row.querySelectorAll("button")].find(x => x.textContent.includes("Reset PIN")); b.click(); });
    await waitText("New PIN for Ploy", 5_000);
    await typeInto("input[placeholder='e.g. 1234']", "4444");
    await typeInto("input[placeholder='Re-enter PIN']", "4444");
    await shot("team-reset-pin-modal");
    await clickLastText("Reset PIN");
    await sleep(800);
    if (await hasText("New PIN for Ploy")) fail("Reset PIN modal did not close");
    await apiClient(URL).loginEmployee("e_ploy", "4444").catch(e => fail("Ploy cannot log in with the reset PIN: " + e.message));
    // Add member
    await clickText("Add Member", "button", false);
    await waitText("Add Team Member", 5_000);
    await typeInto("input[placeholder='e.g. Somchai']", "Newbie");
    await typeInto("input[placeholder='e.g. 1234']", "6666");
    await typeInto("input[placeholder='Re-enter PIN']", "6666");
    await clickLastText("Add Member");
    await sleep(1000);
    await waitText("Newbie", 5_000);
    await shot("team-member-added");
    const data = await admin.get("/api/data");
    const nb = data.employees.find(e => e.name === "Newbie");
    if (!nb) fail("Newbie not stored");
    if (JSON.stringify(data.employees).match(/pin/i)) fail("employees payload carries a pin field");
    await apiClient(URL).loginEmployee(nb.id, "6666").catch(e => fail("Newbie cannot log in: " + e.message));
    // KPI deduction stamped with the actor name
    await page.evaluate(() => { const row = [...document.querySelectorAll("p")].find(p => p.textContent.trim() === "Nong")?.closest("div")?.parentElement; const b = [...row.querySelectorAll("button")].find(x => x.getAttribute("title") === "View Profile"); b.click(); });
    await waitText("KPI Score", 5_000);
    await page.evaluate(() => { const sel = document.querySelector("select"); if (sel) { sel.value = sel.options[1].value; sel.dispatchEvent(new Event("change", { bubbles: true })); } });
    await sleep(300);
    await clickText("Deduct Points", "button", false);
    await sleep(2500);
    const kv = await admin.get("/api/data");
    const ev = (kv.kpiEvents || []).slice(-1)[0];
    if (!ev || ev.by !== "Somchai") fail("KPI event not stamped with the owner name: " + JSON.stringify(ev));
    console.log("  ok  KPI event by " + ev.by);
    await page.keyboard.press("Escape");
  });

  // ── P2-8 register -> pending -> approve ──────────────────────────────────
  let regName = "Somsak";
  await step("register with contact -> pending state on the login screen", async () => {
    await newPage({ width: 390, height: 844, isMobile: true });
    await waitText("Crew / ทีมงาน");
    await clickText("Request to register", "button", false);
    await waitText("Phone or LINE ID");
    await typeInto("input[placeholder='Full name']", regName);
    await typeInto("input[placeholder='08x-xxx-xxxx / LINE ID']", "081-000-0000");
    await typeInto("input[placeholder='e.g. 5678']", "7788");
    await typeInto("input[placeholder='Re-enter PIN']", "7788");
    await shot("register-form");
    await clickText("Send Request");
    await waitText("Request sent", 8_000);
    await clickText("Back", "button", false);
    await waitText("Waiting for approval", 8_000);
    await shot("login-pending");
  });
  await step("admin approves: row shows contact, never the PIN; approvedBy stamped", async () => {
    await newPage({ width: 1280, height: 900 }, { keepStorage: true });
    await waitText("Crew / ทีมงาน");
    await clickText("Rental house admin", "button", false);
    await waitText("Admin account"); // staff exist now -> picker
    await shot("login-admin-picker");
    await pin("9999");
    await waitText("Overview");
    await page.evaluate(() => document.getElementById("approvals-card")?.scrollIntoView({ block: "start" }));
    await waitText(regName, 8_000);
    const txt = await bodyText();
    if (/7788|PIN:/.test(txt)) fail("approvals row shows the requested PIN");
    if (!/081-000-0000/.test(txt)) fail("approvals row does not show the contact");
    await shot("approvals-member-request");
    await page.evaluate((name) => { const p = [...document.querySelectorAll("p")].find(e => e.textContent.trim() === name); const box = p.parentElement; const b = [...box.querySelectorAll("button")].find(x => x.textContent.trim() === "Approve"); b.click(); }, regName);
    await sleep(1500);
    const kv = await admin.get("/api/data");
    const req = kv.adminRequests.find(r => r.type === "member-register" && r.name === regName);
    if (!req || req.status !== "approved" || req.approvedBy !== "Somchai") fail("request not approved server-side with approver: " + JSON.stringify(req));
    if (!kv.employees.some(e => e.name === regName)) fail("employee not created");
    console.log("  ok  approved by " + req.approvedBy);
    await apiClient(URL).loginEmployee(kv.employees.find(e => e.name === regName).id, "7788").catch(e => fail("Somsak cannot log in with his chosen PIN: " + e.message));
  });
  await step("the requester's device now shows 'account is ready'", async () => {
    await newPage({ width: 390, height: 844, isMobile: true }, { keepStorage: true });
    await waitText("Your account is ready", 8_000);
    await shot("login-approved");
  });

  // ── staff login + actor stamp, logout ────────────────────────────────────
  await step("counter staff Bee logs in, receives gear (by Bee), logs out (session really ends)", async () => {
    await newPage({ width: 1280, height: 900 });
    await waitText("Crew / ทีมงาน");
    await clickText("Rental house admin", "button", false);
    await waitText("Admin account");
    await clickText("Somchai", "button", false); // picker shows the owner by default
    await waitText("Bee", 5_000);
    await clickText("Bee", "span");
    await shot("login-admin-picker-bee");
    await pin("2468");
    await waitText("Overview");
    await shot("bee-dashboard");
    // Bee resolves an equipment request in Approvals: approvedBy must be Bee
    await page.evaluate(() => document.getElementById("approvals-card")?.scrollIntoView({ block: "start" }));
    await waitText("Tilta Nucleus-M", 8_000);
    await page.evaluate(() => { const p = [...document.querySelectorAll("p")].find(e => e.textContent.trim() === "Tilta Nucleus-M"); const box = p.parentElement; const b = [...box.querySelectorAll("button")].find(x => x.textContent.trim() === "Approve"); b.click(); });
    await sleep(2500);
    const kv = await admin.get("/api/data");
    const req = kv.adminRequests.find(r => r.id === "ar_seed1");
    if (!req || req.status !== "approved" || req.approvedBy !== "Bee") fail("equipment approval not stamped by Bee: " + JSON.stringify(req));
    console.log("  ok  approval by " + req.approvedBy);
    await clickText("Settings"); await waitText("Admin accounts", 8_000);
    if (!(await hasText("Only the owner account can manage admin accounts"))) fail("counter staff sees staff management");
    await shot("bee-settings-counter");
    await closeSettings();
    await clickText("Log out");
    await waitText("Crew / ทีมงาน");
    await page.reload({ waitUntil: "networkidle0" });
    await waitText("Crew / ทีมงาน");
    const me = await page.evaluate(() => fetch("/api/me").then(r => r.json()));
    if (me.user) fail("session still valid after logout: " + JSON.stringify(me));
    await shot("after-logout");
  });

  // ── crew: PIN self-change, foreign invoice PUT refused ───────────────────
  await step("crew Nong: change PIN (wrong current refused), cannot PUT another crew's invoice", async () => {
    await newPage({ width: 390, height: 844, isMobile: true });
    await waitText("Crew / ทีมงาน");
    await clickText("Crew / ทีมงาน", "button", false);
    await clickText("Select account", "button", false); await waitText("Nong", 5_000); await clickText("Nong", "span");
    await pin("1111");
    await waitText("Today's Jobs");
    await clickText("Profile"); await waitText("Change Passcode", 8_000);
    await page.evaluate(() => { const p = [...document.querySelectorAll("p")].find(e => e.textContent.trim() === "Change Passcode"); p && p.scrollIntoView({ block: "start" }); });
    await typeInCard("Change Passcode", 0, "0000"); await typeInCard("Change Passcode", 1, "1212"); await typeInCard("Change Passcode", 2, "1212");
    await clickText("Update Passcode", "button", false);
    await waitText("Current PIN is incorrect", 5_000);
    await shot("crew-pin-wrong");
    await typeInCard("Change Passcode", 0, "1111");
    await clickText("Update Passcode", "button", false);
    await waitText("PIN updated", 5_000);
    await shot("crew-pin-changed");
    await apiClient(URL).loginEmployee("e_nong", "1212").catch(e => fail("Nong cannot log in with the new PIN: " + e.message));
    // From Nong's page, try to overwrite Arthit's world through fetch. The 403s
    // these deliberate requests produce are the point, not page errors.
    const before = await admin.get("/api/data");
    const errMark = errors.length;
    const res = await page.evaluate(async () => {
      const r1 = await fetch("/api/data", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ invoices: [{ id: "inv_seed1", employeeId: "e_nong", status: "Paid", invoiceNo: "HACKED" }, { id: "inv_hack", employeeId: "e_arthit", status: "Paid", invoiceNo: "FAKE-ARTHIT" }], _invoiceEmployeeId: "e_arthit" }) });
      const r2 = await fetch("/api/data", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ employees: [] }) });
      const r3 = await fetch("/api/profile/e_arthit");
      const r4 = await fetch("/api/data", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ checkouts: [{ id: "co_fake", employeeId: "e_arthit", eqId: "eq_fx6", qty: 1, type: "pick", ts: Date.now() }] }) });
      return { r1: r1.status, r2: r2.status, r3: r3.status, r4: r4.status };
    });
    errors.splice(errMark);
    const after = await admin.get("/api/data");
    const seed = after.invoices.find(i => i.id === "inv_seed1");
    if (!(seed.status === "Paid" && seed.invoiceNo === "HACKED" && seed.employeeId === "e_nong")) fail("Nong's OWN invoice edit should persist (ownership = session, the client-declared _invoiceEmployeeId is ignored): " + JSON.stringify(seed));
    if (after.invoices.some(i => i.id === "inv_hack")) fail("crew created an invoice in another crew's name");
    if (res.r2 !== 403) fail("crew PUT employees not refused: " + res.r2);
    if (res.r3 !== 403) fail("crew read another crew's profile: " + res.r3);
    if (after.checkouts.some(c => c.id === "co_fake")) fail("crew forged a checkout for another crew");
    if (after.employees.length !== before.employees.length) fail("employees changed by a crew PUT");
    console.log(`  ok  foreign writes: invoices ${res.r1} (dropped), employees ${res.r2}, profile ${res.r3}, forged checkout ${res.r4} (dropped)`);
  });

  const bad = errors.filter(e => !ALLOW.some(rx => rx.test(e)));
  if (bad.length) { console.error("\nUnexpected errors:\n  " + bad.join("\n  ")); fail(`${bad.length} unexpected page/console error(s)`); }
  console.log(`\nAUTH WALK PASSED (${shotN} screenshots in ${SHOTS})`);
} catch (e) {
  if (!process.exitCode) { console.error("\nAUTH WALK FAILED: " + (e && e.message)); process.exitCode = 1; }
} finally {
  await browser.close();
}
