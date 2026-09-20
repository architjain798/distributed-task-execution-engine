import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ClientRepository } from '../repositories/client.repository.js';
import { UnauthorizedError } from '../utils/errors.js';

/**
 * Resolves the X-API-Key header to a client.
 *
 * The key scopes *writes* — ownership, rate limiting and fair scheduling all key
 * off it. Reads are deliberately not scoped: the brief describes a dashboard
 * showing all tasks and worker utilisation, which is an operator view rather
 * than a per-tenant one. That assumption is called out in the README.
 */
export function authMiddleware(clients: ClientRepository): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const apiKey = readApiKey(req);
    if (!apiKey) throw new UnauthorizedError('Missing X-API-Key header');

    const client = await clients.findByApiKey(apiKey);
    if (client === null) throw new UnauthorizedError('Unknown API key');

    req.client = client;
    next();
  };
}

/**
 * The header is the real interface. The query parameter exists because the
 * browser's EventSource API cannot set headers, and the SSE endpoint still needs
 * to identify a caller — a documented concession, not a second auth scheme.
 */
function readApiKey(req: Request): string | undefined {
  const header = req.header('x-api-key');
  if (header) return header;

  const fromQuery = req.query.apiKey;
  return typeof fromQuery === 'string' ? fromQuery : undefined;
}

/** Narrows `req.client` for controllers, which only run behind authMiddleware. */
export function requireClient(req: Request) {
  if (!req.client) throw new UnauthorizedError();
  return req.client;
}
