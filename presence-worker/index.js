// Durable Object: one instance per userId. Tracks WebSocket sessions for that user.
export class PresenceDO {
  constructor(state) { this.state = state; }

  async fetch(request) {
    const url = new URL(request.url);
    const deviceId = url.searchParams.get("deviceId") || crypto.randomUUID();
    const label = url.searchParams.get("label") || "Browser";

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.state.acceptWebSocket(server, [deviceId]);
    server.serializeAttachment({ deviceId, label });

    // Tell the joining device about any other active sessions for this user.
    const others = this.state.getWebSockets()
      .map(ws => ws.deserializeAttachment())
      .filter(att => att && att.deviceId !== deviceId);
    if (others.length > 0) {
      server.send(JSON.stringify({ type: "concurrent", sessions: others }));
    }

    // Notify other sessions that a new one joined.
    this._broadcast({ type: "session_join", deviceId, label }, deviceId);

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, message) {
    try {
      const { type } = JSON.parse(message);
      if (type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
      } else if (type === "data_saved") {
        // Relay to all other sessions of this user so they pull fresh data.
        const att = ws.deserializeAttachment();
        if (att) this._broadcast({ type: "data_saved" }, att.deviceId);
      }
    } catch {}
  }

  webSocketClose(ws) {
    const att = ws.deserializeAttachment();
    if (att) this._broadcast({ type: "session_leave", deviceId: att.deviceId }, att.deviceId);
  }

  webSocketError(ws) {
    const att = ws.deserializeAttachment();
    if (att) this._broadcast({ type: "session_leave", deviceId: att.deviceId }, att.deviceId);
  }

  _broadcast(msg, excludeDeviceId) {
    const text = JSON.stringify(msg);
    this.state.getWebSockets().forEach(ws => {
      const att = ws.deserializeAttachment();
      if (att && att.deviceId !== excludeDeviceId) {
        try { ws.send(text); } catch {}
      }
    });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const userId = url.searchParams.get("userId");
    if (!userId) return new Response("userId required", { status: 400 });
    const id = env.PRESENCE.idFromName(userId);
    const stub = env.PRESENCE.get(id);
    return stub.fetch(request);
  },
};
