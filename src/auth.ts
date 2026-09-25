import { betterAuth } from "better-auth";
import { config } from "./config";
import { db } from "./db/client";

export const auth = betterAuth({
  database: db,
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
