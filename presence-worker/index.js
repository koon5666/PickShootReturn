// Durable Object: one global instance for the team chat room.
export class ChatDO {
  constructor(state) { this.state = state; }

  async fetch(request) {
    const url = new URL(request.url);
    const userId = url.searchParams.get("userId") || "anon";
    const name = url.searchParams.get("name") || "User";

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const connId = crypto.randomUUID();
    this.state.acceptWebSocket(server, [connId]);
    server.serializeAttachment({ connId, userId, name });

    // Send message history to the connecting client.
    const history = (await this.state.storage.get("messages")) || [];
    server.send(JSON.stringify({ type: "history", messages: history }));

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, rawMsg) {
    try {
      const data = JSON.parse(rawMsg);
      if (data.type === "message" && data.message) {
        const msg = {
          id: data.message.id || crypto.randomUUID(),
          senderId: data.message.senderId,
          senderName: String(data.message.senderName || "User"),
          senderAvatar: data.message.senderAvatar || null,
          text: String(data.message.text || "").slice(0, 2000),
          ts: data.message.ts || Date.now(),
        };

        // Persist message — keep last 200.
        const messages = (await this.state.storage.get("messages")) || [];
        messages.push(msg);
        if (messages.length > 200) messages.splice(0, messages.length - 200);
        await this.state.storage.put("messages", messages);

        // Broadcast to all OTHER connections (sender has already updated optimistically).
        const att = ws.deserializeAttachment();
        const text = JSON.stringify({ type: "message", message: msg });
        this.state.getWebSockets().forEach(socket => {
          const sAtt = socket.deserializeAttachment();
          if (sAtt && sAtt.connId !== att?.connId) {
            try { socket.send(text); } catch {}
          }
        });
      } else if (data.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
      }
    } catch {}
  }

  webSocketClose() {}
  webSocketError() {}
}

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
    const pathname = url.pathname;

    if (pathname === "/chat" || pathname.startsWith("/chat/")) {
      const id = env.CHAT.idFromName("global-chat");
      const stub = env.CHAT.get(id);
      return stub.fetch(request);
    }

    const userId = url.searchParams.get("userId");
    if (!userId) return new Response("userId required", { status: 400 });
    const id = env.PRESENCE.idFromName(userId);
    const stub = env.PRESENCE.get(id);
    return stub.fetch(request);
  },
};
