import { describe, it, expect } from "vitest";
import jsQR from "jsqr";
import { encodeText, qrMatrix, qrSvg, Ecc } from "./qrcodegen.js";

// Render the matrix as RGBA pixels (scale + quiet zone) and decode with jsQR,
// the same decoder the checkout scanner uses. A decode proves the whole
// pipeline: tables, RS ECC, interleave, placement, mask and format bits.
function decode(matrix, scale = 4, quiet = 4) {
  const n = matrix.length, w = (n + quiet * 2) * scale;
  const data = new Uint8ClampedArray(w * w * 4).fill(255);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (!matrix[y][x]) continue;
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const px = ((y + quiet) * scale + dy) * w + (x + quiet) * scale + dx;
      data[px * 4] = 0; data[px * 4 + 1] = 0; data[px * 4 + 2] = 0;
    }
  }
  const r = jsQR(data, w, w);
  return r ? r.data : null;
}

describe("qrcodegen (vendored)", () => {
  it("encodes the equipment label payload and jsQR reads it back", () => {
    for (const text of ["psr_eq:eq1", "psr_eq:eq" + Date.now(), "psr_eq:eq_fx6"]) {
      const m = qrMatrix(text);
      expect(m.length).toBe(text.length <= 14 ? 21 : 25); // version 1 (14 bytes at M) or 2
      expect(decode(m)).toBe(text);
    }
  });
  it("round-trips every ECC level at several lengths, including large versions", () => {
    const lens = [1, 17, 40, 100, 250, 600, 1200, 1650, 2300, 2940];
    const capacity = { 0: 2953, 1: 2331, 2: 1663, 3: 1273 }; // byte-mode capacity at version 40 per level (ISO 18004)
    for (const ecc of [Ecc.LOW, Ecc.MEDIUM, Ecc.QUARTILE, Ecc.HIGH]) {
      for (const len of lens) {
        if (len + 4 > capacity[ecc.ordinal]) continue;
        const text = "psr:" + "abcdefghij0123456789".repeat(Math.ceil(len / 20)).slice(0, len);
        const qr = encodeText(text, ecc, { boostEcl: false });
        expect(qr.errorCorrectionLevel).toBe(ecc);
        expect(decode(qr.modules, qr.size > 100 ? 3 : 4)).toBe(text);
      }
    }
  });
  it("handles UTF-8 (Thai) and picks a mask; explicit masks all decode", () => {
    const text = "อุปกรณ์ psr_eq:eq9";
    expect(decode(qrMatrix(text))).toBe(text);
    for (let mask = 0; mask < 8; mask++) {
      const qr = encodeText("psr_eq:eq123", Ecc.MEDIUM, { mask });
      expect(qr.mask).toBe(mask);
      expect(decode(qr.modules)).toBe("psr_eq:eq123");
    }
  });
  it("throws when the data cannot fit", () => {
    expect(() => encodeText("x".repeat(3000), Ecc.HIGH)).toThrow(RangeError);
  });
  it("qrSvg is a self-contained SVG with a quiet zone", () => {
    const svg = qrSvg("psr_eq:eq1", { size: 90, margin: 2 });
    expect(svg.startsWith("<svg xmlns=")).toBe(true);
    expect(svg).toContain('viewBox="0 0 25 25"');
    expect(svg).toContain('width="90"');
    expect(svg).not.toContain("<script");
  });
});
