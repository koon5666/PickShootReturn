// Server-side login rate limit (P0-2): 5 failures per 60 s per IP + account,
// kept in KV under rl:<key> with a short TTL. KV is eventually consistent, so a
// burst can slip a request or two past the window on a different edge; the aim
// is to make PIN guessing impractical, not to be an exact counter.
import { rateState, rateRecordFail, RATE } from "./auth.js";

const KEY = (k) => `rl:${k}`;
const TTL = Math.max(60, Math.ceil(RATE.windowMs / 1000) * 2);

export async function rateCheck(kv, key, now = Date.now()) {
  const state = await kv.get(KEY(key), "json");
  return rateState(state, now);
}
export async function rateFail(kv, key, now = Date.now()) {
  const state = await kv.get(KEY(key), "json");
  const next = rateRecordFail(state, now);
  await kv.put(KEY(key), JSON.stringify(next), { expirationTtl: TTL });
  return rateState(next, now);
}
export async function rateClear(kv, key) {
  await kv.delete(KEY(key));
}
export const rateKey = (ip, role, account) => `${ip}|${role}|${account || "-"}`.slice(0, 200);
