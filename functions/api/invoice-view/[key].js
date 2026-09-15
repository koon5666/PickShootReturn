// Public reader for a shared invoice link. Serves the stored HTML and counts
// the view (best effort; KV is eventually consistent so the counter is
// approximate). Legacy raw-HTML shares are still served until they expire.
import { isShareKey, parseStored, isExpired, remainingTtl } from "../../_lib/share.js";

const gone = () => new Response("Invoice not found or link has expired.", {
  status: 404,
  headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
});

export async function onRequestGet({ env, params, waitUntil }) {
  // Only shared-invoice keys are readable here. Without this guard the endpoint
  // is an arbitrary KV read (adminPin, profiles, backups, checkouts, …).
  if (!isShareKey(params.key || "")) return gone();
  const raw = await env.KV.get(params.key);
  const stored = parseStored(raw);
  if (!stored || isExpired(stored)) return gone();
  if (!stored.legacy) {
    const bumped = { ...stored, views: (stored.views || 0) + 1, lastViewedAt: Date.now() };
    const write = env.KV.put(params.key, JSON.stringify(bumped), { expirationTtl: remainingTtl(stored) }).catch(() => {});
    if (typeof waitUntil === "function") waitUntil(write); else await write;
  }
  return new Response(stored.html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204 });
}
