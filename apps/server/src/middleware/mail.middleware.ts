import { createMiddleware } from "hono/factory";
import { errorBody } from "../lib/error-codes";
import { mailEnabled } from "../lib/mail";

/**
 * For endpoints that send mail. Answers the same for every request while mail
 * is off, so it reveals nothing about accounts.
 */
export const requireMail = createMiddleware(async (c, next) => {
  if (!mailEnabled()) return c.json(errorBody("mail_disabled"), 404);
  await next();
});
