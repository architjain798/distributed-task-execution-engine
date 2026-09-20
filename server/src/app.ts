import cors from 'cors';
import express, { type Express } from 'express';
import { pinoHttp } from 'pino-http';
import { logger } from './lib/logger.js';
import { errorMiddleware } from './middlewares/error.middleware.js';
import { notFoundMiddleware } from './middlewares/not-found.middleware.js';
import { requestIdMiddleware } from './middlewares/request-id.middleware.js';
import { apiRoutes } from './routes/index.js';
import type { ApiContainer } from './container.js';

/**
 * Builds the Express app without starting it, so tests can drive it directly.
 * `server.ts` is the only thing that calls listen().
 */
export function createApp(container: ApiContainer): Express {
  const app = express();

  app.disable('x-powered-by');

  app.use(requestIdMiddleware);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.requestId ?? 'unknown',
      // Health checks every few seconds and a never-ending SSE stream would
      // drown everything else.
      autoLogging: {
        ignore: (req) => req.url === '/api/health' || req.url?.startsWith('/api/events') === true,
      },
    }),
  );

  // The browser is served from a different origin in development; in the
  // container it comes through the same nginx, so this is permissive by design
  // for a demo and would be an allowlist in production.
  app.use(cors());
  app.use(express.json({ limit: '256kb' }));

  app.use('/api', apiRoutes(container));

  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

  return app;
}
