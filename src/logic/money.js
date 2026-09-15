// Pure money math shared by the crew invoice modal, the admin invoice page and
// the printed A4 document. No React, no globals: unit-tested in money.test.js.
// Behaviour is byte-identical to the functions that used to live in App.jsx.

// Hours between two "HH:MM" times (handles an overnight wrap).
export function hoursWorked(call, wrap) {
  if (!call || !wrap) return 0;
  const [ch, cm] = call.slice(0, 5).split(":").map(Number);
  const [wh, wm] = wrap.slice(0, 5).split(":").map(Number);
  let mins = (wh * 60 + wm) - (ch * 60 + cm);
  if (mins < 0) mins += 24 * 60;
  return mins / 60;
}

export const DEFAULT_OT_TIERS = [{ untilHour: 14, mult: 1.5 }, { untilHour: 16, mult: 2 }, { untilHour: 18, mult: 3 }];

// Overtime amount (THB) for one day worked, under a position's rate rules.
// ratePerHour = dayRate / hoursPerDay. Flat OT = otHours × ratePerHour × otMultiplier.
// Variable OT walks tiered multipliers by total-hour bands (e.g. 12–14h ×1.5, 14–16h ×2…).
// Flat ฿/hour OT (review item P3-4): pos.otMode === "flatRate" with otFlatRate > 0
// bills every OT hour at that fixed amount, ignoring the multiplier.
export function calcOtAmount(call, wrap, pos) {
  if (!pos) return 0;
  const base = parseFloat(pos.hoursPerDay) || 12;
  const worked = hoursWorked(call, wrap);
  if (worked <= base) return 0;
  const dayRate = parseFloat(pos.dayRate) || 0;
  const ratePerHour = base > 0 ? dayRate / base : 0;
  if (pos.otMode === "flatRate") {
    const flat = parseFloat(pos.otFlatRate) || 0;
    if (flat > 0) return (worked - base) * flat;
  }
  if (pos.variableOT && (pos.otTiers || []).length) {
    const tiers = (pos.otTiers || [])
      .map(tr => ({ untilHour: parseFloat(tr.untilHour), mult: parseFloat(tr.mult) }))
      .filter(tr => tr.untilHour > 0 && tr.mult > 0)
      .sort((a, b) => a.untilHour - b.untilHour);
    let cursor = base, amount = 0;
    for (const tr of tiers) {
      if (tr.untilHour <= cursor) continue;
      const segEnd = Math.min(worked, tr.untilHour);
      if (segEnd > cursor) { amount += (segEnd - cursor) * ratePerHour * tr.mult; cursor = segEnd; }
      if (cursor >= worked) break;
    }
    if (cursor < worked) {
      const lastMult = tiers.length ? tiers[tiers.length - 1].mult : (parseFloat(pos.otMultiplier) || 1.5);
      amount += (worked - cursor) * ratePerHour * lastMult;
    }
    return amount;
  }
  const mult = parseFloat(pos.otMultiplier) || 1.5;
  return (worked - base) * ratePerHour * mult;
}

export function calcVatBreakdown(inv) {
  const rawItems = inv.items?.length ? inv.items : [
    { description: "Labor Fee", qty: 1, rate: inv.laborFee || 0, vat: true },
    { description: "Overtime", qty: 1, rate: inv.overtime || 0, vat: true },
    { description: "Travel Fee", qty: 1, rate: inv.travelFee || 0, vat: true },
    { description: "Per Diem", qty: 1, rate: inv.perDiem || 0, vat: true },
  ].filter(it => parseFloat(it.rate) > 0);
  let subtotal = 0, vatAmount = 0;
  rawItems.forEach(it => {
    const qty = parseFloat(it.qty) || 0;
    const rate = parseFloat((it.rate || "").toString().replace(/,/g, "")) || 0;
    const line = qty * rate;
    const hasVat = inv.vatEnabled && it.vat !== false;
    if (hasVat) {
      if (inv.vatType === "inclusive") {
        const exVat = line / 1.07;
        subtotal += exVat;
        vatAmount += line - exVat;
      } else {
        subtotal += line;
        vatAmount += line * 0.07;
      }
    } else {
      subtotal += line;
    }
  });
  return { subtotal, vatAmount, total: subtotal + vatAmount };
}

export function calcTotal(inv) {
  if (inv.vatEnabled) return calcVatBreakdown(inv).total;
  if (inv.items?.length) {
    return inv.items.reduce((s, it) => s + (parseFloat(it.qty) || 0) * (parseFloat((it.rate || "").toString().replace(/,/g, "")) || 0), 0);
  }
  // legacy format
  return [inv.laborFee, inv.overtime, inv.travelFee, inv.perDiem]
    .map(v => parseFloat((v || "").toString().replace(/,/g, "")) || 0)
    .reduce((a, b) => a + b, 0);
}

// Worked example for the OT field (P3-4): what one OT hour pays under this
// position's rules. { ratePerHour, otPerHour, mode } or null when no rate yet.
export function otExample(pos) {
  if (!pos) return null;
  const base = parseFloat(pos.hoursPerDay) || 12;
  const dayRate = parseFloat(pos.dayRate) || 0;
  if (!(dayRate > 0) || !(base > 0)) return null;
  const ratePerHour = dayRate / base;
  if (pos.otMode === "flatRate") {
    const flat = parseFloat(pos.otFlatRate) || 0;
    return { ratePerHour, otPerHour: flat, mode: "flatRate", mult: null, base, dayRate };
  }
  const mult = parseFloat(pos.otMultiplier) || 1.5;
  return { ratePerHour, otPerHour: ratePerHour * mult, mode: "multiplier", mult, base, dayRate };
}
