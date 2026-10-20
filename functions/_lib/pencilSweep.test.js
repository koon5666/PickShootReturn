import { describe, it, expect, vi, afterEach } from "vitest";
import { fakeKV } from "../../tests/fakekv.js";
import { sweepExpiredPencils, SWEEP_KEY } from "./pencilSweep.js";
import { readField, writeField } from "./store.js";
import { onRequestGet as calendarGet } from "../api/calendar.js";

// 2026-10-20 08:00 Bangkok = 01:00 UTC
const NOW = Date.parse("2026-10-20T01:00:00Z");
const TOKEN = "t".repeat(40);
const jobs = [
  { id: "old", name: "Old pencil", status: "Pencil", dates: ["2026-10-18", "2026-10-19"] },
  { id: "today", name: "Pencil today", status: "Pencil", dates: ["2026-10-20"] },
  { id: "gear", name: "Pencil with gear out", status: "Pencil", dates: ["2026-10-10"] },
  { id: "conf", name: "Confirmed shoot", status: "Confirmed", dates: ["2026-10-19"] },
  { id: "dec", name: "Declined by hand", status: "Declined", dates: ["2026-10-25"] },
];
const checkouts = [{ id: "c1", jobId: "gear", eqId: "eq1", qty: 1, type: "pick", ts: 1 }];

async function seeded() {
  const kv = fakeKV({ timezone: JSON.stringify("Asia/Bangkok"), calendarToken: JSON.stringify(TOKEN) });
  await writeField(kv, "jobs", jobs);
  await writeField(kv, "checkouts", checkouts);
  return kv;
}

describe("pencil sweep (2026-10-20)", () => {
  it("stores Declined on the expired pencil only, with a new jobs version and an audit line", async () => {
    const kv = await seeded();
    const before = (await readField(kv, "jobs")).v;
    const r = await sweepExpiredPencils(kv, { now: NOW });
    expect(r).toMatchObject({ ran: true, today: "2026-10-20", declined: [{ id: "old", name: "Old pencil" }] });
    const { value, v } = await readField(kv, "jobs");
    expect(v).not.toBe(before); // open tabs get a 409 and rebase instead of overwriting
    const by = Object.fromEntries(value.map(j => [j.id, j]));
    expect(by.old.status).toBe("Declined");
    expect(by.old.autoDeclined).toMatchObject({ from: "Pencil", reason: "pencil-expired" });
    expect(by.today.status).toBe("Pencil");
    expect(by.gear.status).toBe("Pencil");
    expect(by.conf.status).toBe("Confirmed");
    const log = (await readField(kv, "auditLog")).value;
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ action: "job.autoDecline", recordId: "old", by: "system" });
  });
  it("runs once a day: the second call is one KV read, no write", async () => {
    const kv = await seeded();
    await sweepExpiredPencils(kv, { now: NOW });
    const writes = kv.writes;
    const r = await sweepExpiredPencils(kv, { now: NOW + 3600e3 });
    expect(r.ran).toBe(false);
    expect(kv.writes).toBe(writes);
    expect(kv.json(SWEEP_KEY)).toMatchObject({ day: "2026-10-20", declined: 1 });
  });
  it("writes no jobs when nothing expired", async () => {
    const kv = fakeKV({ timezone: JSON.stringify("Asia/Bangkok") });
    await writeField(kv, "jobs", [jobs[1]]);
    const v = (await readField(kv, "jobs")).v;
    const r = await sweepExpiredPencils(kv, { now: NOW });
    expect(r.declined).toEqual([]);
    expect((await readField(kv, "jobs")).v).toBe(v);
    expect((await readField(kv, "auditLog")).value).toBeNull();
  });
  it("uses the house timezone for 'today' (00:30 Bangkok is still the 19th in UTC)", async () => {
    const kv = fakeKV({ timezone: JSON.stringify("Asia/Bangkok") });
    await writeField(kv, "jobs", [{ id: "a", name: "A", status: "Pencil", dates: ["2026-10-19"] }]);
    const r = await sweepExpiredPencils(kv, { now: Date.parse("2026-10-19T17:30:00Z") });
    expect(r.today).toBe("2026-10-20");
    expect(r.declined).toHaveLength(1);
  });
  it("reads a non-Bangkok house timezone", async () => {
    const kv = fakeKV({ timezone: JSON.stringify("America/Los_Angeles") });
    await writeField(kv, "jobs", [{ id: "a", name: "A", status: "Pencil", dates: ["2026-10-19"] }]);
    const r = await sweepExpiredPencils(kv, { now: NOW }); // 18:00 on the 19th in LA
    expect(r.today).toBe("2026-10-19");
    expect(r.declined).toEqual([]);
  });
  it("copes with no jobs at all", async () => {
    const r = await sweepExpiredPencils(fakeKV({}), { now: NOW });
    expect(r).toMatchObject({ ran: true, declined: [] });
  });
});

describe("calendar feed (2026-10-20)", () => {
  afterEach(() => vi.useRealTimers());
  async function feed(kv) {
    const res = await calendarGet({ env: { KV: kv }, request: new Request(`https://x/api/calendar?token=${TOKEN}`) });
    return res.text();
  }
  it("never sends a Declined job (it used to go out as STATUS:CONFIRMED) and drops expired pencils before the sweep", async () => {
    vi.useFakeTimers({ now: NOW });
    const kv = await seeded();
    const ics = await feed(kv);
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).not.toContain("Declined by hand");
    expect(ics).not.toContain("SUMMARY:Old pencil");
    expect(ics).toContain("SUMMARY:Confirmed shoot");
    // a pencil still to come, or one whose gear is out, stays tentative
    expect(ics).toMatch(/SUMMARY:Pencil today\r\nSTATUS:TENTATIVE/);
    expect(ics).toMatch(/SUMMARY:Pencil with gear out\r\nSTATUS:TENTATIVE/);
  });
});
