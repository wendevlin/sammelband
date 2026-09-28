import { Hono } from "hono";
import { upgradeWebSocket } from "hono/bun";
import type { WSContext } from "hono/ws";
import { type ChangeEvent, subscribe } from "../lib/events";
import { type AuthEnv, requireAuth } from "../middleware/auth.middleware";

/**
 * Subscribe to per-resource change events of the user's own tenant.
 *
 * Wire protocol:
 *   Client → server:
 *     { type: "subscribe", topic: "album:abc" }
 *     { type: "unsubscribe", topic: "album:abc" }
 *     { type: "ping" }
 *   Server → client:
 *     { type: "ready" }                               — sent on connect
 *     { type: "subscribed", topic }                   — ack
 *     { type: "unsubscribed", topic }                 — ack
 *     { type: "event", topic, kind, id?, data? }      — change push
 *     { type: "pong" }
 *     { type: "error", message }
 */

type ClientMessage =
  | { type: "subscribe"; topic: string }
  | { type: "unsubscribe"; topic: string }
  | { type: "ping" };

// Keep this list narrow so typos surface as errors.
const TOPIC_PATTERNS: RegExp[] = [
  /^folder-tree$/,
  /^album-list$/,
  /^storage-stats$/,
  /^folder:[A-Za-z0-9_-]{1,64}$/,
  /^album:[A-Za-z0-9_-]{1,64}$/,
  /^photo-pool:[A-Za-z0-9_-]{1,64}$/,
];

function isAllowedTopic(topic: string): boolean {
  return TOPIC_PATTERNS.some((p) => p.test(topic));
}

function parse(data: unknown): ClientMessage | null {
  if (typeof data !== "string") return null;
  try {
    const m = JSON.parse(data) as Partial<ClientMessage>;
    if (m.type === "ping") return { type: "ping" };
    if ((m.type === "subscribe" || m.type === "unsubscribe") && typeof m.topic === "string") {
      return { type: m.type, topic: m.topic };
    }
  } catch {
    /* fall through */
  }
  return null;
}

export const wsRoutes = new Hono<AuthEnv>().get(
  "/ws",
  requireAuth,
  upgradeWebSocket((c) => {
    const { tenantId } = c.get("user");
    // Per-connection subscriptions. Key = topic.
    const unsubs = new Map<string, () => void>();
    const send = (ws: WSContext, msg: object) => ws.send(JSON.stringify(msg));

    return {
      onOpen(_evt, ws) {
        send(ws, { type: "ready" });
      },
      onMessage(evt, ws) {
        const m = parse(evt.data);
        if (!m) {
          send(ws, { type: "error", message: "invalid message" });
          return;
        }
        if (m.type === "ping") {
          send(ws, { type: "pong" });
          return;
        }
        if (m.type === "subscribe") {
          if (!isAllowedTopic(m.topic)) {
            send(ws, { type: "error", message: `unknown topic: ${m.topic}` });
            return;
          }
          if (!unsubs.has(m.topic)) {
            unsubs.set(
              m.topic,
              subscribe(tenantId, m.topic, (event: ChangeEvent) =>
                send(ws, {
                  type: "event",
                  topic: event.topic,
                  kind: event.kind,
                  id: event.id,
                  data: event.data,
                }),
              ),
            );
          }
          send(ws, { type: "subscribed", topic: m.topic });
          return;
        }
        unsubs.get(m.topic)?.();
        unsubs.delete(m.topic);
        send(ws, { type: "unsubscribed", topic: m.topic });
      },
      onClose() {
        for (const unsub of unsubs.values()) unsub();
        unsubs.clear();
      },
    };
  }),
);
