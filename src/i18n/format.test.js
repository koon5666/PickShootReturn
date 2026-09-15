import { describe, it, expect, afterEach } from "vitest";
import { formatDate, formatDateTime, formatDay, setFormatLang, tCount, shootTimeLabel, locationLabel, statusLabel, localeOf } from "./format.js";

afterEach(() => setFormatLang("en"));

describe("formatDate", () => {
  it("english by default", () => {
    expect(formatDate("2026-09-16")).toMatch(/16 Sep\w* 2026/);
    expect(formatDay("2026-09-16")).toMatch(/^16 Sep\w*$/);
  });
  it("thai when the app language is th (Buddhist year, Thai month)", () => {
    setFormatLang("th");
    const s = formatDate("2026-09-16");
    expect(s).toContain("ก.ย.");
    expect(s).toContain("2569");
    expect(localeOf()).toBe("th-TH");
  });
  it("explicit lang overrides the global", () => {
    setFormatLang("th");
    expect(formatDate("2026-09-16", { lang: "en" })).toMatch(/Sep/);
  });
  it("garbage passes through, empty is empty", () => {
    expect(formatDate("")).toBe("");
    expect(formatDate("nope")).toBe("nope");
  });
  it("formatDateTime keeps 24h and follows the locale", () => {
    const ts = new Date("2026-09-16T14:05:00").getTime();
    expect(formatDateTime(ts)).toMatch(/16 Sep\w*,? 14:05/);
    setFormatLang("th");
    expect(formatDateTime(ts)).toContain("14:05");
    expect(formatDateTime(ts)).toContain("ก.ย.");
  });
});

describe("tCount", () => {
  const dict = { en: { itemsN: "{n} items", itemsNOne: "{n} item", plainN: "{n} things" } };
  const t = (k) => dict.en[k] ?? k;
  it("picks the One form for exactly 1", () => {
    expect(tCount(t, "itemsN", 1)).toBe("1 item");
    expect(tCount(t, "itemsN", 0)).toBe("0 items");
    expect(tCount(t, "itemsN", "3")).toBe("3 items");
  });
  it("falls back to the many form when there is no One key", () => {
    expect(tCount(t, "plainN", 1)).toBe("1 things");
  });
});

describe("enum labels", () => {
  const t = (k) => ({ shootTimeDay: "กลางวัน", locLocal: "กรุงเทพ", stPending: "รออนุมัติ" })[k] ?? k;
  it("maps stored values and passes unknown ones through", () => {
    expect(shootTimeLabel(t, "Day")).toBe("กลางวัน");
    expect(shootTimeLabel(t, "Dawn")).toBe("Dawn");
    expect(locationLabel(t, "Local (Bangkok)")).toBe("กรุงเทพ");
    expect(statusLabel(t, "pending")).toBe("รออนุมัติ");
    expect(statusLabel(t, "PENDING")).toBe("รออนุมัติ");
    expect(statusLabel(t, "custom")).toBe("custom");
    expect(statusLabel(t, null)).toBe("");
  });
});
