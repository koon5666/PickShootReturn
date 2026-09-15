import { describe, it, expect } from "vitest";
import { DEPARTMENTS, roleOptions, DEFAULT_POSITION_NAMES } from "./positions.js";

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
