// Tenant timezone helpers for the server side (P3-8). The admin's Settings >
// Date/time choice is stored in KV under "timezone" (a JSON string); the iCal
// feed used to hard-code Asia/Bangkok.
export const DEFAULT_TZ = "Asia/Bangkok";

// Only a well-formed IANA id is trusted into the feed; anything else falls back.
export function calendarTimezone(saved) {
  const tz = typeof saved === "string" ? saved.trim() : "";
  return /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(tz) ? tz : DEFAULT_TZ;
}
