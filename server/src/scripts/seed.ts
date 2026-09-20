import { createApiContainer } from '../container.js';
import { logger } from '../lib/logger.js';

/**
 * CLI equivalent of POST /api/dev/seed. Same service, so the two cannot drift.
 * Both bypass the rate limiter, which sits in the HTTP middleware chain.
 */
const container = await createApiContainer();

try {
  const result = await container.seedService.seed();
  logger.info(result, 'seeded');
} catch (error) {
  logger.error({ err: error }, 'seeding failed');
  process.exitCode = 1;
} finally {
  await container.shutdown();
}
