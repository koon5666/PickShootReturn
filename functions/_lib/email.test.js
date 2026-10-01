import { describe, it, expect, vi, afterEach } from "vitest";
import { fakeKV } from "../../tests/fakekv.js";
import { normalizeMessage, safeLink, renderEmail, allowedTargets, resolveRecipients, emailOf, indexProfileEmail, sendMails, deliver, crewHourlyOk, isEmail, cleanEmail, emailKey, CREW_HOURLY_LIMIT, APP_URL } from "./email.js";

const msg = (extra = {}) => normalizeMessage({ subject: "S", heading: "H", intro: "I", sections: [{ title: "T", rows: [["a", "b"]] }], ...extra });

describe("email: message shape", () => {
  it("keeps only the known shape and caps sizes", () => {
    const m = normalizeMessage({ subject: "x".repeat(500), sections: Array.from({ length: 20 }, () => ({ rows: Array.from({ length: 80 }, () => ["k", "v"]) })), tone: "evil", html: "<b>nope</b>" });
    expect(m.subject).toHaveLength(200);
    expect(m.sections).toHaveLength(12);
    expect(m.sections[0].rows).toHaveLength(60);
    expect(m.tone).toBe("info");
    expect(m.html).toBeUndefined();
  });
  it("refuses an empty message", () => {
    expect(normalizeMessage({ subject: "only a subject" })).toBeNull();
    expect(normalizeMessage({ intro: "no subject" })).toBeNull();
    expect(normalizeMessage(null)).toBeNull();
  });
  it("links only into the app; a relative path is made absolute", () => {
    expect(safeLink({ url: "https://evil.example/x" }, "http://localhost:8770").url).toBe("http://localhost:8770/");
    expect(safeLink({ url: "//evil.example" }, APP_URL).url).toBe(APP_URL + "/");
    expect(safeLink({ url: "/api/invoice-view/inv_share_1" }, "http://localhost:8770").url).toBe("http://localhost:8770/api/invoice-view/inv_share_1");
    expect(safeLink({ url: `${APP_URL}/api/invoice-view/inv_share_1` }, "http://localhost:8770").url).toBe(`${APP_URL}/api/invoice-view/inv_share_1`);
    expect(safeLink({ url: `${APP_URL}.evil.example/` }, APP_URL).url).toBe(APP_URL + "/");
  });
  it("escapes everything the client sent", () => {
    const m = normalizeMessage({ subject: "<script>", heading: "<img src=x onerror=1>", intro: "a & b\nline2", sections: [{ title: "<t>", rows: [["<k>", "\"v\""]], items: ["<li>"] }] });
    const { html, text } = renderEmail(m, { companyName: "<Co>" });
    expect(html).not.toMatch(/<script>|<img|<t>|<k>|<li>|<Co>/);
    expect(html).toContain("&lt;img src=x onerror=1&gt;");
    expect(html).toContain("a &amp; b<br>line2");
    expect(text).toContain("<k>: \"v\""); // plain text part is plain
  });
});

describe("email: who may be addressed", () => {
  const crew = { role: "employee", id: "e1" }, admin = { role: "admin", id: "admin" };
  it("crew: the house and themselves only", () => {
    expect(allowedTargets({ admin: true, allCrew: true, employeeIds: ["e1", "e2"] }, crew)).toEqual({ admin: true, allCrew: false, employeeIds: ["e1"] });
  });
  it("admin: anyone", () => {
    expect(allowedTargets({ allCrew: true, employeeIds: ["e2"] }, admin)).toEqual({ admin: false, allCrew: true, employeeIds: ["e2"] });
  });
  it("resolves addresses from the index, skips the ones without, dedupes, never mails a deleted member", async () => {
    const kv = fakeKV({ [emailKey("e1")]: "nong@x.co", [emailKey("e2")]: "", [emailKey("e3")]: "NONG@x.co" });
    const employees = [{ id: "e1", name: "Nong" }, { id: "e2", name: "Arthit" }, { id: "e3", name: "Dup" }, { id: "e4", name: "Gone", _deleted: true }];
    const r = await resolveRecipients(kv, { admin: true, allCrew: true, employeeIds: [] }, { employees, adminEmail: "house@x.co" });
    expect(r.recipients.map(x => x.email)).toEqual(["house@x.co", "nong@x.co"]);
    expect(r.skipped).toEqual([{ id: "e2", name: "Arthit", reason: "no email" }]);
  });
  it("an unindexed profile is read once and indexed", async () => {
    const kv = fakeKV({ profile_e9: { email: " Pim@Example.com ", photo: "data:image/jpeg;base64,xx" } });
    expect(await emailOf(kv, "e9")).toBe("pim@example.com");
    expect(kv.raw(emailKey("e9"))).toBe("pim@example.com");
    await indexProfileEmail(kv, "e9", { email: "" });
    expect(await emailOf(kv, "e9")).toBe("");
  });
  it("email shape", () => {
    expect(isEmail("a@b.co")).toBe(true);
    expect(isEmail("a@b")).toBe(false);
    expect(isEmail("a b@c.co")).toBe(false);
    expect(cleanEmail("Evil <a@b.co>")).toBe("");
  });
});

describe("email: transport", () => {
  afterEach(() => vi.unstubAllGlobals());
  const m = () => ({ to: "nong@x.co", subject: "S", html: "<p>h</p>", text: "h" });

  it("dry run keeps every mail in the outbox and counts it", async () => {
    const env = { KV: fakeKV(), EMAIL_DRY_RUN: "1" };
    const r = await sendMails(env, [m(), m()], Date.parse("2026-10-01T03:00:00Z"));
    expect(r).toMatchObject({ ok: true, sent: 2, dryRun: true });
    const out = env.KV.keys().filter(k => k.startsWith("outbox:"));
    expect(out).toHaveLength(2);
    expect(env.KV.json(out[0])).toMatchObject({ to: ["nong@x.co"], from: "Pick Shoot Return <pickshootreturn@wayn-industry.com>", subject: "S" });
    expect(env.KV.raw("email:day:2026-10-01")).toBe("2");
  });
  it("refuses past the daily cap (the Resend account is shared with WAYN)", async () => {
    const env = { KV: fakeKV({ "email:day:2026-10-01": "49" }), EMAIL_DRY_RUN: "1" };
    const r = await sendMails(env, [m(), m()], Date.parse("2026-10-01T03:00:00Z"));
    expect(r).toMatchObject({ ok: false, sent: 0, capped: true });
    env.EMAIL_DAILY_CAP = "100";
    expect((await sendMails(env, [m(), m()], Date.parse("2026-10-01T03:00:00Z"))).ok).toBe(true);
  });
  it("no key, no dry run: says so instead of pretending", async () => {
    expect(await sendMails({ KV: fakeKV() }, [m()])).toMatchObject({ ok: false, sent: 0 });
  });
  it("Resend: one batch call, one mail per recipient, redirect puts the real recipient in the subject", async () => {
    const calls = [];
    vi.stubGlobal("fetch", async (url, init) => { calls.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization }); return new Response(JSON.stringify({ data: [] }), { status: 200 }); });
    const env = { KV: fakeKV(), RESEND_API_KEY: "re_test", EMAIL_REDIRECT_TO: "koon@x.co" };
    const r = await sendMails(env, [m(), { ...m(), to: "arthit@x.co", replyTo: "house@x.co" }]);
    expect(r).toMatchObject({ ok: true, sent: 2 });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.resend.com/emails/batch");
    expect(calls[0].auth).toBe("Bearer re_test");
    expect(calls[0].body.map(x => x.to)).toEqual([["koon@x.co"], ["koon@x.co"]]);
    expect(calls[0].body[1]).toMatchObject({ subject: "[for arthit@x.co] S", reply_to: "house@x.co" });
  });
  it("a Resend error is surfaced, not swallowed", async () => {
    vi.stubGlobal("fetch", async () => new Response("{\"message\":\"daily quota\"}", { status: 429 }));
    const r = await sendMails({ KV: fakeKV(), RESEND_API_KEY: "re_test" }, [m()]);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Resend 429/);
  });
  it("deliver renders once and does not set Reply-To to the recipient themselves", async () => {
    const env = { KV: fakeKV(), EMAIL_DRY_RUN: "1" };
    await deliver(env, msg(), [{ email: "nong@x.co" }, { email: "house@x.co" }], { replyTo: "house@x.co" });
    const mails = env.KV.keys().filter(k => k.startsWith("outbox:")).map(k => env.KV.json(k));
    expect(mails.find(x => x.to[0] === "nong@x.co").reply_to).toBe("house@x.co");
    expect(mails.find(x => x.to[0] === "house@x.co").reply_to).toBeUndefined();
  });
  it("crew hourly limit", async () => {
    const kv = fakeKV();
    const now = Date.parse("2026-10-01T03:10:00Z");
    expect(await crewHourlyOk(kv, "e1", CREW_HOURLY_LIMIT, now)).toBe(true);
    expect(await crewHourlyOk(kv, "e1", 1, now)).toBe(false);
    expect(await crewHourlyOk(kv, "e2", 1, now)).toBe(true);
    expect(await crewHourlyOk(kv, "e1", 1, now + 3600_000)).toBe(true);
  });
});
