import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { config } from "./config";
import { db, dbType } from "./db/client";

export const auth = betterAuth({
  // Shares the app's Kysely instance (and so its connection/pool).
  database: { db, type: dbType },
  baseURL: config.BASE_URL,
  secret: config.SECRET_KEY,
  trustedOrigins: config.TRUSTED_ORIGINS,

  // Email + password only. Accounts are created by an admin, through an invite
  // link or by the first-run setup; passwords are reset by an admin (no mail).
  emailAndPassword: { enabled: true },

  user: {
    // None of these are settable via sign-up; the tenant and user services manage them.
    additionalFields: {
      /** Role within the user's tenant. */
      role: { type: "string", defaultValue: "user", required: true, input: false },
      /** The tenant ("Sammelband") the user belongs to. */
      tenantId: { type: "string", required: false, input: false },
      /** The instance owner: manages tenants, sees none of their content. */
      superadmin: { type: "boolean", defaultValue: false, required: false, input: false },
      /** UI language ("en", "de"); null follows the browser. */
      locale: { type: "string", required: false, input: false },
    },
  },

  databaseHooks: {
    session: {
      create: {
        // Users of a suspended Sammelband can't sign in.
        before: async (session) => {
          const row = await db
            .selectFrom("user")
            .innerJoin("tenants", "tenants.id", "user.tenantId")
            .select("tenants.suspended_at")
            .where("user.id", "=", session.userId)
            .executeTakeFirst();
          if (row?.suspended_at) {
            throw new APIError("FORBIDDEN", {
              message: "This Sammelband is suspended",
              code: "TENANT_SUSPENDED",
            });
          }
        },
      },
    },
  },
});

export type Auth = typeof auth;
