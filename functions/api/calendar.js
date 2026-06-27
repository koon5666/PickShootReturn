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

export async function onRequestGet({ env }) {
  const jobs = await env.KV.get("jobs", "json") || [];
  const stamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15) + "Z";

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//PickShootReturn//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:PickShootReturn",
    "X-WR-CALDESC:Film Production Schedule",
    "X-WR-TIMEZONE:Asia/Bangkok",
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
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*" } });
}
