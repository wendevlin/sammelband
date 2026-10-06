import { Hono } from "hono";
import { z } from "zod";
import { fail } from "../lib/errors";
import { currentTenantId } from "../lib/tenant-context";
import { validate } from "../lib/validate";
import { type AuthEnv, requireAuth } from "../middleware/auth.middleware";
import { uploadRateLimit } from "../middleware/rate-limit.middleware";
import * as sourceService from "../services/source.service";
import {
  type LoginFlow,
  type NextcloudConfig,
  pollLogin,
  startLogin,
  verifyAccount,
} from "../sources/nextcloud";

const THUMB_SIZES = [128, 256, 512] as const;

// Nextcloud login flows waiting for the user to grant access, by flow id. A
// flow expires after 20 minutes in Nextcloud too.
const FLOW_TTL_MS = 20 * 60 * 1000;
type PendingFlow = {
  owner: string;
  flow: LoginFlow;
  config: NextcloudConfig;
  name: string | null;
  expires: number;
};
const flows = new Map<string, PendingFlow>();
const owner = (userId: string) => `${currentTenantId()}/${userId}`;

const server = z.object({
  url: z.string().max(2000).optional(),
  name: z.string().max(100).nullable().optional(),
});

/**
 * Connecting a Nextcloud account, on the admins' default server or another
 * one: Login Flow v2, or an app password typed in.
 */
const nextcloudRoutes = new Hono<AuthEnv>()
  .post("/connect", validate("json", server), async (c) => {
    const { url, name } = c.req.valid("json");
    const config = await sourceService.configFor<NextcloudConfig>("nextcloud", { url });
    const flow = await startLogin(config);
    const id = Bun.randomUUIDv7();
    const now = Date.now();
    for (const [key, f] of flows) if (f.expires < now) flows.delete(key);
    flows.set(id, {
      owner: owner(c.get("user").id),
      flow,
      config,
      name: name ?? null,
      expires: now + FLOW_TTL_MS,
    });
    return c.json({ login: flow.login, flow: id });
  })
  .post("/connect/poll", validate("json", z.object({ flow: z.string() })), async (c) => {
    const id = c.req.valid("json").flow;
    const pending = flows.get(id);
    if (!pending || pending.owner !== owner(c.get("user").id) || pending.expires < Date.now()) {
      flows.delete(id);
      throw fail("source_connect_expired");
    }
    const credentials = await pollLogin(pending.config, pending.flow);
    if (!credentials) return c.json({ connected: false });
    flows.delete(id);
    const account = await sourceService.addAccount(c.get("user").id, "nextcloud", {
      name: pending.name,
      label: credentials.loginName,
      config: pending.config,
      credentials,
    });
    return c.json({ connected: true, account });
  })
  .post(
    "/accounts",
    validate(
      "json",
      server.extend({
        loginName: z.string().min(1).max(200),
        appPassword: z.string().min(1).max(500),
      }),
    ),
    async (c) => {
      const { url, name, loginName, appPassword } = c.req.valid("json");
      const config = await sourceService.configFor<NextcloudConfig>("nextcloud", { url });
      const credentials = await verifyAccount(config, loginName.trim(), appPassword.trim());
      const account = await sourceService.addAccount(c.get("user").id, "nextcloud", {
        name,
        label: credentials.loginName,
        config,
        credentials,
      });
      return c.json(account, 201);
    },
  );

/** Mounted under /api/sources. Accounts are the user's own; ids of others' are "not found". */
export const sourceRoutes = new Hono<AuthEnv>()
  .use("*", requireAuth)
  .route("/nextcloud", nextcloudRoutes)
  .get("/", async (c) => c.json(await sourceService.listForUser(c.get("user").id)))
  .patch(
    "/accounts/:accountId",
    validate("json", z.object({ name: z.string().max(100).nullable() })),
    async (c) =>
      c.json(
        await sourceService.renameAccount(
          c.get("user").id,
          c.req.param("accountId"),
          c.req.valid("json").name,
        ),
      ),
  )
  .delete("/accounts/:accountId", async (c) => {
    await sourceService.removeAccount(c.get("user").id, c.req.param("accountId"));
    return c.json({ ok: true });
  })
  .get(
    "/accounts/:accountId/browse",
    validate("query", z.object({ location: z.string().max(2000).optional() })),
    async (c) =>
      c.json(
        await sourceService.browse(
          c.get("user").id,
          c.req.param("accountId"),
          c.req.valid("query").location ?? null,
        ),
      ),
  )
  .get(
    "/accounts/:accountId/thumbnail",
    validate(
      "query",
      z.object({
        id: z.string().min(1).max(200),
        size: z.coerce
          .number()
          .refine((n) => (THUMB_SIZES as readonly number[]).includes(n))
          .default(256),
      }),
    ),
    async (c) => {
      const { id, size } = c.req.valid("query");
      const file = await sourceService.thumbnail(
        c.get("user").id,
        c.req.param("accountId"),
        id,
        size,
      );
      return new Response(file.bytes, {
        headers: {
          "Content-Type": file.type.startsWith("image/") ? file.type : "application/octet-stream",
          "Cache-Control": "private, max-age=3600",
          "X-Content-Type-Options": "nosniff",
        },
      });
    },
  );

/** Mounted under /api/sections: photos picked in a source account go into a section. */
export const sectionImportRoutes = new Hono<AuthEnv>().use("*", requireAuth).post(
  "/:sectionId/import",
  uploadRateLimit,
  validate(
    "json",
    z.object({
      account: z.string(),
      refs: z.array(z.string().min(1).max(2000)).min(1).max(20),
    }),
  ),
  async (c) => {
    const { account, refs } = c.req.valid("json");
    const uploaded = await sourceService.importPhotos(
      c.get("user").id,
      account,
      c.req.param("sectionId"),
      refs,
    );
    return c.json({ uploaded }, 201);
  },
);
