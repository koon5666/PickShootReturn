#!/usr/bin/env node
// P1-3 regression: every sticky primary button is really tappable at 390x844.
// For each [data-sticky-primary] wrapper we scroll the page to several offsets
// and assert document.elementFromPoint at the button's centre returns the button
// (or a node inside it), i.e. nothing (bottom nav, panel content) covers it.
//
//   node tests/sticky.mjs <PORT>     (seeded local server, default profile)
import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PUPPETEER = process.env.PUPPETEER_CORE
  || "/private/tmp/claude-501/-Users-koonya-inta/bd16a78f-33be-43a8-91b5-db242cf9f6df/scratchpad/puptest/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const { default: puppeteer } = await import(PUPPETEER);

const port = parseInt(process.argv[2], 10);
if (!(port > 0)) { console.error("usage: node tests/sticky.mjs <PORT>"); process.exit(2); }
const URL = `http://127.0.0.1:${port}`;
const SHOTS = resolve(dirname(fileURLToPath(import.meta.url)), ".sticky-shots");
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const fail = (msg) => { console.error("\nSTICKY FAILED: " + msg); process.exitCode = 1; throw new Error(msg); };

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: false });
page.on("dialog", d => d.accept());
await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch {} });
await page.goto(URL, { waitUntil: "networkidle0", timeout: 60_000 });
let shotN = 0;
const shot = async (name) => page.screenshot({ path: `${SHOTS}/${String(++shotN).padStart(2, "0")}-${name}.png` });
async function waitText(txt, ms = 15_000) {
  try { await page.waitForFunction(t => document.body.innerText.toLowerCase().includes(t), { timeout: ms }, txt.toLowerCase()); }
  catch { await shot("fail"); fail(`text "${txt}" never appeared`); }
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
  if (!pos) { await shot("fail"); fail(`no <${tag}> with text "${txt}"`); }
  await page.mouse.click(pos[0], pos[1]);
}
async function pin(digits) { for (const d of digits) await clickText(d); await clickText("Unlock", "button", false); }

// The core assertion. `scroller` = null for window scrolling, or a selector for an inner scroller.
async function assertHittable(name, { scroller = null, offsets = [0, 300, 900, 1400, 999999] } = {}) {
  for (const y of offsets) {
    const res = await page.evaluate((name, scroller, y) => {
      const wrap = document.querySelector(`[data-sticky-primary="${name}"]`);
      if (!wrap) return { err: "wrapper not found" };
      const btn = wrap.querySelector("button");
      if (!btn) return { err: "button not found" };
      if (scroller) { const sc = document.querySelector(scroller); if (sc) sc.scrollTop = y; }
      else window.scrollTo(0, y);
      const r = btn.getBoundingClientRect();
      const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      const ok = !!hit && (hit === btn || btn.contains(hit));
      return { ok, cx, cy, top: r.top, bottom: r.bottom, vh: window.innerHeight, hit: hit ? (hit.tagName + (hit.textContent || "").trim().slice(0, 30)) : null, scrollY: scroller ? null : window.scrollY };
    }, name, scroller, y);
    await sleep(60);
    if (res.err) fail(`${name}: ${res.err}`);
    if (!res.ok) { await shot(`${name}-fail`); fail(`${name} at scroll ${y}: elementFromPoint(${Math.round(res.cx)},${Math.round(res.cy)}) = ${res.hit}, button rect ${Math.round(res.top)}..${Math.round(res.bottom)} of ${res.vh}`); }
    if (res.bottom > res.vh || res.top < 0) { await shot(`${name}-fail`); fail(`${name} at scroll ${y}: button not fully inside the viewport (${Math.round(res.top)}..${Math.round(res.bottom)} of ${res.vh})`); }
  }
  await shot(name);
  console.log(`  ok  ${name} hittable at every scroll offset`);
}

try {
  // Auth (P0-2): /api/data needs a session; /api/public is the open health endpoint.
  const health = await fetch(URL + "/api/public").catch(() => null);
  if (!health || health.status !== 200) fail(`GET ${URL}/api/public -> ${health ? health.status : "unreachable"}; boot + seed first (tests/README.md)`);

  // ── crew: Profile "Save Profile" ───────────────────────────────────────
  await waitText("Crew / ทีมงาน");
  await clickText("Crew / ทีมงาน", "button", false);
  await waitText("Select account");
  await clickText("Select account", "button", false);
  await waitText("Nong", 5_000);
  await clickText("Nong", "span");
  await pin("1111");
  await waitText("Today's Jobs");
  await clickText("Profile");
  await waitText("My Profile");
  await sleep(400);
  // type into the form so this is the "dirty, mid-form" state the review reproduced
  await page.type("input[placeholder='First Name']", "Nong");
  await assertHittable("profile-save");
  // and a real click at the centre saves (does not open the Gear tab)
  await page.evaluate(() => window.scrollTo(0, 1400));
  const c = await page.evaluate(() => { const b = document.querySelector('[data-sticky-primary="profile-save"] button').getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; });
  await page.mouse.click(c[0], c[1]);
  await sleep(800);
  const txt = await page.evaluate(() => document.body.innerText);
  if (!/Profile Saved|Saving/i.test(txt)) { await shot("profile-click-fail"); fail("clicking the sticky Save Profile did not save"); }
  if (/Equipment Library/i.test(txt)) fail("clicking Save Profile opened the Gear tab");
  console.log("  ok  Save Profile click saves (stays on Profile)");

  // ── crew: checkout screen "Save" ───────────────────────────────────────
  await clickText("Today"); await waitText("Today's Jobs");
  await clickText("Netflix", "h3", false); // Netflix job starts today, nothing picked
  await waitText("Tap each item", 8_000);
  await assertHittable("checkout-save", { offsets: [0, 200, 999999] });
  await clickText("Back", "button", false);

  // ── admin: Settings "Save All Settings" (390px) ────────────────────────
  await clickText("Log Out", "button", false);
  await waitText("Crew / ทีมงาน");
  await clickText("Rental house admin", "button", false);
  await waitText("Enter PIN");
  await pin("9999");
  await waitText("Overview");
  await page.click('button[title="Settings"]'); // mobile admin top bar icon
  await waitText("Navigation Order", 8_000);
  const scroller = await page.evaluate(() => {
    const wrap = document.querySelector('[data-sticky-primary="settings-save"]');
    const panel = wrap && wrap.parentElement;
    const sc = panel && [...panel.children].find(c => getComputedStyle(c).overflowY === "auto");
    if (sc) sc.setAttribute("data-settings-scroller", "1");
    return sc ? "[data-settings-scroller]" : null;
  });
  if (!scroller) fail("Settings scroller not found");
  await assertHittable("settings-save", { scroller, offsets: [0, 400, 1200, 999999] });
  // content never shows through the footer: the footer has an opaque background
  const bg = await page.evaluate(() => getComputedStyle(document.querySelector('[data-sticky-primary="settings-save"]')).backgroundColor);
  if (!bg || bg === "rgba(0, 0, 0, 0)" || bg === "transparent") fail(`settings footer has no background (${bg})`);
  console.log(`  ok  settings footer background ${bg}`);

  console.log(`\nSTICKY PASSED (${shotN} screenshots in ${SHOTS})`);
} catch (e) {
  if (!process.exitCode) { console.error("\nSTICKY FAILED: " + (e && e.message)); process.exitCode = 1; }
} finally {
  await browser.close();
}
