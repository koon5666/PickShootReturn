import { describe, it, expect } from "vitest";
import { normalizeCrew, cleanTime, hasRoster, isOnRoster, jobVisibility, splitJobsForEmployee, defaultCheckoutRoles, crewNames, jobChangeSet, shouldNotify, pushRecipients, buildJobMessage, pushEmployeeIds, compressDays, jobSummaryLines, fitRecapBlocks } from "./roster.js";

const emps = [{ id: "e1", name: "Nong", lineUserId: "U1" }, { id: "e2", name: "Arthit" }, { id: "e3", name: "Ploy", lineUserId: "U3" }];
const job = (extra = {}) => ({ id: "j1", name: "TVC", production: "Indie", dates: ["2026-09-20", "2026-09-21"], status: "Confirmed", location: "Local (Bangkok)", ...extra });

describe("normalizeCrew", () => {
  it("drops blanks, duplicates and bad times", () => {
    expect(normalizeCrew([{ employeeId: "e1", role: " 1st AC ", callTime: "07:30", pickupTime: "25:99" }, { employeeId: "e1" }, { employeeId: "" }, null]))
      .toEqual([{ employeeId: "e1", role: "1st AC", callTime: "07:30", pickupTime: "" }]);
    expect(normalizeCrew(undefined)).toEqual([]);
  });
  it("cleanTime accepts only HH:MM", () => {
    expect(cleanTime("07:05")).toBe("07:05");
    expect(cleanTime("7:05")).toBe("");
    expect(cleanTime("23:59")).toBe("23:59");
    expect(cleanTime("24:00")).toBe("");
  });
});

describe("visibility", () => {
  it("open job (no roster) is visible to everyone; staffed job only to its crew", () => {
    const open = job();
    const staffed = job({ crew: [{ employeeId: "e1", role: "1st AC" }] });
    expect(hasRoster(open)).toBe(false);
    expect(jobVisibility(open, "e2")).toBe("open");
    expect(jobVisibility(staffed, "e1")).toBe("mine");
    expect(jobVisibility(staffed, "e2")).toBe("other");
    expect(isOnRoster(staffed, "e1")).toBe(true);
    expect(isOnRoster(staffed, undefined)).toBe(false);
  });
  it("splitJobsForEmployee keeps open jobs in mine by default", () => {
    const jobs = [job({ id: "a" }), job({ id: "b", crew: [{ employeeId: "e1" }] }), job({ id: "c", crew: [{ employeeId: "e2" }] })];
    const s = splitJobsForEmployee(jobs, "e1");
    expect(s.mine.map(j => j.id)).toEqual(["a", "b"]);
    expect(s.others.map(j => j.id)).toEqual(["c"]);
    const strict = splitJobsForEmployee(jobs, "e1", { includeOpen: false });
    expect(strict.mine.map(j => j.id)).toEqual(["b"]);
    expect(strict.others.map(j => j.id)).toEqual(["a", "c"]);
  });
});

describe("defaultCheckoutRoles / crewNames", () => {
  it("roster -> both lanes fixed to the roster; no roster -> anyone", () => {
    expect(defaultCheckoutRoles(job())).toEqual({ barcode: "anyone", photo: "anyone" });
    expect(defaultCheckoutRoles(job({ crew: [{ employeeId: "e1" }, { employeeId: "e2" }] }))).toEqual({ barcode: ["e1", "e2"], photo: ["e1", "e2"] });
  });
  it("names carry the role and fall back to the id", () => {
    expect(crewNames(job({ crew: [{ employeeId: "e1", role: "1st AC" }, { employeeId: "zz" }] }), emps)).toEqual(["Nong (1st AC)", "zz"]);
  });
});

describe("jobChangeSet / shouldNotify", () => {
  it("new job -> [new]; contact tweak -> nothing; dates/status/location/roster detected", () => {
    expect(jobChangeSet(null, job())).toEqual(["new"]);
    const a = job({ contactPerson: "A" });
    expect(jobChangeSet(a, { ...a, contactPerson: "B" })).toEqual([]);
    expect(shouldNotify([])).toBe(false);
    expect(jobChangeSet(a, { ...a, status: "Cancelled" })).toEqual(["status"]);
    expect(jobChangeSet(a, { ...a, dates: ["2026-09-21", "2026-09-20"] })).toEqual([]); // same set, different order
    expect(jobChangeSet(a, { ...a, dates: ["2026-09-20"] })).toEqual(["dates"]);
    expect(jobChangeSet(a, { ...a, pickupDate: "2026-09-19" })).toEqual(["dates"]);
    expect(jobChangeSet(a, { ...a, locationCity: "Chiang Mai" })).toEqual(["location"]);
    expect(jobChangeSet(a, { ...a, crew: [{ employeeId: "e1" }] })).toEqual(["roster"]);
    expect(jobChangeSet({ ...a, crew: [{ employeeId: "e1", role: "" }] }, { ...a, crew: [{ employeeId: "e1" }] })).toEqual([]);
  });
});

describe("pushRecipients", () => {
  it("group wins; else assigned crew's LINE ids; open job -> everyone with a LINE id", () => {
    expect(pushRecipients(job(), emps, "G1")).toEqual(["G1"]);
    expect(pushRecipients(job(), emps, null)).toEqual(["U1", "U3"]);
    expect(pushRecipients(job({ crew: [{ employeeId: "e3" }, { employeeId: "e2" }] }), emps, null)).toEqual(["U3"]);
    expect(pushRecipients(job({ crew: [{ employeeId: "e2" }] }), emps, null)).toEqual([]);
  });
});

describe("buildJobMessage", () => {
  it("picks the headline from the change set and carries the contact line", () => {
    // The crew roster and call times left this message on 2026-09-23 (Koon): the
    // header is headline / production / dates / contact / location, then the recap.
    const j = job({ crew: [{ employeeId: "e1", role: "1st AC", callTime: "07:00", pickupTime: "06:00" }, { employeeId: "e2", role: "Gaffer" }], contactPerson: "P'Poo", contactPlatform: "WhatsApp" });
    const msg = buildJobMessage(j, { changes: ["new"], employees: emps, formatDates: d => d.join("/") });
    expect(msg).toContain("[New Job] TVC");
    expect(msg).toContain("📅 2026-09-20/2026-09-21");
    expect(msg).toContain("👤 P'Poo Via WhatsApp");
    expect(msg).not.toContain("👥");
    expect(msg).not.toContain("⏰");
    expect(msg).not.toContain("—");
    expect(buildJobMessage(j, { changes: ["status"] })).toContain("[Status → Confirmed]");
    expect(buildJobMessage(j, { changes: ["roster"] })).toContain("[Crew updated]");
    expect(buildJobMessage(j, { changes: ["dates", "roster"] })).toContain("[Updated]");
    // no contact on the job: no empty line where it would have been
    expect(buildJobMessage(job(), { changes: ["new"] })).not.toContain("👤");
  });
});

describe("pushEmployeeIds (per-user LINE without lineUserId on the client, P3-6)", () => {
  const emps = [{ id: "e1", name: "Nong", lineLinked: true }, { id: "e2", name: "Arthit" }];
  it("open job: everyone; rostered job: the roster only", () => {
    expect(pushEmployeeIds({ crew: [] }, emps)).toEqual(["e1", "e2"]);
    expect(pushEmployeeIds({ crew: [{ employeeId: "e2", role: "Grip" }] }, emps)).toEqual(["e2"]);
  });
});

// ─── Job summary recap in the LINE push (2026-09-23) ─────────────────────────
describe("compressDays", () => {
  it("collapses a run of 3+ and leaves a pair as a pair", () => {
    expect(compressDays([1, 2, 3, 4, 5])).toBe("1-5");
    expect(compressDays([15, 16])).toBe("15,16");          // a pair reads better than 15-16
    expect(compressDays([8, 9, 10, 11, 12, 13, 15, 16])).toBe("8-13,15,16");
    expect(compressDays([20])).toBe("20");
    expect(compressDays([])).toBe("");
  });
  it("sorts, dedupes and ignores rubbish", () => {
    expect(compressDays([5, 1, 3, 2, 5, 4])).toBe("1-5");
    expect(compressDays([3, null, undefined, NaN, 4, 5])).toBe("3-5");
  });
});

describe("jobSummaryLines", () => {
  const J = (id, name, production, status, dates, contactPerson, contactPlatform) =>
    ({ id, name, production, status, dates, contactPerson, contactPlatform });
  const jobs = [
    J("j1", "TBA", "Taprod", "Pencil", ["2026-06-01","2026-06-02","2026-06-03","2026-06-04","2026-06-05"], "P'ple", "Line"),
    J("j2", "KFC", "Film Fact", "Pencil", ["2026-06-15","2026-06-16"], "P'Poo", "WhatsApp"),
    J("j3", "Pepsi", "Film Fact", "Confirmed", ["2026-06-17","2026-06-18"], "P'Poo", "WhatsApp"),
    J("j4", "TBA", "Living Films", "Pencil", ["2026-07-08","2026-07-09","2026-07-10"], "P'mon", "Line"),
  ];
  const today = "2026-06-01"; // inside j1, so every fixture job is still live

  it("groups by month and renders Koon's line format", () => {
    expect(jobSummaryLines(jobs, { today })).toEqual([
      "June",
      "1-5 Taprod, TBA ✏️",
      "15,16 Film Fact, KFC ✏️",
      "17,18 Film Fact, Pepsi ✅",
      "",
      "July",
      "8-10 Living Films, TBA ✏️",
    ]);
  });
  it("stars exactly the job that triggered the message, and nothing else", () => {
    const out = jobSummaryLines(jobs, { today, starId: "j2" });
    expect(out.filter(l => l.startsWith("*"))).toEqual(["*15,16 Film Fact, KFC ✏️"]);
    // no star id -> the very same recap, no marker anywhere (this is what makes it
    // vanish from the NEXT message without anything being cleared)
    expect(jobSummaryLines(jobs, { today }).some(l => l.startsWith("*"))).toBe(false);
  });
  it("keeps a job whole while any day is still ahead, drops it once all have passed", () => {
    // today sits inside j1 (June 1-5): the whole run still prints
    expect(jobSummaryLines(jobs, { today: "2026-06-03" })[1]).toBe("1-5 Taprod, TBA ✏️");
    // past its last day it is gone, the rest stays
    const later = jobSummaryLines(jobs, { today: "2026-06-06" });
    expect(later.some(l => l.includes("Taprod"))).toBe(false);
    expect(later.some(l => l.includes("Film Fact, KFC"))).toBe(true);
  });
  it("lists only Pencil and Confirmed, so a decline reads as the job vanishing", () => {
    const declined = jobs.map(j => j.id === "j3" ? { ...j, status: "Declined" } : j);
    expect(jobSummaryLines(declined, { today }).some(l => l.includes("Pepsi"))).toBe(false);
    const cancelled = jobs.map(j => j.id === "j3" ? { ...j, status: "Cancelled" } : j);
    expect(jobSummaryLines(cancelled, { today }).some(l => l.includes("Pepsi"))).toBe(false);
  });
  it("a job spanning the month boundary shows under each month ahead, not behind", () => {
    const span = [J("s", "Nike", "Living", "Confirmed", ["2026-06-29","2026-06-30","2026-07-01","2026-07-02"], "P'mon", "Line")];
    expect(jobSummaryLines(span, { today: "2026-06-28" })).toEqual([
      "June", "29,30 Living, Nike ✅", "", "July", "1,2 Living, Nike ✅",
    ]);
    // once July has started the June half is not a recap any more
    expect(jobSummaryLines(span, { today: "2026-07-01" })).toEqual([
      "July", "1,2 Living, Nike ✅",
    ]);
  });
  it("survives missing fields without printing holes", () => {
    const bare = [{ id: "b", status: "Pencil", dates: ["2026-06-20"] }];
    expect(jobSummaryLines(bare, { today })).toEqual(["June", "20 TBA, TBA ✏️"]);
    expect(jobSummaryLines([{ id: "n", status: "Pencil", dates: [] }], { today })).toEqual([]);
    expect(jobSummaryLines(null, { today })).toEqual([]);
  });
});

describe("buildJobMessage with the recap", () => {
  const jobs = [
    { id: "j1", name: "PEPSI", production: "Film Fact", status: "Pencil", dates: ["2026-06-15","2026-06-16"], contactPerson: "P'Poo", contactPlatform: "WhatsApp", location: "Local (Bangkok)" },
    { id: "j2", name: "KFC", production: "Taprod", status: "Confirmed", dates: ["2026-06-20"], contactPerson: "P'ple", contactPlatform: "Line", location: "Local (Bangkok)" },
  ];
  it("matches the shape Koon asked for", () => {
    const msg = buildJobMessage(jobs[0], { changes: ["new"], jobs, today: "2026-06-10", appUrl: "https://x" });
    expect(msg).toBe([
      "✏️ [New Job] PEPSI",
      "🎬 Film Fact",
      "📅 2026-06-15, 2026-06-16",
      "👤 P'Poo Via WhatsApp",
      "📍 Local (Bangkok)",
      "",
      "Job summary",
      "June",
      "*15,16 Film Fact, PEPSI ✏️",
      "20 Taprod, KFC ✅",
      "",
      "🔗 https://x",
    ].join("\n"));
  });
  it("drops the crew roster and call times from this message", () => {
    const withCrew = { ...jobs[0], crew: [{ employeeId: "e1", role: "1st AC", callTime: "07:00", pickupTime: "06:00" }] };
    const msg = buildJobMessage(withCrew, { changes: ["new"], employees: [{ id: "e1", name: "Nong" }], jobs, today: "2026-06-10" });
    expect(msg).not.toMatch(/👥|⏰|Nong/);
  });
  it("without jobs + today it is the header alone, so old callers still work", () => {
    const msg = buildJobMessage(jobs[0], { changes: ["new"], appUrl: "https://x" });
    expect(msg).not.toMatch(/Job summary/);
    expect(msg.endsWith("🔗 https://x")).toBe(true);
  });
});

describe("recap character budget (safety net, never fires on a real book)", () => {
  const ymd = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const book = (n) => Array.from({ length: n }, (_, i) => ({
    id: "j" + i, name: "Client " + i, production: "Production House " + i, status: i % 2 ? "Pencil" : "Confirmed",
    contactPerson: "P'Contact" + i, contactPlatform: "WhatsApp", location: "Local (Bangkok)",
    dates: [ymd(2026, 9 + (i % 4), 1 + (i % 27))],
  }));
  const LINE_LIMIT = 5000;

  it("a realistic forward book is nowhere near the limit and is never trimmed", () => {
    const jobs = book(20);
    const msg = buildJobMessage(jobs[0], { changes: ["new"], jobs, today: "2026-09-24" });
    expect(msg.length).toBeLessThan(1600);
    expect(msg).not.toMatch(/\+\d+ more in/);
  });
  it("an absurd book still produces a message LINE will accept", () => {
    for (const n of [200, 500, 2000]) {
      const jobs = book(n);
      const msg = buildJobMessage(jobs[0], { changes: ["new"], jobs, today: "2026-09-24" });
      expect(msg.length).toBeLessThanOrEqual(LINE_LIMIT);
      expect(msg).toMatch(/\+\d+ more in \w+/);       // says what it left out
      expect(msg).toMatch(/^✏️ \[New Job\]|^✅ \[New Job\]/); // header survives
      expect(msg.trimEnd().endsWith("🔗 https://pickshootreturn.pages.dev")).toBe(true);
    }
  });
  it("trims the FURTHEST months first, so the near ones always survive", () => {
    const jobs = book(500);
    const msg = buildJobMessage(jobs[0], { changes: ["new"], jobs, today: "2026-09-24" });
    expect(msg).toContain("September");                        // nearest month kept
    expect(msg).toMatch(/\+\d+ more in October to December/);   // furthest months are the ones dropped
    expect(msg).not.toMatch(/^December$/m);
  });
  it("the starred job survives trimming: it is in the nearest month, which is kept", () => {
    const jobs = book(500);
    // a trigger that is actually ahead of today, so it belongs in a forward recap
    const trigger = { ...jobs[0], id: "trigger", name: "TRIGGER", dates: ["2026-09-25"] };
    const msg = buildJobMessage(trigger, { changes: ["new"], jobs: [...jobs, trigger], today: "2026-09-24" });
    const starred = msg.split("\n").filter(l => l.startsWith("*"));
    expect(starred).toHaveLength(1);
    expect(starred[0]).toContain("TRIGGER");
    expect(msg.length).toBeLessThanOrEqual(5000);
  });
  it("a job edited whose days have all passed is announced but is not in the forward recap", () => {
    const jobs = book(20);
    const past = { ...jobs[0], id: "past", name: "WRAPPED", dates: ["2026-09-01"] };
    const msg = buildJobMessage(past, { changes: ["status"], jobs: [...jobs, past], today: "2026-09-24" });
    expect(msg).toMatch(/\[Status → /);                 // the header still announces it
    expect(msg).toContain("WRAPPED");                   // by name, in the header
    expect(msg.split("\n").filter(l => l.startsWith("*"))).toHaveLength(0); // nothing starred in a forward list
  });
  it("fitRecapBlocks leaves a small recap completely alone", () => {
    const blocks = [{ month: "September", lines: ["1,2 A, B, C Via Line ✏️"] }];
    expect(fitRecapBlocks(blocks, 4200)).toEqual(["September", "1,2 A, B, C Via Line ✏️"]);
  });
  it("one oversized month sheds its own rows rather than vanishing", () => {
    const blocks = [{ month: "September", lines: Array.from({ length: 200 }, (_, i) => `${i + 1} Row ${i} padding padding padding`) }];
    const out = fitRecapBlocks(blocks, 600);
    expect(out.join("\n").length).toBeLessThanOrEqual(600);
    expect(out[0]).toBe("September");
    expect(out[out.length - 1]).toMatch(/^\+\d+ more in September$/);
  });
});

describe("overseas plane + no contact detail in the recap (2026-09-24)", () => {
  const base = { id: "j1", name: "Nivea", production: "Factory01", status: "Confirmed", contactPerson: "P'Bee", contactPlatform: "Line" };
  const today = "2026-06-01";
  it("the recap never carries the contact person or channel", () => {
    const out = jobSummaryLines([{ ...base, location: "Local (Bangkok)", dates: ["2026-06-10"] }], { today });
    expect(out).toEqual(["June", "10 Factory01, Nivea ✅"]);
    expect(out.join("\n")).not.toMatch(/P'Bee|Via /);
  });
  it("Overseas flies the plane, Local and Out of Town do not", () => {
    const at = (location) => jobSummaryLines([{ ...base, location, dates: ["2026-06-10"] }], { today })[1];
    expect(at("Overseas")).toBe("10 Factory01, Nivea ✈️ ✅");   // no country recorded yet
    expect(at("Local (Bangkok)")).toBe("10 Factory01, Nivea ✅");
    expect(at("Out of Town")).toBe("10 Factory01, Nivea ✅");
    expect(at(undefined)).toBe("10 Factory01, Nivea ✅");
  });
  it("an Overseas job names the country", () => {
    const job = { ...base, location: "Overseas", locationCity: "Tokyo", dates: ["2026-06-10", "2026-06-11"] };
    expect(jobSummaryLines([job], { today })[1]).toBe("10,11 Factory01, Nivea ✈️ Tokyo ✅");
  });
  it("the country is only shown where the job actually flies", () => {
    // Out of Town carries a province in the same field; it must not leak onto the line
    const job = { ...base, location: "Out of Town", locationCity: "Chiang Mai", dates: ["2026-06-10"] };
    expect(jobSummaryLines([job], { today })[1]).toBe("10 Factory01, Nivea ✅");
  });
  it("a per-date override names its own country, and two stops name both", () => {
    const job = { ...base, location: "Overseas", locationCity: "Tokyo",
      dates: ["2026-06-10", "2026-06-11", "2026-06-12"],
      dateOverrides: { "2026-06-12": { location: "Overseas", locationCity: "Seoul" } } };
    expect(jobSummaryLines([job], { today })[1]).toBe("10-12 Factory01, Nivea ✈️ Tokyo/Seoul ✅");
  });
  it("the country follows the month, like the plane does", () => {
    const job = { ...base, location: "Local (Bangkok)", dates: ["2026-06-10", "2026-07-05"],
      dateOverrides: { "2026-07-05": { location: "Overseas", locationCity: "Hanoi" } } };
    expect(jobSummaryLines([job], { today })).toEqual([
      "June", "10 Factory01, Nivea ✅",
      "", "July", "5 Factory01, Nivea ✈️ Hanoi ✅",
    ]);
  });
  it("a per-date override decides the day, so the plane follows the trip month by month", () => {
    const job = { ...base, location: "Local (Bangkok)", dates: ["2026-06-10", "2026-07-05", "2026-07-06"],
      dateOverrides: { "2026-07-05": { location: "Overseas" } } };
    expect(jobSummaryLines([job], { today })).toEqual([
      "June", "10 Factory01, Nivea ✅",          // local month, no plane
      "", "July", "5,6 Factory01, Nivea ✈️ ✅",   // the month with the overseas day
    ]);
  });
  it("an Overseas job whose days are all overridden back to local does not fly", () => {
    const job = { ...base, location: "Overseas", dates: ["2026-06-10", "2026-06-11"],
      dateOverrides: { "2026-06-10": { location: "Out of Town" }, "2026-06-11": { location: "Local (Bangkok)" } } };
    expect(jobSummaryLines([job], { today })[1]).toBe("10,11 Factory01, Nivea ✅");
  });
  it("the contact still rides in the HEADER of the job that changed", () => {
    const job = { ...base, location: "Overseas", dates: ["2026-06-10"] };
    const msg = buildJobMessage(job, { changes: ["new"], jobs: [job], today });
    expect(msg).toContain("👤 P'Bee Via Line");            // header keeps it
    expect(msg).toContain("10 Factory01, Nivea ✈️ ✅");     // recap does not
  });
});
