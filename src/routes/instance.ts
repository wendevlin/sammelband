import { Hono } from "hono";
import { z } from "zod";
import { validate } from "../lib/validate";
import { type AuthEnv, requireSuperadmin } from "../middleware/auth.middleware";
import * as tenantService from "../services/tenant.service";

const name = z.string().trim().min(1).max(100);
const quotaBytes = z.number().int().positive().nullable();

/** Superadmin: the Sammelbände of this instance. Metadata only, never content. */
export const instanceRoutes = new Hono<AuthEnv>()
  .use("*", requireSuperadmin)
  .get("/", async (c) =>
    c.json({
      ...(await tenantService.instanceStats()),
      tenants: await tenantService.listTenants(c.get("user").tenantId),
    }),
  )
  .post(
    "/tenants",
    validate("json", z.object({ name, quotaBytes: quotaBytes.optional() })),
    async (c) => {
      const body = c.req.valid("json");
      const created = await tenantService.createTenant({
        name: body.name,
        quotaBytes: body.quotaBytes ?? null,
      });
      return c.json(created, 201);
    },
  )
  .patch(
    "/tenants/:id",
    validate(
      "json",
      z.object({
        name: name.optional(),
        quotaBytes: quotaBytes.optional(),
        suspended: z.boolean().optional(),
      }),
    ),
    async (c) =>
      c.json(
        await tenantService.updateTenant(
          c.get("user").tenantId,
          c.req.param("id"),
          c.req.valid("json"),
        ),
      ),
  )
  .post("/tenants/:id/invite", async (c) =>
    c.json(await tenantService.renewAdminInvite(c.req.param("id")), 201),
  )
  .delete("/tenants/:id", validate("json", z.object({ confirmName: z.string() })), async (c) => {
    await tenantService.deleteTenant(
      c.get("user").tenantId,
      c.req.param("id"),
      c.req.valid("json").confirmName,
    );
    return c.json({ ok: true });
  });
