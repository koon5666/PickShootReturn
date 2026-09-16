// Per-user LINE identity without LIFF (P3-6).
//
// A crew member gets a short link code in Profile > LINE notifications, sends
// it to the house's LINE Official Account in a 1:1 chat, and the webhook pairs
// the sender's userId with the employee record (employees[].lineUserId).
// From then on approvals, denials and reminders can be pushed to that person
// directly (functions/api/notify.js resolves `employeeIds` server-side; the
// userId itself never reaches a client, GET only exposes `lineLinked: true`).
//
// Pure helpers, unit-tested in linelink.test.js. The routes own the KV calls.

export const LINK_CODE_TTL_MS = 24 * 3600 * 1000;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

export function newLinkCode(rand = Math.random) {
  let s = "";
  for (let i = 0; i < 6; i++) s += ALPHABET[Math.floor(rand() * ALPHABET.length) % ALPHABET.length];
  return s;
}

// "LINK ABC234", "link-abc234", "ABC234 please" -> "ABC234"; null when no code.
export function parseLinkCode(text) {
  const m = String(text || "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").match(/\b([A-Z2-9]{6})\b/g);
  if (!m) return null;
  const hit = m.find(c => c !== "LINKME" && [...c].every(ch => ALPHABET.includes(ch)));
  return hit || null;
}

// Fields the server keeps on an employee record that a client must never see or
// write. protectEmployees carries them from KV; stripEmployee hides them.
export const LINE_SERVER_FIELDS = ["lineUserId", "lineLinkCode", "lineLinkCodeAt", "lineLinkedAt"];

export function issueLinkCode(employees, empId, { now = Date.now(), rand } = {}) {
  const code = newLinkCode(rand);
  let found = false;
  const out = (employees || []).map(e => {
    if (!e || e.id !== empId) return e;
    found = true;
    return { ...e, lineLinkCode: code, lineLinkCodeAt: now };
  });
  return found ? { employees: out, code, expiresAt: now + LINK_CODE_TTL_MS } : null;
}

// Pair `userId` with the employee holding a live `code`. The same LINE account
// can belong to one crew member only, so any other record holding this userId
// is unlinked. Returns null when the code is unknown or expired.
export function applyLinkCode(employees, code, userId, now = Date.now()) {
  if (!code || !userId) return null;
  const target = (employees || []).find(e => e && e.lineLinkCode === code && typeof e.lineLinkCodeAt === "number" && now - e.lineLinkCodeAt <= LINK_CODE_TTL_MS);
  if (!target) return null;
  const out = (employees || []).map(e => {
    if (!e) return e;
    if (e.id === target.id) { const { lineLinkCode, lineLinkCodeAt, ...rest } = e; return { ...rest, lineUserId: userId, lineLinkedAt: now }; }
    if (e.lineUserId === userId) { const { lineUserId, lineLinkedAt, ...rest } = e; return rest; }
    return e;
  });
  return { employees: out, employee: out.find(e => e && e.id === target.id) };
}

export function unlinkEmployee(employees, empId) {
  return (employees || []).map(e => {
    if (!e || e.id !== empId) return e;
    const { lineUserId, lineLinkedAt, lineLinkCode, lineLinkCodeAt, ...rest } = e;
    return rest;
  });
}

// What a client may know about its own link state.
export function linkStatus(employee, now = Date.now()) {
  if (!employee) return { linked: false, code: null, expiresAt: null };
  const live = employee.lineLinkCode && typeof employee.lineLinkCodeAt === "number" && now - employee.lineLinkCodeAt <= LINK_CODE_TTL_MS;
  return { linked: !!employee.lineUserId, code: live ? employee.lineLinkCode : null, expiresAt: live ? employee.lineLinkCodeAt + LINK_CODE_TTL_MS : null };
}

// LINE userIds for a list of employee ids (unlinked members are skipped, dedup).
export function resolveLineUserIds(employees, employeeIds) {
  const want = new Set((employeeIds || []).map(String));
  const out = [];
  for (const e of employees || []) if (e && want.has(String(e.id)) && e.lineUserId && !out.includes(e.lineUserId)) out.push(e.lineUserId);
  return out;
}
