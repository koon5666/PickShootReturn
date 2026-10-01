// Dry-run outbox (EMAIL_DRY_RUN=1 only, i.e. local testing): every email the app
// would have sent, newest first, so it can be read in a browser without sending.
//   GET /api/email-outbox            admin: the list (links to each mail)
//   GET /api/email-outbox?id=<id>    admin: one mail rendered as it would arrive
import { requireAdmin } from "../_lib/auth.js";

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export async function onRequestGet(ctx) {
  const { env, request } = ctx;
  if (env.EMAIL_DRY_RUN !== "1") return new Response("Not found", { status: 404 });
  const auth = await requireAdmin(ctx);
  if (!auth.ok) return auth.response;
  const id = new URL(request.url).searchParams.get("id");
  if (id) {
    const mail = await env.KV.get(`outbox:${id}`, "json");
    if (!mail) return new Response("Not found", { status: 404 });
    const head = `<div style="font:13px/1.5 -apple-system,Arial,sans-serif;background:#16324A;color:#fff;padding:10px 16px"><a href="/api/email-outbox" style="color:#9CC3FF">&larr; Outbox</a> &nbsp; <b>To:</b> ${esc(mail.to && mail.to[0])} &nbsp; <b>From:</b> ${esc(mail.from)}${mail.reply_to ? ` &nbsp; <b>Reply-To:</b> ${esc(mail.reply_to)}` : ""}<br><b>Subject:</b> ${esc(mail.subject)}</div>`;
    return new Response(head + mail.html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  }
  const list = await env.KV.list({ prefix: "outbox:" });
  const mails = (await Promise.all(list.keys.map(k => env.KV.get(k.name, "json")))).filter(Boolean).sort((a, b) => String(b.id).localeCompare(String(a.id)));
  const rows = mails.map(m => `<tr><td style="padding:8px 10px;color:#5F7A91;white-space:nowrap">${esc(new Date(m.at).toLocaleString("en-GB"))}</td><td style="padding:8px 10px">${esc(m.to && m.to[0])}</td><td style="padding:8px 10px"><a href="/api/email-outbox?id=${encodeURIComponent(m.id)}">${esc(m.subject)}</a></td></tr>`).join("");
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email outbox</title>
<body style="font:14px/1.5 -apple-system,Arial,sans-serif;margin:0;padding:16px;background:#F4F7FB;color:#16324A">
<h2 style="margin:0 0 4px">Email outbox (dry run)</h2><p style="margin:0 0 14px;color:#5F7A91">Nothing here was sent. ${mails.length} email(s), kept 7 days.</p>
<table style="border-collapse:collapse;background:#fff;border:1px solid #D8E1EC;width:100%">${rows || `<tr><td style="padding:12px">No emails yet.</td></tr>`}</table></body>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
