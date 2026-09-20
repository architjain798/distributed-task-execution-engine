import type { Request, Response } from 'express';
import type { Database } from '../lib/mysql.js';
import type { RedisClient } from '../lib/redis.js';

/**
 * Reports on the dependencies rather than just answering 200, so
 * `docker compose up` failures point at the thing that is actually down.
 */
export function createHealthController(db: Database, redis: RedisClient) {
  return {
    check: async (_req: Request, res: Response): Promise<void> => {
      const [mysql, cache] = await Promise.all([
        ping(() => db.query('SELECT 1')),
        ping(() => redis.ping()),
      ]);

      const healthy = mysql && cache;
      res.status(healthy ? 200 : 503).json({
        status: healthy ? 'ok' : 'degraded',
        mysql: mysql ? 'up' : 'down',
        redis: cache ? 'up' : 'down',
      });
    },
  };
}

async function ping(probe: () => Promise<unknown>): Promise<boolean> {
  try {
    await probe();
    return true;
  } catch {
    return false;
  }
}
