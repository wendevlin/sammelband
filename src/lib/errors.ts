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
