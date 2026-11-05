// Dashboard "Push to LINE group": the handler in functions/api/daily-summary.js,
// tested here because every file under functions/api/ becomes a route.
import { describe, it, expect, vi, afterEach } from "vitest";
import { onRequestGet, onRequestPost } from "../api/daily-summary.js";
import { COOKIE_NAME, sessionPayload, signToken } from "./auth.js";
import { addDays } from "../../src/logic/availability.js";
import { todayIn } from "./digest.js";
import { fakeKV } from "../../tests/fakekv.js";

const SECRET = "x".repeat(32);
const T = todayIn("Asia/Bangkok");
const URL_ = "https://psr.test/api/daily-summary";

function setup({ groupId = "Cgroup", jobs = [{ id: "j1", name: "Later", production: "P", status: "Confirmed", dates: [addDays(T, 5)] }], extra = {} } = {}) {
  const kv = fakeKV({ jobs, equipment: [], checkouts: [], equipmentRequests: [], employees: [], lineGroupId: JSON.stringify(groupId), ...extra });
  return { KV: kv, SESSION_SECRET: SECRET, LINE_CHANNEL_ACCESS_TOKEN: "tok", DIGEST_TOKEN: "cron-token", EMAIL_DRY_RUN: "1" };
}
const cookie = async (user) => `${COOKIE_NAME}=${await signToken(sessionPayload(user), SECRET)}`;
const admin = () => cookie({ role: "admin", id: "admin", name: "Koon" });
const crew = () => cookie({ role: "employee", id: "e1", name: "Nong" });
const req = (method, cookieHeader, body, url = URL_) => new Request(url, { method, headers: { ...(cookieHeader ? { Cookie: cookieHeader } : {}), "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });

// A stand-in for LINE: records pushes and answers the three read-only quota calls.
function fakeLine({ pushStatus = 200 } = {}) {
  const pushes = [];
  const fn = vi.fn(async (url, init) => {
    const u = String(url);
    if (u.endsWith("/v2/bot/message/push")) { pushes.push(JSON.parse(init.body)); return new Response("{}", { status: pushStatus }); }
    if (u.endsWith("/v2/bot/message/quota")) return Response.json({ type: "limited", value: 300 });
    if (u.endsWith("/v2/bot/message/quota/consumption")) return Response.json({ totalUsage: 120 });
    if (u.includes("/members/count")) return Response.json({ count: 6 });
    throw new Error("unexpected fetch " + u);
  });
  vi.stubGlobal("fetch", fn);
  return { pushes, fn };
}
afterEach(() => vi.unstubAllGlobals());

describe("POST { manual: true }", () => {
  it("posts the calendar to the group on a quiet day and records who pushed", async () => {
    const line = fakeLine();
    const env = setup();
    const r = await onRequestPost({ env, request: req("POST", await admin(), { manual: true }) });
    const b = await r.json();
    expect(b).toMatchObject({ ok: true, posted: true, by: "Koon" });
    expect(line.pushes).toHaveLength(1);
    expect(line.pushes[0].to).toBe("Cgroup");
    expect(line.pushes[0].messages[0].text).toContain("UPCOMING BOOKINGS");
    expect(await env.KV.get("digest:manual", "json")).toMatchObject({ by: "Koon" });
  });
  it("does not use up the 08:00 post: the cron still goes afterwards", async () => {
    const line = fakeLine();
    const env = setup({ jobs: [{ id: "j1", name: "On", production: "P", status: "Confirmed", dates: [T] }] });
    await onRequestPost({ env, request: req("POST", await admin(), { manual: true }) });
    expect(await env.KV.get("digest:daily", "json")).toBeNull();
    const cron = new Request(URL_, { method: "POST", headers: { "X-Digest-Token": "cron-token" } });
    const b = await (await onRequestPost({ env, request: cron })).json();
    expect(b.posted).toBe(true);
    expect(line.pushes).toHaveLength(2);
    expect(line.pushes[1].messages[0].text.startsWith("☀️ Daily summary")).toBe(true);
  });
  it("sends no overdue emails; the same data does email on the 08:00 run", async () => {
    fakeLine();
    const env = setup({
      jobs: [{ id: "j1", name: "Old", production: "P", status: "Confirmed", dates: [addDays(T, -3)] }, { id: "j2", name: "Later", production: "P", status: "Confirmed", dates: [addDays(T, 5)] }],
      extra: {
        equipment: [{ id: "eq1", name: "FX6", total: 1 }], employees: [{ id: "e1", name: "Nong" }], "pemail:e1": "nong@example.com",
        checkouts: [{ id: "c1", jobId: "j1", jobName: "Old", eqId: "eq1", qty: 1, employeeId: "e1", employeeName: "Nong", type: "pick", ts: Date.now() - 4 * 86_400_000 }],
      },
    });
    const b = await (await onRequestPost({ env, request: req("POST", await admin(), { manual: true }) })).json();
    expect(b.posted).toBe(true);
    expect((await env.KV.list({ prefix: "outbox:" })).keys).toHaveLength(0);
    const cron = new Request(URL_, { method: "POST", headers: { "X-Digest-Token": "cron-token" } });
    expect((await (await onRequestPost({ env, request: cron })).json()).emailed).toBe(1);
    expect((await env.KV.list({ prefix: "outbox:" })).keys).toHaveLength(1);
  });
  it("ignores the Settings switch, which is about the automatic post", async () => {
    const line = fakeLine();
    const env = setup({ extra: { lineSummary: { enabled: false } } });
    const b = await (await onRequestPost({ env, request: req("POST", await admin(), { manual: true }) })).json();
    expect(b.posted).toBe(true);
    expect(line.pushes).toHaveLength(1);
  });
  it("is refused for crew and for no session, and never reaches LINE", async () => {
    const line = fakeLine();
    const env = setup();
    expect((await onRequestPost({ env, request: req("POST", await crew(), { manual: true }) })).status).toBe(403);
    expect((await onRequestPost({ env, request: req("POST", null, { manual: true }) })).status).toBe(401);
    expect((await onRequestGet({ env, request: req("GET", await crew(), null, URL_ + "?manual=1") })).status).toBe(403);
    expect(line.fn).not.toHaveBeenCalled();
  });
  it("says so when LINE is out of messages and records no push", async () => {
    fakeLine({ pushStatus: 429 });
    const env = setup();
    const r = await onRequestPost({ env, request: req("POST", await admin(), { manual: true }) });
    expect(r.status).toBe(502);
    expect((await r.json()).error).toMatch(/monthly message limit/);
    expect(await env.KV.get("digest:manual", "json")).toBeNull();
  });
  it("posts nothing with no group connected or an empty book", async () => {
    const line = fakeLine();
    const noGroup = await (await onRequestPost({ env: setup({ groupId: null }), request: req("POST", await admin(), { manual: true }) })).json();
    expect(noGroup).toMatchObject({ ok: true, posted: false, lineReason: "no LINE group connected" });
    const empty = await (await onRequestPost({ env: setup({ jobs: [] }), request: req("POST", await admin(), { manual: true }) })).json();
    expect(empty.posted).toBe(false);
    expect(line.pushes).toHaveLength(0);
  });
});

describe("POST without manual", () => {
  it("cannot post the 08:00 summary twice: { force: true } is gone", async () => {
    const line = fakeLine();
    const env = setup({ jobs: [{ id: "j1", name: "On", production: "P", status: "Confirmed", dates: [T] }] });
    const cron = () => new Request(URL_, { method: "POST", headers: { "X-Digest-Token": "cron-token" } });
    await onRequestPost({ env, request: cron() });
    const b = await (await onRequestPost({ env, request: req("POST", await admin(), { force: true }) })).json();
    expect(b.skipped).toBe("already sent today");
    expect(line.pushes).toHaveLength(1);
  });
});

describe("GET ?manual=1", () => {
  it("previews the exact post with its cost, and sends nothing", async () => {
    const line = fakeLine();
    const b = await (await onRequestGet({ env: setup(), request: req("GET", await admin(), null, URL_ + "?manual=1") })).json();
    expect(b.text).toContain("UPCOMING BOOKINGS");
    expect(b.budget).toMatchObject({ members: 6, left: 180, blocked: false });
    expect(line.pushes).toHaveLength(0);
  });
  it("still previews when LINE does not answer the quota calls", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 500 })));
    const b = await (await onRequestGet({ env: setup(), request: req("GET", await admin(), null, URL_ + "?manual=1") })).json();
    expect(b.text).toContain("UPCOMING BOOKINGS");
    expect(b.budget).toEqual({ members: null, left: null, blocked: false, daysLost: 0 });
  });
});
