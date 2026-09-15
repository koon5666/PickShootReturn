// Documents track (P0-6, P0-7, P0-8, P1-7, P1-8, P2-4, P2-9, P2-17, P3-4): headless
// walk-through of every changed flow with real mouse clicks, against a FRESHLY
// seeded local server (tests/local-server.mjs + tests/seed.mjs default). It creates
// documents, so boot on a clean --persist-to dir before each run.
//
//   node tests/walk-documents.mjs <PORT>
//
// Screenshots: tests/.walk-shots/ (gitignored). Same puppeteer/Chrome resolution as smoke.mjs.
import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { apiClient } from "./apiclient.mjs";
const PUPPETEER = process.env.PUPPETEER_CORE
  || "/private/tmp/claude-501/-Users-koonya-inta/bd16a78f-33be-43a8-91b5-db242cf9f6df/scratchpad/puptest/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const { default: puppeteer } = await import(PUPPETEER);
const port = parseInt(process.argv[2], 10);
if (!(port > 0)) { console.error("usage: node tests/walk-documents.mjs <PORT>"); process.exit(2); }
const URL = `http://127.0.0.1:${port}`;
const SHOTS = resolve(dirname(fileURLToPath(import.meta.url)), ".walk-shots");
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const errors = [];
const ALLOW = [/ws:\/\/[^']*\/api\/(session|chat)/i, /\/api\/profile\/[^ ]* .*404/i, /Failed to load resource: the server responded with a status of (404|503|500)/i, /\/api\/notify/];
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox"] });
let page; let shotN = 0;
const fail = (m) => { throw new Error(m); };
async function newPage(viewport) {
  if (page) { try { await page.evaluate(() => fetch("/api/logout", { method: "POST" })); } catch {} await page.close(); } // one cookie jar per browser (P0-2)
  page = await browser.newPage();
  await page.setViewport(viewport);
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error") errors.push("console: " + m.text()); });
  page.on("dialog", async d => { console.log("  dialog:", d.message()); await d.accept(); });
  await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch {} });
  await page.goto(URL, { waitUntil: "networkidle0", timeout: 60_000 });
}
const shot = async (name, full = false) => { const p = `${SHOTS}/${String(++shotN).padStart(2, "0")}-${name}.png`; await page.screenshot({ path: p, fullPage: full }); console.log("  shot", p); return p; };
const bodyText = () => page.evaluate(() => document.body.innerText);
const hasText = async (txt) => (await bodyText()).toLowerCase().includes(txt.toLowerCase());
async function waitText(txt, ms = 15_000) {
  try { await page.waitForFunction(t => document.body.innerText.toLowerCase().includes(t), { timeout: ms }, txt.toLowerCase()); }
  catch { await shot("fail"); fail(`text "${txt}" never appeared`); }
}
async function clickText(txt, tag = "button", exact = true, nth = 0) {
  const pos = await page.evaluate((txt, tag, exact, nth) => {
    const norm = s => s.replace(/\s+/g, " ").trim().toLowerCase();
    const want = norm(txt);
    const els = [...document.querySelectorAll(tag)].filter(e => exact ? norm(e.textContent) === want : norm(e.textContent).includes(want));
    const el = els[nth];
    if (!el) return null;
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    return [r.x + r.width / 2, r.y + r.height / 2];
  }, txt, tag, exact, nth);
  if (!pos) { await shot("fail"); fail(`no <${tag}> with text "${txt}"`); }
  await page.mouse.click(pos[0], pos[1]);
  await sleep(250);
}
async function pin(digits) { for (const d of digits) await clickText(d); await clickText("Unlock", "button", false); }
async function selectOption(selector, value) { await page.select(selector, value); await sleep(200); }
async function typeInto(selector, text) { await page.click(selector, { clickCount: 3 }); await page.type(selector, text); }
// Auth (P0-2): API reads/writes go through an owner session; the crew profile read through Nong's.
const kvAdmin = await apiClient(URL).loginAdmin("9999").catch(e => { console.error("owner login 9999 failed: seed first. " + e.message); process.exit(1); });
const kv = async () => kvAdmin.get("/api/data");
// Admin document tab: "INV" or "INV (2)"
async function clickTab(label) {
  const pos = await page.evaluate((label) => {
    const re = new RegExp("^" + label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "( \\(\\d+\\))?$");
    const el = [...document.querySelectorAll("button")].find(b => re.test(b.textContent.replace(/\s+/g, " ").trim()));
    if (!el) return null;
    const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2];
  }, label);
  if (!pos) { await shot("fail"); fail("no tab " + label); }
  await page.mouse.click(pos[0], pos[1]); await sleep(300);
}
const step = async (name, fn) => { console.log("- " + name); await fn(); };
// Every navigation clears localStorage (fresh first-run), so re-login after a reload.
async function loginNong() {
  await waitText("Crew / ทีมงาน");
  await clickText("Crew / ทีมงาน", "button", false);
  await waitText("Select account");
  await clickText("Select account", "button", false);
  await waitText("Nong", 5_000);
  await clickText("Nong", "span");
  await pin("1111");
  await waitText("Today's Jobs");
}

try {
  // ───────────── CREW (Nong) ─────────────
  await step("crew login Nong", async () => {
    await newPage({ width: 390, height: 844, isMobile: true, hasTouch: false });
    await waitText("Crew / ทีมงาน");
    await clickText("Crew / ทีมงาน", "button", false);
    await waitText("Select account");
    await clickText("Select account", "button", false);
    await waitText("Nong", 5_000);
    await clickText("Nong", "span");
    await pin("1111");
    await waitText("Today's Jobs");
  });

  await step("crew profile: helper text, prefix, tax id, OT example", async () => {
    await clickText("Profile"); await waitText("My Profile");
    await sleep(500);
    // Prefix field shows NG (from seed), tax id field present
    const prefixVal = await page.$eval("input[maxlength='6']", e => e.value);
    if (prefixVal !== "NG") fail("prefix not defaulted/loaded: " + prefixVal);
    if (!(await hasText("Tax ID / 13-digit ID number"))) fail("tax id field missing");
    if (!(await hasText("Used only when you switch on ID card copy"))) fail("ID card helper missing");
    if (!(await hasText("Example: ฿3,500 / 12h"))) fail("OT worked example missing");
    // scroll to the positions card and shoot
    await page.evaluate(() => { const el = [...document.querySelectorAll("p")].find(p => /Example: ฿3,500/.test(p.textContent)); el && el.scrollIntoView({ block: "center" }); });
    await sleep(300);
    await shot("crew-profile-ot-example");
    // flat ฿/hour mode
    await clickText("Flat ฿/hour");
    await page.type("input[placeholder='500']", "500");
    await sleep(200);
    if (!(await hasText("every OT hour after 12h pays ฿500"))) fail("flat OT example missing");
    await shot("crew-profile-ot-flat");
    await clickText("Multiplier");
    await page.evaluate(() => { const el = [...document.querySelectorAll("label")].find(p => /ID Card/i.test(p.textContent)); el && el.scrollIntoView({ block: "start" }); });
    await sleep(300);
    await shot("crew-profile-documents");
    await typeInto("input[placeholder='1234567890123']", "1234567890123");
    await clickText("Save Profile", "button", false);
    await sleep(1200);
    const prof = await kvAdmin.get("/api/profile/e_nong");
    if (prof.taxId !== "1234567890123") fail("taxId not saved: " + prof.taxId);
    if (prof.invoicePrefix !== "NG") fail("prefix not saved");
    console.log("  ok profile saved taxId + prefix");
  });

  await step("crew invoice: create document (validation, header, next number, layout)", async () => {
    await clickText("Invoice"); await waitText("My Invoices");
    await sleep(400);
    await clickText("Create Invoice", "button", false);
    await waitText("Create Document");
    await sleep(400);
    if (!(await hasText("INV-NG-26-0002"))) fail("next number preview missing");
    if (!(await hasText("FROM: Nong Srisuk"))) fail("FROM preview / own-name header missing");
    const headerVal = await page.$eval("input[placeholder='Nong Srisuk']", e => e.value).catch(() => null);
    if (headerVal !== "Nong Srisuk") fail("header default not crew's own name: " + headerVal);
    if (!(await hasText("No bank account or PromptPay QR"))) fail("missing-bank warning missing");
    await shot("crew-doc-modal-top");
    // line items two-row layout
    await page.evaluate(() => document.querySelector(".psr-line")?.scrollIntoView({ block: "center" }));
    await sleep(300);
    const dims = await page.evaluate(() => { const i = document.querySelector(".psr-line .f-desc"); const q = document.querySelector(".psr-line .f-qty"); const r1 = i.getBoundingClientRect(), r2 = q.getBoundingClientRect(); return { descW: r1.width, descH: r1.height, qtyTop: r2.top, descTop: r1.top }; });
    console.log("  line-item desc", dims);
    if (dims.descW < 200) fail("description not full width on phone: " + dims.descW);
    if (dims.descH < 40) fail("input not 40px tall: " + dims.descH);
    if (dims.qtyTop <= dims.descTop + 10) fail("qty not on a second row");
    await shot("crew-doc-lineitems-390");
    // VAT on: still two rows
    await clickText("7% VAT OFF");
    await sleep(200);
    const dims2 = await page.evaluate(() => { const i = document.querySelector(".psr-line .f-desc").getBoundingClientRect(); return i.width; });
    if (dims2 < 200) fail("description shrank with VAT on: " + dims2);
    await shot("crew-doc-lineitems-390-vat");
    await clickText("7% VAT ON");
    // attachments: ID card toggle off & disabled (no id card), signature disabled
    await page.evaluate(() => { const el = [...document.querySelectorAll("p")].find(p => /Attach to this document/.test(p.textContent)); el && el.scrollIntoView({ block: "center" }); });
    await sleep(200);
    await shot("crew-doc-attachments");
    // Save with no rate → blocked
    await clickText("Save Document");
    await sleep(300);
    if (!(await hasText("Add a rate to at least one line"))) fail("save not blocked on no rate");
    await shot("crew-doc-save-blocked");
    // choose position 1st AC → auto-fill
    await page.evaluate(() => [...document.querySelectorAll("select")].find(s => [...s.options].some(o => o.value === "1st AC"))?.scrollIntoView({ block: "center" }));
    const posSel = await page.evaluateHandle(() => [...document.querySelectorAll("select")].find(s => [...s.options].some(o => o.value === "1st AC")));
    await posSel.select("1st AC");
    await sleep(400);
    const optGroups = await page.evaluate(() => [...document.querySelectorAll("select optgroup")].map(g => g.label));
    console.log("  position optgroups:", optGroups);
    if (!optGroups.includes("Common roles")) fail("department role list missing");
    // WHT on
    await clickText("Withholding tax 3% OFF", "button", false);
    await sleep(200);
    if (!(await hasText("Net payable"))) fail("net payable missing");
    await page.evaluate(() => { const el = [...document.querySelectorAll("span")].find(p => /Net payable/.test(p.textContent)); el && el.scrollIntoView({ block: "center" }); });
    await shot("crew-doc-totals-wht");
    // terms 30 days
    const termsSel = await page.evaluateHandle(() => [...document.querySelectorAll("select")].find(s => [...s.options].some(o => o.value === "30")));
    await termsSel.select("30");
    await sleep(200);
    await clickText("Save Document");
    await sleep(600);
    if (await hasText("Create Document")) fail("modal did not close after save");
    await waitText("INV-NG-26-0002 created", 3000);
    await shot("crew-doc-created-toast");
    await sleep(3500);
    const d = await kv();
    const inv = d.invoices.find(i => i.invoiceNo === "INV-NG-26-0002");
    if (!inv) fail("INV-NG-26-0002 not in KV");
    console.log("  KV doc:", JSON.stringify({ billTo: inv.billTo, whtEnabled: inv.whtEnabled, includeIdCard: inv.includeIdCard, includeSignature: inv.includeSignature, includeBank: inv.includeBank, termsDays: inv.termsDays, dueDate: inv.dueDate, header: inv.invoiceHeader, position: inv.position, items: inv.items.map(i => [i.description, i.qty, i.rate]) }));
    if (inv.billTo?.address !== "1 Rama IV Rd, Bangkok 10500") fail("billTo snapshot missing");
    if (inv.includeIdCard !== false) fail("includeIdCard should default off");
    if (inv.invoiceHeader !== "Nong Srisuk") fail("header not own name");
    if (!inv.whtEnabled || !inv.dueDate) fail("wht/dueDate not saved");
    // Invoiced badge for Netflix now
    if (!(await hasText("Invoiced"))) fail("Invoiced badge missing");
  });

  await step("crew invoice: printed HTML (bilingual, WHT, no ID card, bank w/o QR)", async () => {
    // the new doc is auto-expanded after save; expand only if needed, then View (opens blob url in a new tab)
    if (!(await hasText("View"))) { await clickText("INV-NG-26-0002", "p", false); await sleep(300); }
    const before = (await browser.pages()).length;
    await clickText("View", "button", false);
    await sleep(1500);
    const pages = await browser.pages();
    const docPage = pages[pages.length - 1];
    if (pages.length === before) fail("View did not open a tab");
    await docPage.setViewport({ width: 900, height: 1300 });
    const html = await docPage.content();
    for (const needle of ["ใบแจ้งหนี้", "INVOICE", "#INV-NG-26-0002", "Withholding tax 3%", "NET PAYABLE", "Bill To", "1 Rama IV Rd", "Tax ID: 1234567890123", "Due:"]) {
      if (!html.includes(needle)) fail("printed doc missing: " + needle);
    }
    if (html.includes("Position: <strong>—")) fail("blank position printed");
    if (/ID Card/.test(html)) fail("ID card printed although off");
    const p = `${SHOTS}/${String(++shotN).padStart(2, "0")}-crew-printed-doc.png`;
    await docPage.screenshot({ path: p, fullPage: true });
    console.log("  shot", p);
    await docPage.close();
  });

  await step("crew invoice: mark paid dialog + issue receipt + undo voids receipt", async () => {
    await page.bringToFront();
    await clickText("Mark Paid");
    await waitText("Mark as paid");
    if (!(await hasText("฿7,000"))) fail("paid dialog amount missing (expected 7,000 = 2 days x 3,500)");
    await shot("crew-paid-dialog");
    await clickText("Confirm paid");
    await sleep(500);
    if (!(await hasText("Issue receipt"))) fail("Issue receipt button missing after paid");
    await shot("crew-paid-issue-receipt");
    await clickText("Issue receipt", "button", false);
    await sleep(500);
    await waitText("RTX-NG-26-0002 issued", 3000);
    await shot("crew-receipt-issued");
    await sleep(3500);
    let d = await kv();
    const rtx = d.invoices.find(i => i.invoiceNo === "RTX-NG-26-0002");
    const inv2 = d.invoices.find(i => i.invoiceNo === "INV-NG-26-0002");
    if (!rtx || rtx.docType !== "receipt" || rtx.status !== "Paid") fail("receipt not persisted");
    if (!inv2.paidDate) fail("paidDate not stamped");
    console.log("  receipt", rtx.invoiceNo, "paidDate", rtx.paidDate, "inv paidDate", inv2.paidDate);
    // ฿0 doc cannot be marked paid: build a zero quote (allowed via confirm) then check the dialog refuses
    // Undo paid on the INV → receipt void
    if (!(await hasText("Mark Pending"))) { await clickText("INV-NG-26-0002", "p", false); await sleep(300); }
    await clickText("Mark Pending");
    await waitText("Undo paid");
    await clickText("Set back to Pending");
    await sleep(300);
    if (!(await hasText("A reason is required"))) fail("empty reason accepted");
    await page.type("input[placeholder='e.g. Transfer bounced']", "Transfer bounced");
    await shot("crew-unpaid-dialog");
    await clickText("Set back to Pending");
    await sleep(3800);
    d = await kv();
    const rtx2 = d.invoices.find(i => i.invoiceNo === "RTX-NG-26-0002");
    if (rtx2.status !== "Void" || rtx2.voidReason !== "Transfer bounced") fail("receipt not voided: " + JSON.stringify(rtx2.status));
    if (d.invoices.find(i => i.invoiceNo === "INV-NG-26-0002").status !== "Pending") fail("invoice not back to pending");
    console.log("  ok receipt voided with reason");
    await clickText("RTX", "button", true);
    await sleep(300);
    await shot("crew-receipt-void-list");
    await clickText("All", "button", true, 1);
  });

  await step("crew: shared production house is read-only, own one editable", async () => {
    await page.evaluate(() => { const el = [...document.querySelectorAll("p")].find(p => /Production Houses/i.test(p.textContent)); el && el.scrollIntoView({ block: "start" }); });
    await sleep(200);
    await clickText("Netflix Thailand", "p", false);
    await waitText("Edit Production House");
    if (!(await hasText("Only they or an admin can edit"))) fail("read-only notice missing");
    const ro = await page.$$eval("input[readonly]", els => els.length);
    if (ro < 3) fail("name/tax/branch inputs not read-only: " + ro);
    if (await hasText("Save")) { const btns = await page.evaluate(() => [...document.querySelectorAll("button")].map(b => b.textContent.trim())); if (btns.includes("Save")) fail("Save button shown on read-only company"); }
    await shot("crew-prodhouse-readonly");
    await clickText("Back");
    await sleep(300);
    // add own company with tax id
    await clickText("+ Add");
    await waitText("Add Production House");
    await page.type("input[placeholder='e.g. Thai Film Co.']", "Nong Own Films");
    await page.type("textarea", "5 Ekkamai, Bangkok");
    await page.type("input[placeholder='0105551234567']", "0105559999999");
    await page.type("input[placeholder='Head office or branch no.']", "00000");
    await clickText("Save");
    await sleep(400);
    await clickText("Nong Own Films", "p", false);
    await waitText("Edit Production House");
    const ro2 = await page.$eval("input[placeholder='e.g. Thai Film Co.']", e => e.readOnly);
    if (ro2) fail("own company should be editable");
    await shot("crew-prodhouse-own-edit");
    await clickText("Cancel");
    await sleep(3500);
    const d = await kv();
    const co = d.productionCompanies.find(c => c.name === "Nong Own Films");
    if (!co || co.taxId !== "0105559999999" || co.branch !== "00000" || co.addedBy !== "e_nong") fail("company tax fields not persisted: " + JSON.stringify(co));
    console.log("  ok company with tax id persisted");
  });

  await step("crew: share link 72h + view count + revoke", async () => {
    // give the house a LINE group id so the Send to Group button shows (notify will fail locally; that is caught)
    await kvAdmin.put("/api/data", { lineGroupId: "Clocaltest" });
    await page.evaluate(() => fetch("/api/logout", { method: "POST" })); await page.reload({ waitUntil: "networkidle0" }); // the session cookie survives a reload (P0-2): end it so the script re-logs in as before
    await loginNong();
    await clickText("Invoice"); await waitText("My Invoices");
    await sleep(400);
    await clickText("INV-NG-26-0002", "p", false);
    await sleep(300);
    await clickText("Send to Group", "button", false);
    await waitText("Sent to the group. Link works for 72 hours", 8000);
    await sleep(300);
    if (!(await hasText("Link active until"))) fail("share status line missing");
    await shot("crew-share-active");
    await sleep(3500);
    let d = await kv();
    const inv = d.invoices.find(i => i.invoiceNo === "INV-NG-26-0002");
    if (!inv.share?.key || !inv.share?.token) fail("share record not persisted");
    const exp = inv.share.expiresAt - inv.share.createdAt;
    if (Math.abs(exp - 72 * 3600 * 1000) > 5000) fail("TTL not 72h: " + exp);
    // public view twice → views 2
    const v1 = await fetch(`${URL}/api/invoice-view/${inv.share.key}`);
    if (v1.status !== 200 || !(await v1.text()).includes("INV-NG-26-0002")) fail("public view failed");
    await fetch(`${URL}/api/invoice-view/${inv.share.key}`);
    await sleep(500);
    const st = await kvAdmin.get(`/api/invoice-share?key=${inv.share.key}&token=${inv.share.token}`);
    console.log("  share status", st);
    if (st.views !== 2) fail("view counter wrong: " + st.views);
    const bad = await kvAdmin.raw(`/api/invoice-share?key=${inv.share.key}&token=wrong`);
    if (bad.status !== 403) fail("status with wrong token should be 403");
    // UI shows views after collapse/expand refresh
    await clickText("INV-NG-26-0002", "p", false); await sleep(200); await clickText("INV-NG-26-0002", "p", false); await sleep(800);
    if (!(await hasText("2 views"))) fail("view count not shown in UI");
    await shot("crew-share-views");
    await clickText("Revoke link");
    await sleep(600);
    const gone = await fetch(`${URL}/api/invoice-view/${inv.share.key}`);
    if (gone.status !== 404) fail("revoked link still served: " + gone.status);
    if (await hasText("Link active until")) fail("share line still shown after revoke");
    console.log("  ok share revoked (404)");
    await shot("crew-share-revoked");
    // sanity: legacy plain-HTML share still readable
    await kvAdmin.put("/api/data", { lineGroupId: null });
  });

  await step("crew: Thai UI strings in modal", async () => {
    await page.evaluate(() => fetch("/api/logout", { method: "POST" })); await page.reload({ waitUntil: "networkidle0" }); // the session cookie survives a reload (P0-2): end it so the script re-logs in as before
    await loginNong();
    await clickText("TH");
    await sleep(300);
    await clickText("ใบแจ้งหนี้", "button", false);
    await sleep(400);
    await clickText("INV-NG-26-0001", "p", false);
    await sleep(300);
    await clickText("Edit", "button", false);
    await waitText("แก้ไขเอกสาร");
    if (!(await hasText("หัก ณ ที่จ่าย 3%"))) fail("Thai WHT toggle missing");
    await shot("crew-doc-modal-th");
    await clickText("ยกเลิก");
    await clickText("EN");
  });

  // ───────────── ADMIN ─────────────
  await step("admin login", async () => {
    await newPage({ width: 1280, height: 900 });
    await waitText("Crew / ทีมงาน");
    await clickText("Rental house admin", "button", false);
    await waitText("Enter PIN");
    await pin("9999");
    await waitText("Overview");
  });

  await step("admin invoice: nothing auto-minted, explicit quote from job", async () => {
    await clickText("Invoice"); await waitText("Production companies & team invoices");
    await sleep(800);
    const d0 = await kv();
    if (d0.invoices.some(i => i.employeeId === "admin")) fail("house documents minted on mount");
    if (!(await hasText("Jobs without a quotation"))) fail("pending-jobs card missing");
    await shot("admin-quo-tab-pending");
    await clickText("Create quote from job", "button", false, 1); // second row: Netflix
    await waitText("Create Document");
    await sleep(300);
    if (!(await hasText("QUO-LCR-26-0001"))) fail("house next number preview wrong");
    const headerVal = await page.evaluate(() => document.querySelector("input[placeholder='Lucky Cam Rental']")?.value);
    if (headerVal !== "Lucky Cam Rental") fail("house header default wrong: " + headerVal);
    await shot("admin-quote-modal");
    await clickText("Save Document");
    await waitText("QUO-LCR-26-0001 created", 3000);
    await sleep(400);
    await shot("admin-quote-created");
    await sleep(3500);
    const d1 = await kv();
    const quo = d1.invoices.find(i => i.invoiceNo === "QUO-LCR-26-0001");
    if (!quo || quo.employeeId !== "admin" || quo.jobId !== "job2") fail("quote not persisted properly");
    if (!(quo.items[0].rate === "12000" || quo.items[0].rate === 12000) || quo.items.length !== 1) fail("quote items not from admin position: " + JSON.stringify(quo.items));
    console.log("  ok quote", quo.invoiceNo, quo.items[0]);
  });

  await step("admin invoice: invoice from quote, mark paid confirm, issue receipt, void", async () => {
    await clickTab("INV");
    await sleep(400);
    if (!(await hasText("Confirmed jobs without an invoice"))) fail("INV pending card missing");
    await clickText("Create invoice from quote", "button", false);
    await waitText("Create Document");
    if (!(await hasText("INV-LCR-26-0001"))) fail("inv number preview wrong");
    await clickText("Save Document");
    await waitText("INV-LCR-26-0001 created", 3000);
    await sleep(500);
    await shot("admin-inv-created");
    await clickText("Mark Paid");
    await waitText("Mark as paid");
    if (!(await hasText("฿24,000"))) fail("paid amount wrong");
    await shot("admin-paid-dialog");
    await clickText("Confirm paid");
    await sleep(500);
    await clickText("Issue receipt", "button", false);
    await waitText("RTX-LCR-26-0001 issued", 3000);
    await sleep(3800);
    let d = await kv();
    const inv = d.invoices.find(i => i.invoiceNo === "INV-LCR-26-0001");
    const rtx = d.invoices.find(i => i.invoiceNo === "RTX-LCR-26-0001");
    if (!rtx || inv.status !== "Paid" || !inv.paidDate) fail("admin paid/receipt not persisted");
    console.log("  ok INV paid", inv.paidDate, "RTX", rtx.invoiceNo);
    await clickTab("RTX");
    await sleep(400);
    await shot("admin-rtx-tab");
    await clickTab("INV");
    await sleep(300);
    await clickText("Mark Pending");
    await waitText("Undo paid");
    await page.type("input[placeholder='e.g. Transfer bounced']", "Cheque returned");
    await clickText("Set back to Pending");
    await sleep(3800);
    d = await kv();
    const rtx2 = d.invoices.find(i => i.invoiceNo === "RTX-LCR-26-0001");
    if (rtx2.status !== "Void") fail("admin receipt not voided");
    await clickTab("RTX");
    await sleep(400);
    if (!(await hasText("Cheque returned"))) fail("void reason not listed");
    await shot("admin-rtx-void");
    console.log("  ok admin receipt voided");
  });

  await step("admin: zero-total document cannot be marked paid", async () => {
    await clickTab("QUO");
    await sleep(300);
    // create a zero quote for job3 (confirm dialog auto-accepted)
    await clickText("Create quote from job", "button", false, 0);
    await waitText("Create Document");
    // clear the rate of the auto item
    await page.evaluate(() => { const i = document.querySelector(".psr-line .f-rate"); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; setter.call(i, ""); i.dispatchEvent(new Event("input", { bubbles: true })); });
    await sleep(200);
    await clickText("Save Document");
    await sleep(800);
    if (await hasText("Create Document")) fail("zero quote (confirmed) did not save");
    await sleep(300);
    // convert: no Mark Paid on a QUO; instead check the crew-style dialog refuses ฿0 on an INV: create INV from that quote and open the dialog
    await clickTab("INV");
    await sleep(300);
  });

  await step("admin: companies tab tax id + presets save (P2-17)", async () => {
    await clickTab("Companies");
    await sleep(300);
    if (!(await hasText("Tax ID 0105559999999"))) fail("company tax id not listed");
    await shot("admin-companies");
    await clickText("My Info");
    await waitText("Invoice Item Presets");
    await clickText("Invoice Item Presets", "button", false);
    await waitText("Quick-add");
    await sleep(200);
    await clickText("Save");
    await sleep(800);
    if (!(await hasText("Saved"))) fail("presets Save did not report Saved");
    await shot("admin-presets-saved");
    const d = await kv();
    if (!Array.isArray(d.invoicePresets)) fail("presets not in KV");
    console.log("  ok presets saved via putData");
  });

  await step("admin: My Info tax id + positions OT example", async () => {
    await page.keyboard.press("Escape");
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find(b => b.querySelector("svg") && b.textContent.trim() === ""); });
    await page.evaluate(() => fetch("/api/logout", { method: "POST" })); await page.reload({ waitUntil: "networkidle0" }); // the session cookie survives a reload (P0-2): end it so the script re-logs in as before
    await waitText("Crew / ทีมงาน");
    await clickText("Rental house admin", "button", false);
    await waitText("Enter PIN");
    await pin("9999");
    await waitText("Overview");
    await clickText("Invoice"); await waitText("Production companies");
    await clickText("My Info");
    await waitText("Positions & Day Rate");
    await clickText("Positions & Day Rate", "button", false);
    await waitText("Positions & Day Rates");
    await sleep(300);
    if (!(await hasText("Example: ฿12,000 / 12h"))) fail("admin OT example missing");
    await shot("admin-positions-ot");
  });

  await step("admin: same modal on a phone gets two-row line items", async () => {
    await newPage({ width: 390, height: 844, isMobile: true });
    await waitText("Crew / ทีมงาน");
    await clickText("Rental house admin", "button", false);
    await waitText("Enter PIN");
    await pin("9999");
    await waitText("Overview");
    // bottom nav "Invoice"
    await clickText("Invoice", "button", false);
    await waitText("Production companies");
    await sleep(500);
    await clickText("Edit", "button", true, 0);
    await waitText("Edit Document");
    await page.evaluate(() => document.querySelector(".psr-line")?.scrollIntoView({ block: "center" }));
    await sleep(300);
    const w = await page.evaluate(() => document.querySelector(".psr-line .f-desc").getBoundingClientRect().width);
    if (w < 200) fail("admin mobile description narrow: " + w);
    await shot("admin-doc-lineitems-390");
  });

  const bad = errors.filter(e => !ALLOW.some(rx => rx.test(e)));
  if (bad.length) { console.error("Unexpected errors:\n  " + bad.join("\n  ")); process.exitCode = 1; }
  else console.log(`\nWALK PASSED (${shotN} screenshots in ${SHOTS}; ${errors.length} allowlisted lines)`);
} catch (e) {
  console.error("\nWALK FAILED: " + (e && e.message));
  process.exitCode = 1;
} finally {
  await browser.close();
}
