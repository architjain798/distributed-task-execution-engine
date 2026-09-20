import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodType } from 'zod';
import { ValidationError } from '../utils/errors.js';

export interface ValidationTargets {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

type ValidatedPart = keyof ValidationTargets;

/**
 * Parses the request against zod schemas before a controller sees it.
 *
 * Results land on `req.validated` rather than back on `req.query` and
 * `req.params`, which Express 5 exposes as getters. It also keeps the raw
 * request untouched, so what a controller reads is unambiguously the validated
 * value.
 */
export function validate(targets: ValidationTargets): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    req.validated ??= {};

    for (const [part, schema] of Object.entries(targets) as Array<[ValidatedPart, ZodType]>) {
      const result = schema.safeParse(req[part]);

      if (!result.success) {
        throw new ValidationError(
          `Invalid request ${part}`,
          result.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        );
      }

      req.validated[part] = result.data;
    }

    next();
  };
}

/**
 * Typed accessor for what `validate` produced. The cast is safe because the
 * route that installed the schema is the route reading it back, and this is the
 * only place in the codebase that performs it.
 */
export function validated<T>(req: Request, part: ValidatedPart): T {
  return req.validated?.[part] as T;
}
