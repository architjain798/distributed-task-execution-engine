import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { RateLimiter } from '../lib/rate-limiter.js';
import { RateLimitError } from '../utils/errors.js';
import { requireClient } from './auth.middleware.js';

/**
 * Per-client submission limit. Applied only to task creation — listing and
 * cancelling are cheap and limiting them would make the dashboard unusable.
 */
export function rateLimitMiddleware(limiter: RateLimiter): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const client = requireClient(req);
    const result = await limiter.check(client.id);

    res.setHeader('X-RateLimit-Limit', result.limit);
    res.setHeader('X-RateLimit-Remaining', result.remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(result.resetAtMs / 1000));

    if (!result.allowed) {
      res.setHeader('Retry-After', result.retryAfterSeconds);
      throw new RateLimitError(
        `Rate limit of ${result.limit} submissions per minute exceeded`,
        result.retryAfterSeconds,
      );
    }

    next();
  };
}
