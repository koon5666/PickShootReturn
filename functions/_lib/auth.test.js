import { describe, it, expect } from "vitest";
import {
  hashPin, verifyPin, isPinHash, parsePinHash, PBKDF2_ITERATIONS,
  signToken, verifyToken, sessionPayload, publicUser, SESSION_TTL_S,
  parseCookies, sessionCookie, clearSessionCookie, originOk, requireSession, getSession,
  rateState, rateRecordFail, stripCredentials, isOwner,
} from "./auth.js";

const SECRET = "unit-test-secret-that-is-long-enough";
const req = (url, { method = "GET", headers = {} } = {}) => new Request(url, { method, headers });

describe("PIN hashing (PBKDF2-SHA256)", () => {
  it("hashes with 100k iterations and a random per-user salt", async () => {
    const a = await hashPin("1234"), b = await hashPin("1234");
    expect(a).not.toBe(b);
    const p = parsePinHash(a);
    expect(p.iterations).toBe(PBKDF2_ITERATIONS);
    expect(p.iterations).toBeGreaterThanOrEqual(100_000);
    expect(p.salt.length).toBe(16);
    expect(p.hash.length).toBe(32);
    expect(isPinHash(a)).toBe(true);
  });
  it("verifies the right PIN and rejects a wrong / malformed one", async () => {
    const h = await hashPin("9999");
    expect(await verifyPin("9999", h)).toBe(true);
    expect(await verifyPin("9998", h)).toBe(false);
    expect(await verifyPin("", h)).toBe(false);
    expect(await verifyPin("9999", "9999")).toBe(false);      // plaintext is never a hash
    expect(await verifyPin("9999", null)).toBe(false);
    expect(isPinHash("pbkdf2-sha256$0$x$y")).toBe(false);
  });
});

describe("session token", () => {
  it("round-trips a payload and keeps the admin identity fields", async () => {
    const p = sessionPayload({ role: "admin", id: "admin", name: "Somchai", staffId: "owner", staffRole: "owner" }, 1_000_000_000_000);
    expect(p.exp - p.iat).toBe(SESSION_TTL_S);
    const tok = await signToken(p, SECRET);
    const back = await verifyToken(tok, SECRET, 1_000_000_000_000 + 1000);
    expect(back).toEqual(p);
    expect(publicUser(back)).toEqual({ role: "admin", id: "admin", name: "Somchai", staffId: "owner", staffRole: "owner" });
    expect(isOwner(back)).toBe(true);
  });
  it("rejects a tampered payload, a wrong secret and an expired token", async () => {
    const p = sessionPayload({ role: "employee", id: "e1", name: "Nong" }, 1_000_000_000_000);
    const tok = await signToken(p, SECRET);
    expect(await verifyToken(tok, "another-secret-that-is-long-enough", 1_000_000_000_000)).toBeNull();
    const [body, sig] = tok.split(".");
    const forged = btoa(JSON.stringify({ ...p, role: "admin" })).replace(/=+$/, "") + "." + sig;
    expect(await verifyToken(forged, SECRET, 1_000_000_000_000)).toBeNull();
    expect(await verifyToken(tok, SECRET, (p.exp + 1) * 1000)).toBeNull();
    expect(await verifyToken("garbage", SECRET)).toBeNull();
    expect(await verifyToken(body, SECRET)).toBeNull();
  });
  it("employee sessions carry no staff fields", () => {
    expect(publicUser(sessionPayload({ role: "employee", id: "e1", name: "Nong" }))).toEqual({ role: "employee", id: "e1", name: "Nong" });
  });
});

describe("cookie", () => {
  it("builds an httpOnly SameSite=Lax cookie, Secure only on https", () => {
    const c = sessionCookie("abc", { secure: true });
    expect(c).toMatch(/^psr_session=abc; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure$/);
    expect(sessionCookie("abc", { secure: false })).not.toMatch(/Secure/);
    expect(clearSessionCookie({ secure: true })).toMatch(/Max-Age=0; Secure$/);
    expect(parseCookies("a=1; psr_session=tok.sig; b=2")).toEqual({ a: "1", psr_session: "tok.sig", b: "2" });
    expect(parseCookies(null)).toEqual({});
  });
});

describe("requireSession gate", () => {
  const env = { SESSION_SECRET: SECRET };
  it("refuses to run without SESSION_SECRET", async () => {
    const r = await requireSession({ request: req("https://x.test/api/data"), env: {} });
    expect(r.ok).toBe(false);
    expect(r.response.status).toBe(500);
    expect((await r.response.json()).error).toMatch(/SESSION_SECRET/);
  });
  it("401 without a cookie, 200 with a valid one, 403 for role checks", async () => {
    const none = await requireSession({ request: req("https://x.test/api/data"), env });
    expect(none.ok).toBe(false); expect(none.response.status).toBe(401);
    const tok = await signToken(sessionPayload({ role: "employee", id: "e1", name: "Nong" }), SECRET);
    const ctx = { request: req("https://x.test/api/data", { headers: { Cookie: `psr_session=${tok}` } }), env };
    const ok = await requireSession(ctx);
    expect(ok.ok).toBe(true); expect(ok.session.id).toBe("e1");
    const admin = await requireSession(ctx, { admin: true });
    expect(admin.ok).toBe(false); expect(admin.response.status).toBe(403);
    const counter = await signToken(sessionPayload({ role: "admin", id: "admin", name: "Bee", staffId: "st1", staffRole: "counter" }), SECRET);
    const cctx = { request: req("https://x.test/api/data", { headers: { Cookie: `psr_session=${counter}` } }), env };
    expect((await requireSession(cctx, { admin: true })).ok).toBe(true);
    const owner = await requireSession(cctx, { owner: true });
    expect(owner.ok).toBe(false); expect(owner.response.status).toBe(403);
    expect(await getSession(req("https://x.test/x", { headers: { Cookie: "psr_session=bad" } }), env)).toBeNull();
  });
  it("refuses a mutating request from another origin, allows same-origin and no-Origin", async () => {
    const tok = await signToken(sessionPayload({ role: "admin", id: "admin", name: "A" }), SECRET);
    const cookie = { Cookie: `psr_session=${tok}` };
    expect(originOk(req("https://x.test/api/data", { method: "PUT", headers: { Origin: "https://evil.test" } }))).toBe(false);
    expect(originOk(req("https://x.test/api/data", { method: "PUT", headers: { Origin: "https://x.test" } }))).toBe(true);
    expect(originOk(req("https://x.test/api/data", { method: "PUT" }))).toBe(true);
    expect(originOk(req("https://x.test/api/data", { method: "GET", headers: { Origin: "https://evil.test" } }))).toBe(true);
    const r = await requireSession({ request: req("https://x.test/api/data", { method: "PUT", headers: { ...cookie, Origin: "https://evil.test" } }), env });
    expect(r.ok).toBe(false); expect(r.response.status).toBe(403);
  });
});

describe("rate window (5 per 60 s)", () => {
  it("blocks on the 5th failure and frees when the oldest falls out of the window", () => {
    let st = null;
    const t0 = 1_000_000;
    for (let i = 0; i < 4; i++) { st = rateRecordFail(st, t0 + i * 1000); expect(rateState(st, t0 + i * 1000).blocked).toBe(false); }
    st = rateRecordFail(st, t0 + 4000);
    const b = rateState(st, t0 + 4000);
    expect(b.blocked).toBe(true);
    expect(b.retryAfter).toBe(56); // oldest at t0 expires at t0+60s
    expect(rateState(st, t0 + 60_001).blocked).toBe(false);
    expect(rateState(st, t0 + 60_001).fails.length).toBe(4);
    expect(rateState({ fails: ["x", null] }, t0).fails).toEqual([]);
  });
});

describe("stripCredentials", () => {
  it("removes every PIN-bearing field from a data payload", () => {
    const out = stripCredentials({
      adminPin: "9999", adminPinHash: "pbkdf2$…", companyName: "X",
      employees: [{ id: "e1", name: "Nong", pin: "1111" }, { id: "e2", name: "A", pinHash: "h" }],
      staff: [{ id: "owner", name: "Somchai", role: "owner" }, { id: "st1", name: "Bee", role: "counter", pinHash: "h" }],
      adminRequests: [{ id: "r1", type: "member-register", name: "New", requestedPin: "5678", requestedPinHash: "h", contact: "081" }],
    });
    expect(out.adminPin).toBeUndefined(); expect(out.adminPinHash).toBeUndefined();
    expect(out.companyName).toBe("X");
    expect(out.employees).toEqual([{ id: "e1", name: "Nong" }, { id: "e2", name: "A" }]);
    expect(out.staff).toEqual([{ id: "owner", name: "Somchai", role: "owner" }, { id: "st1", name: "Bee", role: "counter" }]);
    expect(out.adminRequests).toEqual([{ id: "r1", type: "member-register", name: "New", contact: "081" }]);
    expect(JSON.stringify(out)).not.toMatch(/pin/i);
  });
});
