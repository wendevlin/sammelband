import { betterAuth } from "better-auth";
import { config } from "./config";
import { db, dbType } from "./db/client";

export const auth = betterAuth({
  // Shares the app's Kysely instance (and so its connection/pool).
  database: { db, type: dbType },
  baseURL: config.BASE_URL,
  secret: config.SECRET_KEY,
  trustedOrigins: config.TRUSTED_ORIGINS,

  // Email + password only. Accounts are created by an admin or by the first-run
  // onboarding claim; passwords are reset by an admin (no mail involved).
  emailAndPassword: { enabled: true },

  user: {
    additionalFields: {
      role: {
        type: "string",
        defaultValue: "user",
        required: true,
        input: false, // not settable via sign-up; managed by admin endpoints
      },
    },
  },
});

export type Auth = typeof auth;
