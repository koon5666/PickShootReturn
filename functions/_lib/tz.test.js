import { describe, it, expect } from "vitest";
import { calendarTimezone, DEFAULT_TZ } from "./tz.js";

describe("calendarTimezone", () => {
  it("accepts IANA ids and falls back to Bangkok for anything else", () => {
    expect(calendarTimezone("Asia/Tokyo")).toBe("Asia/Tokyo");
    expect(calendarTimezone(" America/Los_Angeles ")).toBe("America/Los_Angeles");
    expect(calendarTimezone("UTC")).toBe("UTC");
    expect(calendarTimezone("America/Argentina/Buenos_Aires")).toBe("America/Argentina/Buenos_Aires");
    expect(calendarTimezone(null)).toBe(DEFAULT_TZ);
    expect(calendarTimezone("")).toBe(DEFAULT_TZ);
    expect(calendarTimezone("Asia/Bangkok\r\nX-INJECT:1")).toBe(DEFAULT_TZ);
    expect(calendarTimezone({ tz: "x" })).toBe(DEFAULT_TZ);
  });
});
