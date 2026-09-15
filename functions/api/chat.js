// WebSocket proxy: routes the upgrade to the global ChatDO instance.
// ChatDO class lives in the `pickshootreturn-presence` Worker.
// Session required (P0-2); the chat identity (userId + name) comes from the
// session, not from the query string.
import { requireSession } from "../_lib/auth.js";

export async function onRequest(context) {
  const auth = await requireSession(context);
  if (!auth.ok) return auth.response;
  const { request, env } = context;
  if (!env.CHAT) return new Response("chat not configured", { status: 503 });
  const url = new URL(request.url);
  url.searchParams.set("userId", auth.session.id);
  url.searchParams.set("name", auth.session.role === "admin" ? (auth.session.name || "Admin") : (auth.session.name || "User"));
  const id = env.CHAT.idFromName("global-chat");
  const stub = env.CHAT.get(id);
  return stub.fetch(new Request(url.toString(), request));
}
