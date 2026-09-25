import { Elysia, t } from "elysia";
import { auth } from "../auth";
import { type ChangeEvent, subscribe } from "../lib/events";

/**
 * Subscribe to per-resource change events.
 *
 * Wire protocol:
 *   Client → server:
 *     { type: "subscribe", topic: "album:abc" }
 *     { type: "unsubscribe", topic: "album:abc" }
 *     { type: "ping" }
 *   Server → client:
 *     { type: "ready" }                                       — sent on connect
 *     { type: "subscribed", topic }                           — ack
 *     { type: "unsubscribed", topic }                         — ack
 *     { type: "event", topic, kind, id?, data? }              — change push
 *     { type: "pong" }
 *     { type: "error", message }
 *
 * Phase 1: admin-only. We'll layer per-user permission filtering when
 * non-admin views land in Phase 2/3.
 */

type ClientMessage =
  | { type: "subscribe"; topic: string }
  | { type: "unsubscribe"; topic: string }
  | { type: "ping" };

// Topics allowed in Phase 1. Keep this list narrow so typos surface as errors.
const TOPIC_PATTERNS: RegExp[] = [
  /^folder-tree$/,
  /^album-list$/,
  /^storage-stats$/,
  /^folder:[A-Za-z0-9_-]{1,64}$/,
  /^album:[A-Za-z0-9_-]{1,64}$/,
  /^photo-pool:[A-Za-z0-9_-]{1,64}$/,
  /^share-links:(album|folder):[A-Za-z0-9_-]{1,64}$/,
  /^access:(album|folder):[A-Za-z0-9_-]{1,64}$/,
];

function isAllowedTopic(topic: string): boolean {
  return TOPIC_PATTERNS.some((p) => p.test(topic));
}

export const wsRoutes = new Elysia().ws("/ws", {
  // Authenticate on upgrade. Reject if no admin session.
  async beforeHandle({ request, status }) {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) return status(401, { error: "Unauthorized" });
    const role = (session.user as { role?: string }).role;
    if (role !== "admin") return status(403, { error: "Forbidden" });
  },

  body: t.Union([
    t.Object({ type: t.Literal("subscribe"), topic: t.String() }),
    t.Object({ type: t.Literal("unsubscribe"), topic: t.String() }),
    t.Object({ type: t.Literal("ping") }),
  ]),

  open(ws) {
    // Per-connection subscription unsubscribers. Key = topic.
    ws.data.store ??= {} as { unsubs?: Map<string, () => void> };
    (ws.data.store as { unsubs?: Map<string, () => void> }).unsubs = new Map();
    ws.send({ type: "ready" });
  },

  message(ws, msg) {
    const store = ws.data.store as { unsubs?: Map<string, () => void> };
    if (!store.unsubs) store.unsubs = new Map();
    const unsubs = store.unsubs;
    const m = msg as ClientMessage;

    if (m.type === "ping") {
      ws.send({ type: "pong" });
      return;
    }

    if (m.type === "subscribe") {
      if (!isAllowedTopic(m.topic)) {
        ws.send({ type: "error", message: `unknown topic: ${m.topic}` });
        return;
      }
      if (unsubs.has(m.topic)) {
        // already subscribed — idempotent ack
        ws.send({ type: "subscribed", topic: m.topic });
        return;
      }
      const unsub = subscribe(m.topic, (event: ChangeEvent) => {
        ws.send({
          type: "event",
          topic: event.topic,
          kind: event.kind,
          id: event.id,
          data: event.data,
        });
      });
      unsubs.set(m.topic, unsub);
      ws.send({ type: "subscribed", topic: m.topic });
      return;
    }

    if (m.type === "unsubscribe") {
      const unsub = unsubs.get(m.topic);
      if (unsub) {
        unsub();
        unsubs.delete(m.topic);
      }
      ws.send({ type: "unsubscribed", topic: m.topic });
      return;
    }
  },

  close(ws) {
    const store = ws.data.store as { unsubs?: Map<string, () => void> };
    for (const unsub of store.unsubs?.values() ?? []) unsub();
    store.unsubs?.clear();
  },
});
