import { describe, it, expect } from "vitest";
import {
  productionDay, jobCheckoutState, outstandingQty, latestOpenPick, laneDone,
  stillOutAcrossJobs, geoGate, voidEvent, itemCounts, isPickEvt, isReturnEvt,
} from "./checkoutState.js";

const TZ = "Asia/Bangkok";
const T = (iso) => Date.parse(iso); // "+07:00" strings below
const haversine = (lat1, lon1, lat2, lon2) => { const R = 6371000, p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180, dp = (lat2 - lat1) * Math.PI / 180, dl = (lon2 - lon1) * Math.PI / 180, a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2; return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); };

const job = (over = {}) => ({ id: "job1", name: "TVC", checkoutMode: "span", assignedEquipment: [{ eqId: "fx6", qty: 1 }, { eqId: "bat", qty: 4 }], ...over });
const ev = (type, eqId, qty, ts, extra = {}) => ({ id: type + ts + eqId, jobId: "job1", requestId: null, eqId, qty, type, ts, employeeId: "e1", employeeName: "Nong", ...extra });

describe("productionDay", () => {
  it("shifts the day boundary to 05:00 local", () => {
    expect(productionDay(T("2026-09-16T19:00:00+07:00"), TZ, 5)).toBe("2026-09-16");
    expect(productionDay(T("2026-09-17T01:30:00+07:00"), TZ, 5)).toBe("2026-09-16"); // after midnight, before cutoff = same shoot day
    expect(productionDay(T("2026-09-17T05:00:00+07:00"), TZ, 5)).toBe("2026-09-17");
    expect(productionDay(T("2026-09-17T04:59:00+07:00"), TZ, 5)).toBe("2026-09-16");
  });
  it("cutoff 0 = calendar day; garbage falls back to the default", () => {
    expect(productionDay(T("2026-09-17T00:30:00+07:00"), TZ, 0)).toBe("2026-09-17");
    expect(productionDay(T("2026-09-17T01:30:00+07:00"), TZ, "x")).toBe("2026-09-16");
  });
});

describe("count based state (P1-1)", () => {
  it("out = picked - returned per eqId, partial return leaves the remainder missing with an owner", () => {
    const co = [ev("pick", "bat", 4, 1000), ev("return", "bat", 3, 2000, { condition: "ok" })];
    const st = jobCheckoutState(job(), co, {});
    expect(st.items.bat).toMatchObject({ picked: 4, returned: 3, out: 1, missing: true });
    expect(st.items.bat.owner.employeeName).toBe("Nong");
    expect(outstandingQty(st, "bat")).toBe(1);
    expect(st.returnedIds.has("bat")).toBe(false);
    expect(st.allReturned).toBe(false);
  });
  it("a second return closes the item", () => {
    const co = [ev("pick", "bat", 4, 1000), ev("return", "bat", 3, 2000), ev("return", "bat", 1, 3000)];
    const st = jobCheckoutState(job({ assignedEquipment: [{ eqId: "bat", qty: 4 }] }), co, {});
    expect(st.items.bat.out).toBe(0);
    expect(st.items.bat.missing).toBe(false);
    expect(st.allReturned).toBe(true);
  });
  it("lost units leave still-out and never come back", () => {
    const co = [ev("pick", "bat", 4, 1000), ev("return", "bat", 3, 2000), ev("lost", "bat", 1, 3000, { by: "admin", condition: "lost" })];
    const st = jobCheckoutState(job({ assignedEquipment: [{ eqId: "bat", qty: 4 }] }), co, {});
    expect(st.items.bat).toMatchObject({ lost: 1, out: 0 });
    expect(st.allReturned).toBe(true);
    expect(stillOutAcrossJobs([job()], co, { todayStr: "2026-09-16" })).toEqual([]);
  });
  it("never goes negative on an over-return and ignores garbage qty", () => {
    const co = [ev("pick", "fx6", 1, 1), ev("return", "fx6", 5, 2), ev("pick", "bat", "abc", 3)];
    const st = jobCheckoutState(job(), co, {});
    expect(st.items.fx6.out).toBe(0);
    expect(st.items.bat.picked).toBe(0);
  });
  it("'both' mode: photo + barcode events for the same units do not double count", () => {
    const co = [ev("pick", "bat", 4, 1), ev("barcode_pick", "bat", 4, 2), ev("return", "bat", 4, 3), ev("barcode_return", "bat", 4, 4)];
    const st = jobCheckoutState(job(), co, {});
    expect(st.items.bat).toMatchObject({ picked: 4, returned: 4, out: 0 });
    expect(laneDone(st, "bat", "photo", true)).toBe(true);
    expect(laneDone(st, "bat", "barcode", true)).toBe(true);
  });
  it("legacy 'checkout' type counts as a pick", () => {
    expect(isPickEvt("checkout")).toBe(true);
    expect(isReturnEvt("lost")).toBe(false);
    const st = jobCheckoutState(job(), [ev("checkout", "fx6", 1, 1)], {});
    expect(st.pickedIds.has("fx6")).toBe(true);
  });
  it("request pseudo-jobs match on requestId", () => {
    const co = [{ ...ev("pick", "fx6", 1, 1), jobId: null, requestId: "req9" }];
    const st = jobCheckoutState({ id: "reqjob_req9", __reqId: "req9", assignedEquipment: [{ eqId: "fx6", qty: 1 }] }, co, {});
    expect(st.items.fx6.out).toBe(1);
    expect(jobCheckoutState(job(), co, {}).items.fx6).toBeUndefined();
  });
});

describe("daily mode across midnight (P1-2)", () => {
  const daily = job({ checkoutMode: "daily", assignedEquipment: [{ eqId: "fx6", qty: 1 }] });
  const pick19 = ev("pick", "fx6", 1, T("2026-09-16T19:00:00+07:00"));
  it("gear picked at 19:00 is still 'picked today' at 01:00 and returnable", () => {
    const now = T("2026-09-17T01:00:00+07:00");
    const st = jobCheckoutState(daily, [pick19], { tz: TZ, dayStartHour: 5, now });
    expect(st.pickedIds.has("fx6")).toBe(true);
    expect(st.allPicked).toBe(true);
    expect(st.items.fx6.pickedToday).toBe(1);
    expect(outstandingQty(st, "fx6")).toBe(1);
    expect(laneDone(st, "fx6", "photo", false)).toBe(true);
  });
  it("still out after the cutoff: never stranded, return pairs with the 19:00 pick", () => {
    const now = T("2026-09-17T09:00:00+07:00");
    const st = jobCheckoutState(daily, [pick19], { tz: TZ, dayStartHour: 5, now });
    expect(st.items.fx6.pickedToday).toBe(0);
    expect(st.items.fx6.out).toBe(1);
    expect(st.pickedIds.has("fx6")).toBe(true); // cannot pick it again while it is out
    expect(st.allPicked).toBe(true);            // -> the screen opens on Return
    expect(latestOpenPick(daily, [pick19], "fx6")).toBe(pick19);
  });
  it("after the return, the next production day starts fresh", () => {
    const ret = ev("return", "fx6", 1, T("2026-09-17T01:30:00+07:00"));
    const st = jobCheckoutState(daily, [pick19, ret], { tz: TZ, dayStartHour: 5, now: T("2026-09-17T09:00:00+07:00") });
    expect(st.pickedIds.has("fx6")).toBe(false);
    expect(st.returnedIds.has("fx6")).toBe(false); // not "all returned" for today, it is "ready to pick"
    expect(st.allPicked).toBe(false);
    expect(latestOpenPick(daily, [pick19, ret], "fx6")).toBeNull();
    // same production day (01:30 -> 02:00): the item is returned for today
    const st2 = jobCheckoutState(daily, [pick19, ret], { tz: TZ, dayStartHour: 5, now: T("2026-09-17T02:00:00+07:00") });
    expect(st2.returnedIds.has("fx6")).toBe(true);
    expect(st2.allReturned).toBe(true);
  });
  it("span mode ignores the clock entirely", () => {
    const st = jobCheckoutState(job({ assignedEquipment: [{ eqId: "fx6", qty: 1 }] }), [pick19], { tz: TZ, now: T("2026-09-20T09:00:00+07:00") });
    expect(st.allPicked).toBe(true);
    expect(st.items.fx6.out).toBe(1);
  });
});

describe("stillOutAcrossJobs", () => {
  it("lists overdue first, carries owner + missing", () => {
    const j1 = job({ id: "job1", returnDate: "2026-09-10", dates: ["2026-09-09"] });
    const j2 = { ...job({ id: "job2", dates: ["2026-09-16"] }) };
    const co = [ev("pick", "fx6", 1, 100), { ...ev("pick", "bat", 4, 200), jobId: "job2" }, { ...ev("return", "bat", 2, 300), jobId: "job2" }];
    const eff = (j) => j.returnDate || (j.dates || [])[0];
    const rows = stillOutAcrossJobs([j2, j1], co, { todayStr: "2026-09-16", effReturnDate: eff });
    expect(rows.map(r => r.job.id)).toEqual(["job1", "job2"]);
    expect(rows[0].overdue).toBe(true);
    expect(rows[1]).toMatchObject({ out: 2, missing: true, overdue: false });
    expect(rows[1].owner.employeeName).toBe("Nong");
  });
});

describe("undo tombstone (P1-4)", () => {
  it("a void event is ignored by every count and keeps its id for the server merge", () => {
    const pick = ev("pick", "fx6", 1, 1);
    const v = voidEvent(pick, "e1");
    expect(v.id).toBe(pick.id);
    expect(v.type).toBe("void");
    expect(v.qty).toBe(0);
    expect(v.voidedType).toBe("pick");
    const st = jobCheckoutState(job(), [v], {});
    expect(st.items.fx6).toBeUndefined();
    expect(st.pickedIds.size).toBe(0);
    expect(itemCounts([v])).toEqual({});
  });
});

describe("geoGate (P1-5)", () => {
  const shop = { lat: 13.7563, lng: 100.5018, acc: 10 };
  const near = { lat: 13.7566, lng: 100.5018, acc: 15 }; // ~33 m north
  const far = { lat: 13.9000, lng: 100.5018, acc: 5 };  // ~16 km
  it("within threshold", () => {
    const g = geoGate({ returnLoc: near, pickupLoc: shop, thresholdM: 50, haversine });
    expect(g.ok).toBe(true);
    expect(g.distance).toBeGreaterThan(25);
    expect(g.distance).toBeLessThan(40);
    expect(g.reason).toBe("ok");
  });
  it("tolerance grows with the reported accuracy of both fixes", () => {
    const at60 = { lat: 13.75684, lng: 100.5018, acc: 15 }; // ~60 m
    expect(geoGate({ returnLoc: { ...at60, acc: 0 }, pickupLoc: { ...shop, acc: 0 }, thresholdM: 50, haversine }).ok).toBe(false);
    const g = geoGate({ returnLoc: at60, pickupLoc: shop, thresholdM: 50, haversine }); // 50 + 15 + 10 = 75 >= 60
    expect(g.ok).toBe(true);
    expect(g.tolerance).toBe(75);
  });
  it("too far reports the distance and rule", () => {
    const g = geoGate({ returnLoc: far, pickupLoc: shop, thresholdM: 50, haversine });
    expect(g).toMatchObject({ ok: false, reason: "too-far", threshold: 50 });
    expect(g.distance).toBeGreaterThan(15000);
  });
  it("home base is a second accepted anchor (retry at shop after a remote pickup)", () => {
    const remotePickup = { lat: 14.5, lng: 101.0, acc: 8 };
    const g = geoGate({ returnLoc: near, pickupLoc: remotePickup, homeBase: shop, thresholdM: 50, haversine });
    expect(g.ok).toBe(true);
    expect(g.homeDistance).toBeLessThan(40);
  });
  it("missing GPS gives a reason instead of a silent bounce, default threshold 50", () => {
    expect(geoGate({ returnLoc: null, pickupLoc: shop, haversine }).reason).toBe("no-return-gps");
    const g = geoGate({ returnLoc: near, pickupLoc: null, haversine });
    expect(g.reason).toBe("no-pickup-gps");
    expect(g.threshold).toBe(50);
  });
});
