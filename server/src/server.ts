import { createApp } from './app.js';
import { env } from './config/env.js';
import { createApiContainer } from './container.js';
import { logger } from './lib/logger.js';

const container = await createApiContainer();
const server = createApp(container).listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'api listening');
});

// Node closes idle requests after five minutes by default, which would cut every
// SSE stream. These connections are meant to stay open.
server.requestTimeout = 0;
server.headersTimeout = 0;
server.keepAliveTimeout = 0;

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    logger.info({ signal }, 'shutting down api');
    server.close(() => {
      void container.shutdown().then(() => process.exit(0));
    });
  });
}
