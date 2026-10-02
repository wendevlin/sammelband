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

// Nextcloud login flows waiting for the user to grant access, per user. A flow
// expires after 20 minutes in Nextcloud too.
const FLOW_TTL_MS = 20 * 60 * 1000;
const flows = new Map<string, { flow: LoginFlow; expires: number }>();
const flowKey = (userId: string) => `${currentTenantId()}/${userId}`;

/** Connecting a Nextcloud account: Login Flow v2, or an app password typed in. */
const nextcloudRoutes = new Hono<AuthEnv>()
  .post("/connect", async (c) => {
    const config = await sourceService.configFor<NextcloudConfig>("nextcloud");
    const flow = await startLogin(config);
    flows.set(flowKey(c.get("user").id), { flow, expires: Date.now() + FLOW_TTL_MS });
    return c.json({ login: flow.login });
  })
  .post("/connect/poll", async (c) => {
    const key = flowKey(c.get("user").id);
    const pending = flows.get(key);
    if (!pending || pending.expires < Date.now()) {
      flows.delete(key);
      throw fail("source_connect_expired");
    }
    const config = await sourceService.configFor<NextcloudConfig>("nextcloud");
    const credentials = await pollLogin(config, pending.flow);
    if (!credentials) return c.json({ connected: false });
    flows.delete(key);
    const source = await sourceService.saveAccount(
      c.get("user").id,
      "nextcloud",
      credentials.loginName,
      credentials,
    );
    return c.json({ connected: true, source });
  })
  .put(
    "/account",
    validate(
      "json",
      z.object({ loginName: z.string().min(1).max(200), appPassword: z.string().min(1).max(500) }),
    ),
    async (c) => {
      const { loginName, appPassword } = c.req.valid("json");
      const config = await sourceService.configFor<NextcloudConfig>("nextcloud");
      const credentials = await verifyAccount(config, loginName.trim(), appPassword.trim());
      return c.json(
        await sourceService.saveAccount(
          c.get("user").id,
          "nextcloud",
          credentials.loginName,
          credentials,
        ),
      );
    },
  );

/** Mounted under /api/sources. */
export const sourceRoutes = new Hono<AuthEnv>()
  .use("*", requireAuth)
  .route("/nextcloud", nextcloudRoutes)
  .get("/", async (c) => c.json(await sourceService.listForUser(c.get("user").id)))
  .get(
    "/:id/browse",
    validate("query", z.object({ location: z.string().max(2000).optional() })),
    async (c) =>
      c.json(
        await sourceService.browse(
          c.get("user").id,
          c.req.param("id"),
          c.req.valid("query").location ?? null,
        ),
      ),
  )
  .get(
    "/:id/thumbnail",
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
      const file = await sourceService.thumbnail(c.get("user").id, c.req.param("id"), id, size);
      return new Response(file.bytes, {
        headers: {
          "Content-Type": file.type.startsWith("image/") ? file.type : "application/octet-stream",
          "Cache-Control": "private, max-age=3600",
          "X-Content-Type-Options": "nosniff",
        },
      });
    },
  )
  .delete("/:id/account", async (c) => {
    await sourceService.removeAccount(c.get("user").id, c.req.param("id"));
    return c.json({ ok: true });
  });

/** Mounted under /api/sections: photos picked in a source go into a section. */
export const sectionImportRoutes = new Hono<AuthEnv>()
  .use("*", requireAuth)
  .post(
    "/:sectionId/import",
    uploadRateLimit,
    validate(
      "json",
      z.object({ source: z.string(), refs: z.array(z.string().min(1).max(2000)).min(1).max(20) }),
    ),
    async (c) => {
      const { source, refs } = c.req.valid("json");
      const uploaded = await sourceService.importPhotos(
        c.get("user").id,
        source,
        c.req.param("sectionId"),
        refs,
      );
      return c.json({ uploaded }, 201);
    },
  );
