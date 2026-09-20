/**
 * One hierarchy, two audiences.
 *
 * HTTP errors carry a status code that `error.middleware.ts` uses — nothing
 * else in the codebase writes a status code.
 *
 * `FatalError` and `RetryableError` additionally tell the execution engine
 * whether a failed task is worth attempting again. That distinction is what
 * separates the `failed` and `dead_letter` states.
 */
export class AppError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 400, 'VALIDATION_ERROR', details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Missing or invalid API key') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super(`${resource} ${id} was not found`, 404, 'NOT_FOUND');
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, 'CONFLICT');
  }
}

export class RateLimitError extends AppError {
  constructor(
    message: string,
    readonly retryAfterSeconds: number,
  ) {
    super(message, 429, 'RATE_LIMITED');
  }
}

/**
 * The task can never succeed: unknown type, payload that fails its schema.
 * Retrying would reproduce the same error, so the task goes straight to `failed`.
 */
export class FatalError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 400, 'FATAL_TASK_ERROR', details);
  }
}

/**
 * The work was legitimate but did not complete. Retried up to `max_attempts`,
 * then dead-lettered.
 */
export class RetryableError extends AppError {
  constructor(message: string) {
    super(message, 500, 'RETRYABLE_TASK_ERROR');
  }
}

export function isRetryable(error: unknown): boolean {
  return !(error instanceof FatalError);
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
