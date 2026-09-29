/**
 * Singleton WebSocket client for /ws.
 *
 * Only used while signed in (the server rejects anonymous upgrades).
 * Auto-reconnects with exponential backoff. Tracks active subscriptions so
 * they can be replayed after a reconnect. Components subscribe via topic +
 * callback; multiple components can subscribe to the same topic — the server
 * sees a single subscribe message and the client fans out events.
 */

type Listener = (event: WsEvent) => void;

export type WsEvent = {
  type: "event";
  topic: string;
  kind: "created" | "updated" | "deleted";
  id?: string;
  data?: unknown;
};

class WsClient extends EventTarget {
  private ws: WebSocket | null = null;
  private status: "connecting" | "open" | "closed" = "closed";
  private listeners = new Map<string, Set<Listener>>();
  private reconnectDelay = 500;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private wasOpen = false;

  get isOpen(): boolean {
    return this.status === "open";
  }

  start(): void {
    if (this.ws || this.status === "connecting") return;
    this.status = "connecting";
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/ws`);
    this.ws = ws;

    ws.addEventListener("open", () => {
      this.status = "open";
      this.reconnectDelay = 500;
      // Replay subscriptions after reconnect.
      for (const topic of this.listeners.keys()) this.sendRaw({ type: "subscribe", topic });
      this.dispatchEvent(new Event("statuschange"));
      // Events sent while we were offline are lost: tell pages to resync.
      if (this.wasOpen) this.dispatchEvent(new Event("reconnect"));
      this.wasOpen = true;
    });

    ws.addEventListener("message", (e) => {
      let msg: unknown;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (!msg || typeof msg !== "object" || !("type" in msg)) return;
      if ((msg as { type: string }).type !== "event") return;
      const ev = msg as WsEvent;
      const subs = this.listeners.get(ev.topic);
      if (!subs) return;
      for (const fn of subs) {
        try {
          fn(ev);
        } catch (err) {
          console.error("[ws] listener threw", err);
        }
      }
    });

    ws.addEventListener("close", () => this.handleClose());
    ws.addEventListener("error", () => this.handleClose());
  }

  private handleClose(): void {
    if (this.status === "closed") return;
    this.status = "closed";
    this.ws = null;
    this.dispatchEvent(new Event("statuschange"));
    if (this.listeners.size === 0) return;
    if (this.reconnectTimer) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.start();
    }, delay);
  }

  subscribe(topic: string, listener: Listener): () => void {
    let set = this.listeners.get(topic);
    const firstForTopic = !set;
    if (!set) {
      set = new Set();
      this.listeners.set(topic, set);
    }
    set.add(listener);

    if (firstForTopic) {
      this.start();
      if (this.isOpen) this.sendRaw({ type: "subscribe", topic });
    }

    return () => {
      const s = this.listeners.get(topic);
      s?.delete(listener);
      if (s && s.size === 0) {
        this.listeners.delete(topic);
        if (this.isOpen) this.sendRaw({ type: "unsubscribe", topic });
      }
    };
  }

  private sendRaw(msg: object): void {
    this.ws?.send(JSON.stringify(msg));
  }
}

export const ws = new WsClient();

/**
 * Subscribe to several topics with one callback; returns a single unsubscribe.
 * Handy as the return value of an $effect.
 */
export function subscribeAll(topics: string[], listener: Listener): () => void {
  const offs = topics.map((t) => ws.subscribe(t, listener));
  return () => {
    for (const off of offs) off();
  };
}

/** Run `fn` after the connection comes back from a drop. Returns an unsubscribe. */
export function onReconnect(fn: () => void): () => void {
  ws.addEventListener("reconnect", fn);
  return () => ws.removeEventListener("reconnect", fn);
}
