import { describe, it, expect } from "vitest";
import { DEPARTMENTS, roleOptions, DEFAULT_POSITION_NAMES, parseRoleList, roleListText } from "./positions.js";

describe("department role list (P3-4)", () => {
  it("covers camera, lighting, grip, sound, production, art", () => {
    expect(DEPARTMENTS.map(d => d.id)).toEqual(["camera", "lighting", "grip", "sound", "production", "art"]);
  });
  it("every role has EN + TH and the stored value is the EN name", () => {
    for (const d of DEPARTMENTS) for (const r of d.roles) { expect(r.en).toBeTruthy(); expect(r.th).toBeTruthy(); }
    const th = roleOptions("th");
    expect(th.find(o => o.value === "Gaffer").label).toBe("หัวหน้าไฟ (Gaffer)");
    expect(th.find(o => o.value === "Gaffer").dept).toBe("ไฟ");
    expect(roleOptions("en").find(o => o.value === "1st AC").label).toBe("1st AC");
  });
  it("no duplicate role names", () => {
    expect(new Set(DEFAULT_POSITION_NAMES).size).toBe(DEFAULT_POSITION_NAMES.length);
    expect(DEFAULT_POSITION_NAMES).toContain("1st AC");
    expect(DEFAULT_POSITION_NAMES).toContain("Sound Recordist");
  });
});

describe("admin role list (P3-4 F18): the house's own roles replace the department list", () => {
  it("parses name / Thai name | department, skips blanks, and round-trips", () => {
    const raw = ["Gaffer / หัวหน้าไฟ | Lighting", "  ", "Driver", "Swing / สวิง"];
    expect(parseRoleList(raw)).toEqual([
      { en: "Gaffer", th: "หัวหน้าไฟ", dept: "Lighting" },
      { en: "Driver", th: "Driver", dept: "" },
      { en: "Swing", th: "สวิง", dept: "" },
    ]);
    expect(roleListText(raw)).toBe("Gaffer / หัวหน้าไฟ | Lighting\nDriver\nSwing / สวิง");
    expect(parseRoleList(null)).toEqual([]);
    expect(parseRoleList("Gaffer\nDriver")).toHaveLength(2);
  });
  it("roleOptions uses the custom list when it has entries, the departments otherwise", () => {
    const custom = ["Gaffer / หัวหน้าไฟ | Lighting", "Driver"];
    expect(roleOptions("en", custom).map(r => r.value)).toEqual(["Gaffer", "Driver"]);
    expect(roleOptions("th", custom).map(r => r.label)).toEqual(["หัวหน้าไฟ", "Driver"]);
    expect(roleOptions("en", []).length).toBeGreaterThan(20);
    expect(roleOptions("en", null).length).toBeGreaterThan(20);
  });
});
