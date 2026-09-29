import { ERRORS, type ErrorCode, type ErrorParams, errorMessage } from "./error-codes";

/**
 * An error for the client: HTTP status, a stable code the frontend
 * translates, and the English message as a fallback (see error-codes.ts).
 */
export class AppError extends Error {
  override readonly name = "AppError";
  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
    message: string,
    readonly params?: Record<string, string | number>,
  ) {
    super(message);
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

/** Create the AppError for `code`; codes with parameters require them. */
export function fail<C extends ErrorCode>(
  code: C,
  ...params: [ErrorParams<C>] extends [never] ? [] : [ErrorParams<C>]
): AppError {
  const p = params[0] as Record<string, string | number> | undefined;
  return new AppError(ERRORS[code].status, code, errorMessage(code, p), p);
}

/** Unwrap a row that must exist (e.g. re-reading what was just written). */
export function must<T>(value: T | null | undefined, what = "Record"): T {
  if (value === null || value === undefined) {
    console.error(`[must] ${what} vanished`);
    throw fail("internal_error");
  }
  return value;
}
