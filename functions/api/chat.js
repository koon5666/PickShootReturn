// WebSocket proxy: routes the upgrade to the global ChatDO instance.
// ChatDO class lives in the `pickshootreturn-presence` Worker.
export async function onRequest({ request, env }) {
  const id = env.CHAT.idFromName("global-chat");
  const stub = env.CHAT.get(id);
  return stub.fetch(request);
}
