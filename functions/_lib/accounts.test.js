import { describe, it, expect } from "vitest";
import { fakeKV } from "../../tests/fakekv.js";
import { hashPin, isPinHash } from "./auth.js";
import {
  verifyOwnerPin, setOwnerPin, adoptPlainAdminPin, verifyEmployeePin, setEmployeePin, changeOwnPin,
  protectEmployees, addStaff, verifyStaffPin, setStaffPin, removeStaff, renameStaff, ensureCalendarToken, rotateCalendarToken,
  ownerSession, staffSession,
  protectRequests,
} from "./accounts.js";
import { rateCheck, rateFail, rateClear, rateKey } from "./ratelimit.js";

describe("owner PIN: legacy plaintext accepted once, then hashed", () => {
  it("prod-style adminPin '9999' logs in and is upgraded to adminPinHash with the plaintext gone", async () => {
    const kv = fakeKV({ adminPin: JSON.stringify("9999") }); // stored as the JSON string the app writes
    expect((await verifyOwnerPin(kv, "1234")).ok).toBe(false);
    expect(kv.raw("adminPin")).toBe(JSON.stringify("9999")); // a failure never upgrades
    const r = await verifyOwnerPin(kv, "9999");
    expect(r.ok).toBe(true); expect(r.upgraded).toBe(true);
    expect(kv.raw("adminPin")).toBeNull();
    expect(isPinHash(kv.json("adminPinHash"))).toBe(true);
    expect((await verifyOwnerPin(kv, "9999")).ok).toBe(true);
    expect((await verifyOwnerPin(kv, "9998")).ok).toBe(false);
  });
  it("a raw non-JSON legacy value is the literal PIN, not a missing one", async () => {
    const kv = fakeKV({ adminPin: "7777" });
    expect((await verifyOwnerPin(kv, "1234")).ok).toBe(false);
    expect((await verifyOwnerPin(kv, "7777")).ok).toBe(true);
    expect(kv.raw("adminPin")).toBeNull();
  });
  it("a brand-new KV accepts the default 1234 once (bootstrap) and never the wrong one", async () => {
    const kv = fakeKV();
    expect((await verifyOwnerPin(kv, "0000")).ok).toBe(false);
    expect((await verifyOwnerPin(kv, "1234")).ok).toBe(true);
    expect((await verifyOwnerPin(kv, "1234")).ok).toBe(true);
    await setOwnerPin(kv, "4321");
    expect((await verifyOwnerPin(kv, "1234")).ok).toBe(false);
    expect((await verifyOwnerPin(kv, "4321")).ok).toBe(true);
  });
  it("a plaintext adminPin on an admin PUT becomes the hash right away", async () => {
    const kv = fakeKV({ adminPin: JSON.stringify("1111") });
    expect(await adoptPlainAdminPin(kv, "12")).toBe(false);
    expect(await adoptPlainAdminPin(kv, "5555")).toBe(true);
    expect(kv.raw("adminPin")).toBeNull();
    expect((await verifyOwnerPin(kv, "5555")).ok).toBe(true);
  });
});

describe("employee PIN: legacy upgrade, admin set, self change", () => {
  const seed = () => fakeKV({ employees: [{ id: "e1", name: "Nong", pin: "1111" }, { id: "e2", name: "Arthit", pin: "2222" }] });
  it("logs in with the legacy pin once and stores only a hash afterwards", async () => {
    const kv = seed();
    expect((await verifyEmployeePin(kv, "e1", "9999")).ok).toBe(false);
    const r = await verifyEmployeePin(kv, "e1", "1111");
    expect(r.ok).toBe(true); expect(r.upgraded).toBe(true);
    const list = kv.json("employees");
    expect(list[0].pin).toBeUndefined(); expect(isPinHash(list[0].pinHash)).toBe(true);
    expect(list[1].pin).toBe("2222"); // untouched until Arthit logs in
    expect((await verifyEmployeePin(kv, "e1", "1111")).ok).toBe(true);
    expect((await verifyEmployeePin(kv, "nobody", "1111")).ok).toBe(false);
  });
  it("an employee with no credential cannot log in", async () => {
    const kv = fakeKV({ employees: [{ id: "e9", name: "Ghost" }] });
    expect(await verifyEmployeePin(kv, "e9", "1234")).toMatchObject({ ok: false, reason: "no-credential" });
  });
  it("admin sets / resets a pin and can create the member in the same call", async () => {
    const kv = seed();
    const r = await setEmployeePin(kv, "e2", "7777");
    expect(r.created).toBe(false);
    expect(r.employees.every(e => e.pin === undefined && e.pinHash === undefined)).toBe(true);
    expect((await verifyEmployeePin(kv, "e2", "2222")).ok).toBe(false);
    expect((await verifyEmployeePin(kv, "e2", "7777")).ok).toBe(true);
    expect(await setEmployeePin(kv, "e3", "3333")).toBeNull();
    const c = await setEmployeePin(kv, "e3", "3333", { name: "Ploy" });
    expect(c.created).toBe(true);
    expect(kv.json("employees").find(e => e.id === "e3")).toMatchObject({ name: "Ploy" });
    expect((await verifyEmployeePin(kv, "e3", "3333")).ok).toBe(true);
    await expect(setEmployeePin(kv, "e1", "12")).rejects.toThrow();
  });
  it("self change needs the current pin, for crew, owner and staff", async () => {
    const kv = seed();
    expect(await changeOwnPin(kv, { role: "employee", id: "e1" }, "0000", "5555")).toMatchObject({ ok: false, wrong: true });
    expect((await changeOwnPin(kv, { role: "employee", id: "e1" }, "1111", "5555")).ok).toBe(true);
    expect((await verifyEmployeePin(kv, "e1", "5555")).ok).toBe(true);
    expect((await changeOwnPin(kv, { role: "employee", id: "e1" }, "5555", "12")).ok).toBe(false);
    await kv.put("adminPin", JSON.stringify("9999"));
    expect((await changeOwnPin(kv, ownerSession("Boss"), "9999", "8888")).ok).toBe(true);
    expect((await verifyOwnerPin(kv, "8888")).ok).toBe(true);
    const st = await addStaff(kv, { name: "Bee", role: "counter", pin: "2468" });
    const s = staffSession({ ...st.entry });
    expect((await changeOwnPin(kv, s, "0000", "1357")).ok).toBe(false);
    expect((await changeOwnPin(kv, s, "2468", "1357")).ok).toBe(true);
    expect((await verifyStaffPin(kv, st.entry.id, "1357")).ok).toBe(true);
  });
});

describe("protectEmployees (admin PUT of the employees array)", () => {
  it("carries credentials from KV, hashes a plaintext pin, never trusts a client hash", async () => {
    const h = await hashPin("1111");
    const existing = [{ id: "e1", name: "Nong", pinHash: h }, { id: "e2", name: "Arthit", pin: "2222" }];
    const incoming = [
      { id: "e1", name: "Nong S.", pinHash: "pbkdf2-sha256$1$x$y" },   // client hash ignored
      { id: "e2", name: "Arthit" },                                   // legacy plaintext carried
      { id: "e3", name: "New", pin: "4444" },                          // plaintext from an old client / seed -> hashed
      { id: "e4", name: "NoPinYet" },
    ];
    const out = await protectEmployees(incoming, existing);
    expect(out[0]).toEqual({ id: "e1", name: "Nong S.", pinHash: h });
    expect(out[1]).toEqual({ id: "e2", name: "Arthit", pin: "2222" });
    expect(out[2].pin).toBeUndefined(); expect(isPinHash(out[2].pinHash)).toBe(true);
    expect(out[3]).toEqual({ id: "e4", name: "NoPinYet" });
    expect(await protectEmployees([], existing)).toEqual([]); // a delete is a delete
  });
});

describe("staff accounts (P2-6)", () => {
  it("add / login / rename / reset / remove, owner entry is a display name only", async () => {
    const kv = fakeKV();
    const a = await addStaff(kv, { name: "Bee", role: "counter", pin: "2468" });
    expect(a.entry.pinHash).toBeUndefined();
    expect(a.staff[0].role).toBe("counter");
    expect((await verifyStaffPin(kv, a.entry.id, "2468")).ok).toBe(true);
    expect((await verifyStaffPin(kv, a.entry.id, "0000")).ok).toBe(false);
    expect((await verifyStaffPin(kv, "owner", "2468")).ok).toBe(false); // owner has no staff hash
    const rn = await renameStaff(kv, "owner", "Somchai");
    expect(rn.staff.find(s => s.id === "owner")).toEqual({ id: "owner", name: "Somchai", role: "owner" });
    await setStaffPin(kv, a.entry.id, "1357");
    expect((await verifyStaffPin(kv, a.entry.id, "1357")).ok).toBe(true);
    await expect(removeStaff(kv, "owner")).rejects.toThrow();
    expect(await removeStaff(kv, "nope")).toBeNull();
    const rm = await removeStaff(kv, a.entry.id);
    expect(rm.staff.map(s => s.id)).toEqual(["owner"]);
    await expect(addStaff(kv, { name: "", role: "counter", pin: "1234" })).rejects.toThrow();
  });
});

describe("calendar token", () => {
  it("is created once, stable, and rotates", async () => {
    const kv = fakeKV();
    const t1 = await ensureCalendarToken(kv);
    expect(t1).toMatch(/^[0-9a-f]{48}$/);
    expect(await ensureCalendarToken(kv)).toBe(t1);
    const t2 = await rotateCalendarToken(kv);
    expect(t2).not.toBe(t1);
    expect(await ensureCalendarToken(kv)).toBe(t2);
  });
});

describe("KV rate limit", () => {
  it("5 failures block the key for the rest of the minute; clear resets", async () => {
    const kv = fakeKV();
    const key = rateKey("1.2.3.4", "admin", "owner");
    const t0 = 5_000_000;
    for (let i = 0; i < 4; i++) expect((await rateFail(kv, key, t0 + i)).blocked).toBe(false);
    expect((await rateFail(kv, key, t0 + 4)).blocked).toBe(true);
    const c = await rateCheck(kv, key, t0 + 10);
    expect(c.blocked).toBe(true); expect(c.retryAfter).toBe(60);
    expect((await rateCheck(kv, rateKey("1.2.3.4", "admin", "st1"), t0)).blocked).toBe(false); // per account
    expect((await rateCheck(kv, key, t0 + 61_000)).blocked).toBe(false);
    await rateClear(kv, key);
    expect((await rateCheck(kv, key, t0 + 10)).blocked).toBe(false);
  });
});

describe("protectRequests (admin PUT of adminRequests keeps the requested PIN hash)", () => {
  it("re-attaches requestedPinHash from KV by id and never trusts an incoming one", async () => {
    const h = await hashPin("5678");
    const kv = [
      { id: "ar1", type: "member-register", status: "pending", name: "Beam", requestedPinHash: h },
      { id: "ar2", type: "member-register", status: "pending", name: "Old", requestedPin: "4321" },
      { id: "ar3", type: "equipment", status: "pending", name: "Cable" },
    ];
    // the client loaded the stripped copies (GET) and saves them back, plus a tampered hash
    const incoming = [
      { id: "ar1", type: "member-register", status: "pending", name: "Beam", requestedPinHash: "v1$bogus" },
      { id: "ar2", type: "member-register", status: "pending", name: "Old" },
      { id: "ar3", type: "equipment", status: "approved", name: "Cable", requestedPinHash: "v1$injected" },
      { id: "ar9", type: "member-register", status: "pending", name: "New", requestedPinHash: "v1$client" },
    ];
    const out = protectRequests(incoming, kv);
    expect(out.find(r => r.id === "ar1").requestedPinHash).toBe(h);
    expect(out.find(r => r.id === "ar2").requestedPin).toBe("4321");
    expect(out.find(r => r.id === "ar3")).toEqual({ id: "ar3", type: "equipment", status: "approved", name: "Cable" });
    expect(out.find(r => r.id === "ar9")).toEqual({ id: "ar9", type: "member-register", status: "pending", name: "New" });
  });
});

describe("protectEmployees keeps the LINE identity from KV (P3-6)", () => {
  it("an admin save of the stripped list carries lineUserId / link code forward and drops client values", async () => {
    const kv = [{ id: "e1", name: "Nong", pinHash: await hashPin("1111"), lineUserId: "U123", lineLinkedAt: 5 }, { id: "e2", name: "Arthit", lineLinkCode: "ABC234", lineLinkCodeAt: 9 }];
    const out = await protectEmployees([{ id: "e1", name: "Nong Renamed", lineLinked: true, lineUserId: "Uattacker" }, { id: "e2", name: "Arthit" }], kv);
    expect(out[0]).toMatchObject({ id: "e1", name: "Nong Renamed", pinHash: kv[0].pinHash, lineUserId: "U123", lineLinkedAt: 5 });
    expect(out[0].lineLinked).toBeUndefined();
    expect(out[1]).toMatchObject({ id: "e2", name: "Arthit", lineLinkCode: "ABC234", lineLinkCodeAt: 9 });
  });
});
