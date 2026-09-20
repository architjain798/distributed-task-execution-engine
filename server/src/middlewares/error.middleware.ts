import type { NextFunction, Request, Response } from 'express';
import { logger } from '../lib/logger.js';
import { AppError } from '../utils/errors.js';

/**
 * The only place in the codebase that writes an HTTP status code.
 *
 * Express 5 forwards rejected promises here on its own, so controllers are plain
 * async functions that throw — there is no try/catch and no asyncHandler wrapper
 * anywhere in the routes.
 */
export function errorMiddleware(
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof AppError) {
    // Expected failures are the API working correctly, so they log at debug.
    logger.debug(
      { err: error, requestId: req.requestId, path: req.path },
      'request rejected',
    );

    res.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
      requestId: req.requestId,
    });
    return;
  }

  logger.error({ err: error, requestId: req.requestId, path: req.path }, 'unhandled error');

  // Unexpected failures never leak their message: it could contain a query,
  // a connection string or a stack frame.
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    requestId: req.requestId,
  });
}
