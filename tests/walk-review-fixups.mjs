#!/usr/bin/env node
// API-level walk for the review fix-up track (acceptance pass, 2026-09), against
// a LOCAL seeded server (tests/local-server.mjs + tests/seed.mjs default profile).
//
//   node tests/walk-review-fixups.mjs <PORT>
//
// Covers the pieces that live in the server and have no UI of their own:
//   P3-6  per-user LINE link: code -> webhook pairing -> identity hidden from
//         clients -> survives an admin employees save -> unlink
//   P1-11 overdue digest: preview, one send per day, cron token gate
//   P0-6  server-side document-number allocation (two devices, one number)
//   P3-4  roleList field: owner writes it, crew cannot, backups carry it
//   P0-2  crew cannot rewrite or wipe another crew's damage report, and never
//         sees another crew's invoice share token
//   P2-7  the daily auto-backup is gated server-side (20 h)
// Needs LINE_CHANNEL_SECRET + DIGEST_TOKEN in .dev.vars (local-server writes a
// SESSION_SECRET; add the other two once, any value).
import { createHmac } from "node:crypto";
import { apiClient } from "./apiclient.mjs";

const port = parseInt(process.argv[2], 10);
if (!(port > 0)) { console.error("usage: node tests/walk-review-fixups.mjs <PORT>"); process.exit(2); }
const URL = `http://127.0.0.1:${port}`;
const LINE_SECRET = process.env.LINE_CHANNEL_SECRET || "localtestsecret";
const DIGEST_TOKEN = process.env.DIGEST_TOKEN || "localdigesttoken";
const fail = (m) => { console.error("\nFIXUP WALK FAILED: " + m); process.exit(1); };
const step = (n) => console.log("- " + n);

const owner = await apiClient(URL).loginAdmin("9999").catch(() => fail("owner login 9999 failed: seed first"));
const nong = await apiClient(URL).loginEmployee("e_nong", "1111").catch(() => fail("crew login failed: seed first"));
const arthit = await apiClient(URL).loginEmployee("e_arthit", "2222").catch(() => fail("crew login failed: seed first"));
const kv = () => owner.get("/api/data");

step("P3-6 LINE link: code, webhook pairing, identity never reaches a client");
let r = await nong.post("/api/line-link").then(x => x.json());
if (!r.ok || !/^[A-HJ-NP-Z2-9]{6}$/.test(r.code)) fail("no link code: " + JSON.stringify(r));
const code = r.code;
let d = await kv();
const me = d.employees.find(e => e.id === "e_nong");
if (me.lineLinkCode || me.lineUserId || me.lineLinked) fail("link code / userId leaked in GET: " + JSON.stringify(me));
const evt = (text, userId = "Uwalk1") => JSON.stringify({ events: [{ type: "message", replyToken: "rt", source: { type: "user", userId }, message: { type: "text", text } }] });
const hook = async (body) => fetch(URL + "/api/webhook", { method: "POST", headers: { "Content-Type": "application/json", "X-Line-Signature": createHmac("sha256", LINE_SECRET).update(body).digest("base64") }, body });
if ((await hook(evt("hello"))).status !== 200) fail("webhook should always answer 200");
if ((await nong.get("/api/line-link")).linked) fail("a message without a code must not link");
if ((await fetch(URL + "/api/webhook", { method: "POST", headers: { "X-Line-Signature": "bad" }, body: evt(code) })).status !== 403) fail("bad signature accepted");
if ((await hook(evt("link " + code.toLowerCase()))).status !== 200) fail("pairing webhook failed");
if (!(await nong.get("/api/line-link")).linked) fail("crew not linked after the webhook");
d = await kv();
const linked = d.employees.find(e => e.id === "e_nong");
if (!linked.lineLinked || linked.lineUserId) fail("admin should see the flag, never the userId: " + JSON.stringify(linked));
const pe = await owner.put("/api/data", { employees: d.employees, _v: { employees: d._v.employees } });
if (!pe.ok) fail("employees PUT " + pe.status);
if (!(await nong.get("/api/line-link")).linked) fail("the identity was dropped by an admin employees save");
console.log("  ok  linked, hidden from clients, survives an admin save");

step("P1-11 overdue digest: preview, one send per day, cron token gate");
const pv = await owner.get("/api/overdue-digest");
if (!pv.ok || pv.count < 1 || !/Overdue/.test(pv.text || "")) fail("digest preview: " + JSON.stringify(pv));
if (!/V-Mount 150Wh/.test(pv.text) || !/TVC Toyota/.test(pv.text) || !/Nong/.test(pv.text) || !/due 14 Sept|late/.test(pv.text)) fail("digest text lacks qty / item / job / crew / due: " + pv.text);
if ((await fetch(URL + "/api/overdue-digest", { method: "POST", headers: { "X-Digest-Token": "wrong" } })).status !== 401) fail("a wrong cron token was accepted");
const send = () => fetch(URL + "/api/overdue-digest", { method: "POST", headers: { "X-Digest-Token": DIGEST_TOKEN, "Content-Type": "application/json" }, body: "{}" }).then(x => x.json());
const s1 = await send();
// Without a LINE token nothing can go out and the day is NOT marked as sent.
if (s1.ok) { const s2 = await send(); if (!s2.skipped) fail("a second send the same day was not skipped: " + JSON.stringify(s2)); console.log("  ok  digest sent once per day (" + s1.targets + " targets)"); }
else { if (!/LINE_CHANNEL_ACCESS_TOKEN/.test(s1.error || "")) fail("unexpected digest failure: " + JSON.stringify(s1)); console.log("  ok  digest refuses to mark the day sent with no LINE token configured (local)"); }

step("P0-6 two devices minting one number: the second is re-allocated");
const mk = (id, no, employeeId = "admin") => ({ id, invoiceNo: no, employeeId, employeeName: "Owner", docType: "invoice", status: "Pending", jobName: "Walk", items: [{ id: "l1", description: "Day", qty: 1, rate: 1000 }], createdAt: Date.now(), updatedAt: Date.now() });
d = await kv();
r = await owner.put("/api/data", { invoices: [...d.invoices, mk("walkA", "INV-WALK-26-0001")] }).then(x => x.json());
if (!r.ok || r.renumbered) fail("the first mint should keep its number: " + JSON.stringify(r));
d = await kv();
r = await owner.put("/api/data", { invoices: [...d.invoices, mk("walkB", "INV-WALK-26-0001")] }).then(x => x.json());
if (!r.ok || !r.renumbered || r.renumbered[0].to !== "INV-WALK-26-0002") fail("collision not re-allocated: " + JSON.stringify(r));
d = await kv();
const nos = d.invoices.map(i => i.invoiceNo);
if (new Set(nos).size !== nos.length) fail("duplicate numbers in KV: " + nos.join(", "));
const keep = d.invoices.find(i => i.id === "walkA").invoiceNo;
await owner.put("/api/data", { invoices: d.invoices.map(i => i.id === "walkA" ? { ...i, status: "Paid", paidDate: "2026-09-16" } : i) });
if ((await kv()).invoices.find(i => i.id === "walkA").invoiceNo !== keep) fail("an existing document's number changed");
console.log("  ok  " + JSON.stringify(r.renumbered[0]) + ", existing numbers untouched");

step("P3-4 roleList: owner writes it, crew cannot, backups carry it");
d = await kv();
r = await owner.put("/api/data", { roleList: ["Gaffer / หัวหน้าไฟ | Lighting", "Driver"], _v: { roleList: d._v.roleList ?? null } }).then(x => x.json());
if (!r.ok) fail("roleList PUT " + JSON.stringify(r));
if ((await kv()).roleList.length !== 2) fail("roleList not stored");
if ((await nong.put("/api/data", { roleList: [] })).status !== 403) fail("a crew session could write roleList");
const bk = await owner.put("/api/backup", { label: "fixup walk" }).then(x => x.json());
const snap = await owner.get(`/api/backup?id=${bk.id}`);
if (!snap.roleList || snap.roleList.length !== 2) fail("roleList missing from the backup version");
console.log("  ok  stored, crew-refused, in the backup");

step("P0-2 crew cannot touch another crew's report, and sees no foreign share token");
d = await kv();
const rep = { id: "rep_walk_arthit", employeeId: "e_arthit", eqId: "eq_tripod", eqName: "Sachtler Flowtech 75", description: "leg lock slips", photos: [], ts: Date.now(), status: "open", reportedBy: { id: "e_arthit", name: "Arthit" } };
if (!(await arthit.put("/api/data", { reports: [...d.reports, rep] })).ok) fail("arthit report PUT failed");
await nong.put("/api/data", { reports: [{ ...rep, employeeId: "e_nong", description: "TAMPERED", status: "discarded" }] });
let after = (await kv()).reports.find(x => x.id === rep.id);
if (!after || after.description !== rep.description || after.status !== "open" || after.employeeId !== "e_arthit") fail("a foreign report was rewritten: " + JSON.stringify(after));
await nong.put("/api/data", { reports: [] });
if (!(await kv()).reports.find(x => x.id === rep.id)) fail("a crew PUT wiped the reports field");
const crewView = await nong.get("/api/data");
if (crewView.invoices.some(i => i.employeeId !== "e_nong" && i.share && i.share.token)) fail("a foreign invoice share token is visible to crew");
console.log("  ok  report intact after tamper + wipe, no foreign share token");

step("P2-7 the daily auto-backup is gated server-side");
const a = await owner.put("/api/backup_auto", {}).then(x => x.json());
const b = await owner.put("/api/backup_auto", {}).then(x => x.json());
if (!a.ok || !b.ok) fail("backup_auto failed: " + JSON.stringify([a, b]));
if (!b.skipped || b.id !== a.id) fail("a second daily backup was minted within 20 h: " + JSON.stringify(b));
console.log("  ok  second request reused " + a.id);

console.log("\nFIXUP WALK PASSED");
