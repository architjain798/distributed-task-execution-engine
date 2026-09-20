import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from './logger.js';

export type RedisClient = Redis;

export function createRedis(role: string): RedisClient {
  const client = new Redis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    lazyConnect: false,
    // Commands queue through a reconnect instead of failing, so a Redis restart
    // is a pause rather than an outage.
    maxRetriesPerRequest: null,
    retryStrategy: (times: number) => Math.min(times * 200, 3_000),
  });

  client.on('error', (error: Error) => {
    logger.error({ err: error, role }, 'redis connection error');
  });

  return client;
}

/**
 * A connection in subscriber mode cannot issue ordinary commands, so pub/sub
 * always needs its own client alongside the command client.
 */
export function createSubscriber(client: RedisClient, role: string): RedisClient {
  const subscriber = client.duplicate();

  subscriber.on('error', (error: Error) => {
    logger.error({ err: error, role }, 'redis subscriber error');
  });

  return subscriber;
}

export async function waitForRedis(client: RedisClient, attempts = 30): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await client.ping();
      return;
    } catch (error) {
      if (attempt === attempts) throw error;
      logger.warn({ attempt, attempts }, 'waiting for redis');
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
}
