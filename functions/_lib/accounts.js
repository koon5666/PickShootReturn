// Accounts + credentials on top of KV (P0-2, P2-6).
//
// Three kinds of account share one PIN scheme (functions/_lib/auth.js):
//   owner      the rental house itself. Credential = `adminPinHash` (was the
//              plaintext `adminPin`; accepted ONCE at login and upgraded, then the
//              plaintext key is deleted, so prod keeps working with no migration).
//              Display name lives in staff[] as { id: "owner", role: "owner" }.
//   staff      named admin accounts (P2-6) in `staff`: { id, name, role: "owner"|"counter", pinHash }.
//              Every admin session keeps id "admin" (house documents, presence and
//              chat key on it); staffId / name / staffRole tell WHO did it.
//   employee   crew in `employees`: { id, name, pinHash } (legacy plaintext `pin`
//              accepted once at login and upgraded the same way).
// A member-register request stores `requestedPinHash` (hashed at registration,
// never the plaintext); approval copies the hash onto the new employee.
import { hashPin, verifyPin, isPinHash, PIN_RE, ADMIN_ID, OWNER_STAFF_ID, stripEmployee, stripStaff } from "./auth.js";
import { readField, writeField } from "./store.js";

export const DEFAULT_ADMIN_PIN = "1234"; // only when KV holds NO owner credential at all (brand-new account)

const list = (v) => (Array.isArray(v) ? v : []);
const validPin = (pin) => typeof pin === "string" && PIN_RE.test(pin);

// ── read helpers ─────────────────────────────────────────────────────────────
export async function readStaff(kv) { return list((await readField(kv, "staff")).value); }
export async function readEmployees(kv) { return list((await readField(kv, "employees")).value); }
export async function ownerName(kv, staff) {
  const s = (staff || await readStaff(kv)).find(x => x && x.id === OWNER_STAFF_ID);
  return (s && s.name) || "Owner";
}
export function ownerSession(name) { return { role: "admin", id: ADMIN_ID, staffId: OWNER_STAFF_ID, staffRole: "owner", name: name || "Owner" }; }
export function staffSession(s) { return { role: "admin", id: ADMIN_ID, staffId: s.id, staffRole: s.role === "owner" ? "owner" : "counter", name: s.name || "Staff" }; }
export function employeeSession(e) { return { role: "employee", id: e.id, name: e.name || "" }; }

// ── owner ────────────────────────────────────────────────────────────────────
// Returns { ok, upgraded } . `ok` false = wrong PIN (or no credential path).
export async function verifyOwnerPin(kv, pin) {
  if (!validPin(pin)) return { ok: false };
  const { value: hash } = await readField(kv, "adminPinHash");
  if (isPinHash(hash)) return { ok: await verifyPin(pin, hash) };
  // Legacy plaintext, or a brand-new account with nothing set yet.
  const { raw, value: legacy } = await readField(kv, "adminPin");
  // raw absent = brand-new account; a raw value that is not JSON (very old
  // writes) is taken as the literal PIN, never as "nothing set".
  const plain = raw == null ? DEFAULT_ADMIN_PIN : legacy != null ? String(legacy) : String(raw).trim();
  if (pin !== plain) return { ok: false };
  await writeField(kv, "adminPinHash", await hashPin(pin));
  await kv.delete("adminPin");
  return { ok: true, upgraded: true };
}
export async function setOwnerPin(kv, pin) {
  if (!validPin(pin)) throw new Error("PIN must be 4-6 digits");
  await writeField(kv, "adminPinHash", await hashPin(pin));
  await kv.delete("adminPin");
}
// Admin PUT /api/data may still carry a plaintext `adminPin` (old client, seed
// script): it becomes the hashed owner credential right away.
export async function adoptPlainAdminPin(kv, pin) {
  if (!validPin(String(pin))) return false;
  await setOwnerPin(kv, String(pin));
  return true;
}

// ── staff (P2-6) ─────────────────────────────────────────────────────────────
export async function verifyStaffPin(kv, staffId, pin) {
  if (!validPin(pin)) return { ok: false };
  const staff = await readStaff(kv);
  const s = staff.find(x => x && x.id === staffId);
  if (!s || !isPinHash(s.pinHash)) return { ok: false };
  return { ok: await verifyPin(pin, s.pinHash), staff: s };
}
export async function addStaff(kv, { name, role, pin }) {
  if (!validPin(pin)) throw new Error("PIN must be 4-6 digits");
  const nm = String(name || "").trim();
  if (!nm) throw new Error("name required");
  const staff = await readStaff(kv);
  const entry = { id: "st" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: nm, role: role === "owner" ? "owner" : "counter", pinHash: await hashPin(pin), createdAt: Date.now() };
  const next = [...staff, entry];
  const v = await writeField(kv, "staff", next);
  return { staff: next.map(stripStaff), entry: stripStaff(entry), v };
}
export async function removeStaff(kv, id) {
  if (id === OWNER_STAFF_ID) throw new Error("the owner account cannot be removed");
  const staff = await readStaff(kv);
  const next = staff.filter(s => !(s && s.id === id));
  if (next.length === staff.length) return null;
  const v = await writeField(kv, "staff", next);
  return { staff: next.map(stripStaff), v };
}
export async function renameStaff(kv, id, name) {
  const nm = String(name || "").trim();
  if (!nm) throw new Error("name required");
  const staff = await readStaff(kv);
  let found = false;
  let next = staff.map(s => { if (s && s.id === id) { found = true; return { ...s, name: nm }; } return s; });
  if (!found) {
    if (id !== OWNER_STAFF_ID) return null;
    next = [...staff, { id: OWNER_STAFF_ID, name: nm, role: "owner" }]; // owner display name (no credential here)
  }
  const v = await writeField(kv, "staff", next);
  return { staff: next.map(stripStaff), v };
}
export async function setStaffPin(kv, id, pin) {
  if (!validPin(pin)) throw new Error("PIN must be 4-6 digits");
  if (id === OWNER_STAFF_ID) { await setOwnerPin(kv, pin); return { staff: (await readStaff(kv)).map(stripStaff) }; }
  const staff = await readStaff(kv);
  let found = false;
  const pinHash = await hashPin(pin);
  const next = staff.map(s => { if (s && s.id === id) { found = true; return { ...s, pinHash }; } return s; });
  if (!found) return null;
  const v = await writeField(kv, "staff", next);
  return { staff: next.map(stripStaff), v };
}

// ── employees ────────────────────────────────────────────────────────────────
export async function verifyEmployeePin(kv, empId, pin) {
  if (!validPin(pin)) return { ok: false };
  const employees = await readEmployees(kv);
  const e = employees.find(x => x && x.id === empId);
  if (!e) return { ok: false };
  if (isPinHash(e.pinHash)) return { ok: await verifyPin(pin, e.pinHash), employee: e };
  if (typeof e.pin === "string" && e.pin) {
    if (pin !== e.pin) return { ok: false };
    // Legacy plaintext: upgrade on first successful login.
    const next = employees.map(x => (x && x.id === empId) ? withHash(x, null) : x);
    const idx = next.findIndex(x => x && x.id === empId);
    next[idx] = withHash(next[idx], await hashPin(pin));
    await writeField(kv, "employees", next);
    return { ok: true, employee: next[idx], upgraded: true };
  }
  return { ok: false, reason: "no-credential" };
}
function withHash(e, pinHash) {
  const { pin, pinHash: _old, ...rest } = e;
  return pinHash ? { ...rest, pinHash } : rest;
}
// Admin sets / resets a crew PIN. `name` lets a not-yet-saved member be created
// in the same call (Team > Add Member), so the PIN never travels in the
// employees array. Returns the stripped list + version, or null when the id is
// unknown and no name was given.
export async function setEmployeePin(kv, id, pin, { name } = {}) {
  if (!validPin(pin)) throw new Error("PIN must be 4-6 digits");
  const employees = await readEmployees(kv);
  const pinHash = await hashPin(pin);
  let found = false;
  let next = employees.map(e => { if (e && e.id === id) { found = true; return withHash(e, pinHash); } return e; });
  if (!found) {
    const nm = String(name || "").trim();
    if (!nm) return null;
    next = [...employees, { id, name: nm, pinHash }];
  }
  const v = await writeField(kv, "employees", next);
  return { employees: next.map(stripEmployee), v, created: !found };
}

// Self-service change (any role): verify the old PIN against the caller's own
// account, then write the new one.
export async function changeOwnPin(kv, session, oldPin, newPin) {
  if (!validPin(newPin)) return { ok: false, error: "PIN must be 4-6 digits" };
  if (session.role === "employee") {
    const r = await verifyEmployeePin(kv, session.id, oldPin);
    if (!r.ok) return { ok: false, wrong: true };
    await setEmployeePin(kv, session.id, newPin);
    return { ok: true };
  }
  if ((session.staffId || OWNER_STAFF_ID) === OWNER_STAFF_ID) {
    const r = await verifyOwnerPin(kv, oldPin);
    if (!r.ok) return { ok: false, wrong: true };
    await setOwnerPin(kv, newPin);
    return { ok: true };
  }
  const r = await verifyStaffPin(kv, session.staffId, oldPin);
  if (!r.ok) return { ok: false, wrong: true };
  await setStaffPin(kv, session.staffId, newPin);
  return { ok: true };
}

// PUT /api/data `employees` from an admin: the client never holds credentials
// (GET strips them), so every incoming record takes its pinHash / legacy pin
// from KV by id. A plaintext `pin` on an incoming record (old client, seed) is
// hashed on the spot; an incoming `pinHash` is never trusted.
export async function protectEmployees(incoming, existing) {
  const kv = new Map(list(existing).filter(e => e && e.id != null).map(e => [e.id, e]));
  const out = [];
  for (const e of list(incoming)) {
    if (!e || typeof e !== "object") { out.push(e); continue; }
    const { pin, pinHash, ...rest } = e;
    const prev = kv.get(e.id);
    if (typeof pin === "string" && PIN_RE.test(pin)) { out.push({ ...rest, pinHash: await hashPin(pin) }); continue; }
    if (prev && isPinHash(prev.pinHash)) out.push({ ...rest, pinHash: prev.pinHash });
    else if (prev && typeof prev.pin === "string" && prev.pin) out.push({ ...rest, pin: prev.pin });
    else out.push(rest);
  }
  return out;
}

// PUT /api/data `adminRequests`: a pending member-register request carries the
// requested PIN (hashed) that approve-member turns into the new account's
// credential. GET strips it, so an admin save of the list must carry it forward
// from KV by id, never from the client (an incoming value is never trusted).
// Without this the first admin save after a sign-up dropped the credential and
// the approved member could not log in.
export function protectRequests(incoming, existing) {
  const kv = new Map(list(existing).filter(r => r && r.id != null).map(r => [r.id, r]));
  return list(incoming).map(r => {
    if (!r || typeof r !== "object") return r;
    const { requestedPin, requestedPinHash, ...rest } = r;
    const prev = kv.get(r.id);
    if (prev && isPinHash(prev.requestedPinHash)) return { ...rest, requestedPinHash: prev.requestedPinHash };
    if (prev && typeof prev.requestedPin === "string" && prev.requestedPin) return { ...rest, requestedPin: prev.requestedPin };
    return rest;
  });
}

// ── calendar token (per-tenant, P0-2) ────────────────────────────────────────
export function newToken(bytes = 24) {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return [...a].map(b => b.toString(16).padStart(2, "0")).join("");
}
export async function ensureCalendarToken(kv) {
  const { value } = await readField(kv, "calendarToken");
  if (typeof value === "string" && value.length >= 32) return value;
  const t = newToken();
  await writeField(kv, "calendarToken", t);
  return t;
}
export async function rotateCalendarToken(kv) {
  const t = newToken();
  await writeField(kv, "calendarToken", t);
  return t;
}
