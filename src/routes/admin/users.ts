import { Hono } from "hono";
import { z } from "zod";
import { validate } from "../../lib/validate";
import { type AuthEnv, requireAdmin } from "../../middleware/auth.middleware";
import * as userService from "../../services/user.service";

const role = z.enum(["admin", "user"]);
const password = z.string().min(8).max(128);

export const adminUserRoutes = new Hono<AuthEnv>()
  .use("*", requireAdmin)
  .get("/", async (c) => c.json(await userService.listUsers()))
  .post(
    "/",
    validate(
      "json",
      z.object({
        email: z.email(),
        name: z.string().min(1).max(200),
        password,
        role: role.optional(),
      }),
    ),
    async (c) => {
      const body = c.req.valid("json");
      const user = await userService.createUser({ ...body, role: body.role ?? "user" });
      return c.json(user, 201);
    },
  )
  .patch(
    "/:id",
    validate(
      "json",
      z.object({ name: z.string().min(1).max(200).optional(), role: role.optional() }),
    ),
    async (c) =>
      c.json(
        await userService.updateUser(c.get("user").id, c.req.param("id"), c.req.valid("json")),
      ),
  )
  .post("/:id/password", validate("json", z.object({ password })), async (c) => {
    await userService.setPassword(c.req.param("id"), c.req.valid("json").password);
    return c.json({ ok: true });
  })
  .delete("/:id", async (c) => {
    await userService.deleteUser(c.get("user").id, c.req.param("id"));
    return c.json({ ok: true });
  });
