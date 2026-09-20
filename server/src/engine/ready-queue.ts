import type { RedisClient } from '../lib/redis.js';
import { redisKeys } from '../lib/redis-keys.js';
import { PRIORITY_SCORE_MULTIPLIER } from '../config/constants.js';

/**
 * The ready queue: one Redis sorted set per client, plus a set naming the
 * clients whose queue is non-empty.
 *
 * Fairness lives in FairScheduler, which chooses the client. This class only
 * knows how to order work *within* one client.
 */

interface ReadyQueueCommands {
  popReadyTask(queueKey: string, activeKey: string, clientId: string): Promise<string | null>;
  removeReadyTask(
    queueKey: string,
    activeKey: string,
    taskId: string,
    clientId: string,
  ): Promise<number>;
}

type QueueRedis = RedisClient & ReadyQueueCommands;

/**
 * Packs two sort keys into one score. The multiplier exceeds any plausible
 * millisecond timestamp, so priority always dominates; subtracting the
 * timestamp makes older tasks rank higher within the same priority. A single
 * ZPOPMAX then yields "highest priority, oldest first" atomically.
 */
export function queueScore(priority: number, enqueuedAtMs: number): number {
  return priority * PRIORITY_SCORE_MULTIPLIER - enqueuedAtMs;
}

export class ReadyQueue {
  private readonly redis: QueueRedis;

  constructor(redis: RedisClient) {
    this.redis = redis as QueueRedis;
    this.defineCommands();
  }

  /**
   * Popping and de-registering an emptied client must happen together: if they
   * were two round trips, an enqueue landing in between would be de-registered
   * and the task would sit invisible until the reconciler found it.
   */
  private defineCommands(): void {
    this.redis.defineCommand('popReadyTask', {
      numberOfKeys: 2,
      lua: `
        local popped = redis.call('ZPOPMAX', KEYS[1])
        if #popped == 0 then
          redis.call('SREM', KEYS[2], ARGV[1])
          return nil
        end
        if redis.call('ZCARD', KEYS[1]) == 0 then
          redis.call('SREM', KEYS[2], ARGV[1])
        end
        return popped[1]
      `,
    });

    this.redis.defineCommand('removeReadyTask', {
      numberOfKeys: 2,
      lua: `
        local removed = redis.call('ZREM', KEYS[1], ARGV[1])
        if redis.call('ZCARD', KEYS[1]) == 0 then
          redis.call('SREM', KEYS[2], ARGV[2])
        end
        return removed
      `,
    });
  }

  async enqueue(
    taskId: string,
    clientId: string,
    priority: number,
    enqueuedAtMs: number,
  ): Promise<void> {
    await this.redis
      .multi()
      .zadd(redisKeys.queue(clientId), queueScore(priority, enqueuedAtMs), taskId)
      .sadd(redisKeys.activeClients, clientId)
      .exec();
  }

  /** Highest priority, oldest first. Null when the client has nothing waiting. */
  async pop(clientId: string): Promise<string | null> {
    return this.redis.popReadyTask(
      redisKeys.queue(clientId),
      redisKeys.activeClients,
      clientId,
    );
  }

  /** Cancelling a queued task. Returns false if the dispatcher already took it. */
  async remove(taskId: string, clientId: string): Promise<boolean> {
    const removed = await this.redis.removeReadyTask(
      redisKeys.queue(clientId),
      redisKeys.activeClients,
      taskId,
      clientId,
    );
    return removed > 0;
  }

  async activeClients(): Promise<string[]> {
    return this.redis.smembers(redisKeys.activeClients);
  }

  async size(clientId: string): Promise<number> {
    return this.redis.zcard(redisKeys.queue(clientId));
  }

  /** Used by the reconciler to find tasks MySQL knows about and Redis does not. */
  async taskIds(clientId: string): Promise<string[]> {
    return this.redis.zrange(redisKeys.queue(clientId), '0', '-1');
  }
}
