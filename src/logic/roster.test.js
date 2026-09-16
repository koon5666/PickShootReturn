import { describe, it, expect } from "vitest";
import { normalizeCrew, cleanTime, hasRoster, isOnRoster, jobVisibility, splitJobsForEmployee, defaultCheckoutRoles, crewNames, jobChangeSet, shouldNotify, pushRecipients, buildJobMessage, pushEmployeeIds } from "./roster.js";

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
  it("mentions the crew, their times and picks the headline from the change set", () => {
    const j = job({ crew: [{ employeeId: "e1", role: "1st AC", callTime: "07:00", pickupTime: "06:00" }, { employeeId: "e2", role: "Gaffer" }] });
    const msg = buildJobMessage(j, { changes: ["new"], employees: emps, formatDates: d => d.join("/") });
    expect(msg).toContain("[New Job] TVC");
    expect(msg).toContain("👥 Nong (1st AC), Arthit (Gaffer)");
    expect(msg).toContain("⏰ Nong: pickup 06:00, call 07:00");
    expect(msg).toContain("📅 2026-09-20/2026-09-21");
    expect(msg).not.toContain("—");
    expect(buildJobMessage(j, { changes: ["status"] })).toContain("[Status → Confirmed]");
    expect(buildJobMessage(j, { changes: ["roster"] })).toContain("[Crew updated]");
    expect(buildJobMessage(j, { changes: ["dates", "roster"] })).toContain("[Updated]");
    expect(buildJobMessage(job(), { changes: ["new"] })).not.toContain("👥");
  });
});

describe("pushEmployeeIds (per-user LINE without lineUserId on the client, P3-6)", () => {
  const emps = [{ id: "e1", name: "Nong", lineLinked: true }, { id: "e2", name: "Arthit" }];
  it("open job: everyone; rostered job: the roster only", () => {
    expect(pushEmployeeIds({ crew: [] }, emps)).toEqual(["e1", "e2"]);
    expect(pushEmployeeIds({ crew: [{ employeeId: "e2", role: "Grip" }] }, emps)).toEqual(["e2"]);
  });
});
