import { createWorkerContainer } from './container.js';
import { logger } from './lib/logger.js';

const container = await createWorkerContainer();
await container.start();

logger.info('worker running');

/**
 * On SIGTERM the in-flight tasks are abandoned rather than drained: their leases
 * expire and the reaper requeues them. A production system would stop claiming,
 * let the current tasks finish and release leases deliberately — noted in the
 * README rather than pretended away.
 */
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    logger.info({ signal }, 'shutting down worker');
    void container.shutdown().then(() => process.exit(0));
  });
}
