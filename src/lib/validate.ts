import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import type { ZodType } from "zod";
import { errorBody } from "./error-codes";

/**
 * zValidator with the app's error shape: a failed parse answers 400 with code
 * "invalid_input" and the details ("<path>: <message>; ...") as a parameter.
 */
export function validate<T extends ZodType, Target extends keyof ValidationTargets>(
  target: Target,
  schema: T,
) {
  return zValidator(target, schema, (result, c) => {
    if (!result.success) {
      const message = result.error.issues
        .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
        .join("; ");
      return c.json(errorBody("invalid_input", { details: message }), 400);
    }
  });
}
