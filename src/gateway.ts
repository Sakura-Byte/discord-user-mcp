// Minimal Discord gateway client for a user account.
// Slash commands need a live session_id, and ephemeral bot replies are
// only ever delivered over the gateway, so interactions depend on this.

import { acquireSlot } from "./ratelimit.js";

const GATEWAY_URL = "wss://gateway.discord.gg/?encoding=json&v=9";

// Node >= 22 ships a global WebSocket; @types/node doesn't declare it here.
const WebSocketImpl: any = (globalThis as any).WebSocket;

export const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

export const SUPER_PROPERTIES = {
  os: "Windows",
  browser: "Chrome",
  device: "",
  system_locale: "zh-CN",
  browser_user_agent: BROWSER_USER_AGENT,
  browser_version: "140.0.0.0",
  os_version: "10",
  referrer: "",
  referring_domain: "",
  release_channel: "stable",
  client_build_number: 440000,
  client_event_source: null,
};

type Listener = (event: string, data: any) => void;

export class DiscordGateway {
  private ws: any = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private seq: number | null = null;
  private listeners = new Set<Listener>();
  private readyPromise: Promise<string> | null = null;
  sessionId: string | null = null;

  constructor(private token: string) {}

  /** Connect (once) and resolve with the session id. */
  ensureReady(timeoutMs = 20000): Promise<string> {
    if (this.sessionId && this.ws?.readyState === 1) {
      return Promise.resolve(this.sessionId);
    }
    if (!this.readyPromise) {
      this.readyPromise = acquireSlot()
        .then(() => this.connect(timeoutMs))
        .catch((err) => {
        this.readyPromise = null;
        throw err;
      });
    }
    return this.readyPromise;
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private connect(timeoutMs: number): Promise<string> {
    if (!WebSocketImpl) {
      return Promise.reject(
        new Error("Global WebSocket not available; Node.js 22+ is required."),
      );
    }

    return new Promise((resolve, reject) => {
      const ws = new WebSocketImpl(GATEWAY_URL);
      this.ws = ws;
      const timer = setTimeout(() => {
        reject(new Error("Timed out waiting for gateway READY."));
        ws.close();
      }, timeoutMs);

      ws.onmessage = (ev: { data: string }) => {
        const payload = JSON.parse(String(ev.data));
        if (payload.s != null) this.seq = payload.s;

        switch (payload.op) {
          case 10: // HELLO
            this.startHeartbeat(payload.d.heartbeat_interval);
            this.send(2, {
              token: this.token,
              capabilities: 16381,
              properties: SUPER_PROPERTIES,
              presence: { status: "unknown", since: 0, activities: [], afk: false },
              compress: false,
              client_state: { guild_versions: {} },
            });
            break;
          case 0: // DISPATCH
            if (payload.t === "READY") {
              this.sessionId = payload.d.session_id;
              clearTimeout(timer);
              console.error("discord-mcp: gateway ready");
              resolve(this.sessionId!);
            }
            for (const l of this.listeners) l(payload.t, payload.d);
            break;
          case 7: // RECONNECT
          case 9: // INVALID SESSION
            this.reset();
            break;
        }
      };

      ws.onclose = (ev: { code: number }) => {
        clearTimeout(timer);
        this.stopHeartbeat();
        this.sessionId = null;
        this.readyPromise = null;
        if (ev.code === 4004) {
          reject(new Error("Gateway rejected the token (4004)."));
        } else {
          reject(new Error(`Gateway closed (code ${ev.code}).`));
        }
      };

      ws.onerror = () => {
        // onclose follows and reports the failure.
      };
    });
  }

  /** Drop the connection; the next ensureReady() reconnects. */
  private reset(): void {
    this.stopHeartbeat();
    this.sessionId = null;
    this.readyPromise = null;
    try {
      this.ws?.close();
    } catch {
      // already closed
    }
  }

  private send(op: number, d: unknown): void {
    this.ws?.send(JSON.stringify({ op, d }));
  }

  private startHeartbeat(interval: number): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => this.send(1, this.seq), interval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }
}
