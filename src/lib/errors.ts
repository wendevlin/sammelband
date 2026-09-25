export class AppError extends Error {
  override readonly name = "AppError";
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

/** Unwrap a row that must exist (e.g. re-reading what was just written). */
export function must<T>(value: T | null | undefined, what = "Record"): T {
  if (value === null || value === undefined) throw new AppError(500, `${what} vanished`);
  return value;
}
