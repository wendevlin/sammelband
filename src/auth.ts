import { betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins";
import { config } from "./config";
import { db } from "./db/client";
import { sendMail } from "./mailer";

export const auth = betterAuth({
  database: db,
  baseURL: config.BASE_URL,
  secret: config.SECRET_KEY,
  trustedOrigins: config.TRUSTED_ORIGINS,

  emailAndPassword: {
    enabled: true,
    sendResetPassword: async ({ user, url }) => {
      await sendMail({
        to: user.email,
        subject: "Reset your Sammelband password",
        text: `Click to reset your password: ${url}`,
        html: `<p>Click <a href="${url}">here</a> to reset your password.</p>`,
      });
    },
  },

  user: {
    additionalFields: {
      role: {
        type: "string",
        defaultValue: "user",
        required: true,
        input: false, // not settable via signup; managed by admin endpoints
      },
    },
  },

  plugins: [
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        await sendMail({
          to: email,
          subject: "Your Sammelband login link",
          text: `Click to log in: ${url}`,
          html: `<p>Click <a href="${url}">here</a> to log in.</p>`,
        });
      },
    }),
  ],
});

export type Auth = typeof auth;
