import { Elysia, t } from "elysia";
import * as onboardingService from "../services/onboarding.service";

export const onboardingRoutes = new Elysia({ prefix: "/api/onboarding" })
  .get("/status", () => onboardingService.getStatus())
  .post(
    "/claim",
    ({ body }) =>
      onboardingService.claim({
        code: body.code,
        email: body.email,
        password: body.password,
        name: body.name,
      }),
    {
      body: t.Object({
        code: t.String({ minLength: 1 }),
        email: t.String({ format: "email" }),
        password: t.String({ minLength: 8 }),
        name: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
      }),
    },
  );
