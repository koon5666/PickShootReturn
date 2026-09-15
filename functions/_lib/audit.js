// Actor stamps (P2-6): a server-owned, append-only `auditLog` field written by
// the session-aware endpoints (approvals, PIN resets, staff changes, deletes,
// clear history, backup create/restore, job delete). Every entry carries WHO
// (the session name) and the role. Capped at the last AUDIT_MAX entries; the
// client never writes this field (roles.SERVER_OWNED_FIELDS), it only reads it.
import { readField, writeField } from "./store.js";

export const AUDIT_MAX = 500;

export function actorOf(session) {
  if (!session) return { by: "system", role: "system", staffId: null, actorId: null };
  const name = session.name || (session.role === "admin" ? "Admin" : session.id);
  return { by: name, role: session.role, staffId: session.role === "admin" ? (session.staffId || "owner") : null, actorId: session.role === "admin" ? "admin" : session.id };
}

export function auditEntry(session, entry, now = Date.now()) {
  const a = actorOf(session);
  const e = { id: "au" + now.toString(36) + Math.random().toString(36).slice(2, 6), ts: now, ...a, action: String(entry.action || "").slice(0, 60) };
  for (const k of ["field", "recordId", "name", "detail", "targetId"]) if (entry[k] != null) e[k] = typeof entry[k] === "string" ? entry[k].slice(0, 200) : entry[k];
  return e;
}

// Best effort: an audit failure never fails the action it describes.
export async function appendAudit(kv, session, entry) {
  try {
    const { value } = await readField(kv, "auditLog");
    const log = Array.isArray(value) ? value : [];
    const next = [...log, auditEntry(session, entry)].slice(-AUDIT_MAX);
    await writeField(kv, "auditLog", next);
    return next[next.length - 1];
  } catch {
    return null;
  }
}
