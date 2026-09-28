import { Hono } from "hono";
import { z } from "zod";
import { validate } from "../lib/validate";
import { authRateLimit } from "../middleware/rate-limit.middleware";
import * as onboardingService from "../services/onboarding.service";

export const onboardingRoutes = new Hono()
  .get("/status", (c) => c.json(onboardingService.getStatus()))
  .post(
    "/claim",
    // The setup code is short; guesses must not be free.
    authRateLimit,
    validate(
      "json",
      z.object({
        code: z.string().min(1),
        email: z.email(),
        password: z.string().min(8).max(128),
        name: z.string().min(1).max(200).optional(),
        sammelband: z.string().trim().min(1).max(100),
      }),
    ),
    async (c) => c.json(await onboardingService.claim(c.req.valid("json"))),
  );
