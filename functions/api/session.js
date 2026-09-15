// WebSocket proxy: routes the upgrade request to the PresenceDO instance for this user.
// The DO class lives in the `pickshootreturn-presence` Worker (presence-worker/index.js).
// Session required (P0-2): the presence identity is the SESSION id, never a query
// parameter, so one crew member cannot pose as another (or as admin).
import { requireSession } from "../_lib/auth.js";

export async function onRequest(context) {
  const auth = await requireSession(context);
  if (!auth.ok) return auth.response;
  const { request, env } = context;
  if (!env.PRESENCE) return new Response("presence not configured", { status: 503 });
  const url = new URL(request.url);
  const userId = auth.session.id;
  url.searchParams.set("userId", userId);
  const id = env.PRESENCE.idFromName(userId);
  const stub = env.PRESENCE.get(id);
  return stub.fetch(new Request(url.toString(), request));
}
