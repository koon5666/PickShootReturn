// WebSocket proxy: routes the upgrade request to the PresenceDO instance for this user.
// The DO class lives in the `pickshootreturn-presence` Worker (presence-worker/index.js).
export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const userId = url.searchParams.get("userId");
  if (!userId) return new Response("userId required", { status: 400 });
  const id = env.PRESENCE.idFromName(userId);
  const stub = env.PRESENCE.get(id);
  return stub.fetch(request);
}
