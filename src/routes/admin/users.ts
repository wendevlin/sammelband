import { t } from "elysia";
import { auth } from "../../auth";
import { db } from "../../db/client";
import { AppError } from "../../lib/errors";
import { adminRouter } from "../../middleware/auth.middleware";

type PublicUser = {
  id: string;
  email: string;
  name: string;
  role: "admin" | "user";
  createdAt: number;
};

export const adminUsersRoutes = adminRouter()
  .get("/admin/users", () => {
    return db
      .query(`SELECT id, email, name, role, createdAt FROM user ORDER BY createdAt DESC`)
      .all() as PublicUser[];
  })
  .post(
    "/admin/users",
    async ({ body }) => {
      const existing = db.query("SELECT 1 FROM user WHERE email = ?").get(body.email);
      if (existing) throw new AppError(409, "A user with that email already exists");
      // Create through better-auth so the password is hashed and the
      // account/session tables are populated exactly like a normal signup.
      await auth.api.signUpEmail({
        body: { email: body.email, password: body.password, name: body.name },
      });
      // role is input:false on signup, so promote afterwards if requested.
      if (body.role === "admin") {
        db.run("UPDATE user SET role = 'admin' WHERE email = ?", [body.email]);
      }
      return db
        .query("SELECT id, email, name, role, createdAt FROM user WHERE email = ?")
        .get(body.email) as PublicUser;
    },
    {
      body: t.Object({
        email: t.String({ minLength: 3 }),
        name: t.String({ minLength: 1 }),
        password: t.String({ minLength: 8 }),
        role: t.Optional(t.Union([t.Literal("admin"), t.Literal("user")])),
      }),
    },
  )
  .get(
    "/admin/users/by-email",
    ({ query }) => {
      const u = db
        .query("SELECT id, email, name, role, createdAt FROM user WHERE email = ?")
        .get(query.email) as PublicUser | null;
      if (!u) throw new AppError(404, "User not found");
      return u;
    },
    { query: t.Object({ email: t.String() }) },
  )
  .patch(
    "/admin/users/:id",
    ({ params, body }) => {
      const u = db.query("SELECT 1 FROM user WHERE id = ?").get(params.id);
      if (!u) throw new AppError(404, "User not found");
      db.run("UPDATE user SET role = ? WHERE id = ?", [body.role, params.id]);
      return { ok: true };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ role: t.Union([t.Literal("admin"), t.Literal("user")]) }),
    },
  );
