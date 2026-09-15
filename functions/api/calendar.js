// iCal feed of the job calendar. Needs the per-tenant token (P0-2):
//   GET /api/calendar?token=<calendarToken>
// The token is created at first login (functions/_lib/accounts.js) and shown in
// Settings / crew Profile; rotating it there invalidates every old subscription.
// No token in KV yet (nobody has logged in since the upgrade) -> 403 as well.
// X-WR-TIMEZONE comes from the tenant's saved timezone (P3-8, functions/_lib/tz.js).
import { readField } from "../_lib/store.js";
import { calendarTimezone } from "../_lib/tz.js";

function esc(str) {
  return (str || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function fold(line) {
  if (line.length <= 75) return line;
  const parts = [line.slice(0, 75)];
  let i = 75;
  while (i < line.length) { parts.push(" " + line.slice(i, i + 74)); i += 74; }
  return parts.join("\r\n");
}

function nextDay(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

export async function onRequestGet({ env, request }) {
  const url = new URL(request.url);
  const sent = url.searchParams.get("token") || "";
  const { value: token } = await readField(env.KV, "calendarToken");
  if (!(typeof token === "string" && token.length >= 32 && sent === token)) {
    return new Response("calendar token required", { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  }
  const [jobs, savedTz] = await Promise.all([
    env.KV.get("jobs", "json").then(v => v || []),
    env.KV.get("timezone", "json").catch(() => null),
  ]);
  const tz = calendarTimezone(savedTz);
  const stamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15) + "Z";

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//PickShootReturn//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:PickShootReturn",
    "X-WR-CALDESC:Film Production Schedule",
    `X-WR-TIMEZONE:${tz}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];

  for (const job of jobs) {
    if (job.status === "Cancelled") continue;
    for (const date of (job.dates || [])) {
      const descParts = [];
      if (job.production) descParts.push(`Production: ${job.production}`);
      if (job.location) descParts.push(`Location: ${job.location}${job.locationCity ? ` — ${job.locationCity}` : ""}`);
      if (job.shootTime) descParts.push(`Shoot: ${job.shootTime}`);

      lines.push("BEGIN:VEVENT");
      lines.push(`UID:${job.id}-${date}@pickshootreturn.pages.dev`);
      lines.push(`DTSTAMP:${stamp}`);
      lines.push(`DTSTART;VALUE=DATE:${date.replace(/-/g, "")}`);
      lines.push(`DTEND;VALUE=DATE:${nextDay(date)}`);
      lines.push(fold(`SUMMARY:${esc(job.name)}`));
      lines.push(job.status === "Pencil" ? "STATUS:TENTATIVE" : "STATUS:CONFIRMED");
      if (descParts.length) lines.push(fold(`DESCRIPTION:${esc(descParts.join("\\n"))}`));
      lines.push("END:VEVENT");
    }
  }

  lines.push("END:VCALENDAR");

  return new Response(lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "no-cache, no-store",
    },
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204 });
}
