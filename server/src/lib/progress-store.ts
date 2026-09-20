import type { RedisClient } from './redis.js';
import { redisKeys } from './redis-keys.js';
import { PROGRESS_TTL_SECONDS } from '../config/constants.js';

/**
 * Live progress for running tasks.
 *
 * This deliberately does not live in MySQL: a 30 second task emits progress
 * around 30 times, and writing each one would put a high-churn column in the
 * table analytics queries scan. Keeping it in Redis also means the dashboard
 * snapshot can report accurate progress after a browser refresh, instead of
 * showing every running task at 0% until its next tick.
 *
 * It is cosmetic state. Losing it costs a stale progress bar, never a task.
 */
export class ProgressStore {
  constructor(private readonly redis: RedisClient) {}

  async set(taskId: string, percent: number): Promise<void> {
    await this.redis.set(redisKeys.progress(taskId), String(percent), 'EX', PROGRESS_TTL_SECONDS);
  }

  async get(taskId: string): Promise<number | null> {
    const value = await this.redis.get(redisKeys.progress(taskId));
    return value === null ? null : Number(value);
  }

  async getMany(taskIds: string[]): Promise<Map<string, number>> {
    if (taskIds.length === 0) return new Map();

    const values = await this.redis.mget(taskIds.map(redisKeys.progress));
    const progress = new Map<string, number>();

    taskIds.forEach((taskId, index) => {
      const value = values[index];
      if (value !== null && value !== undefined) progress.set(taskId, Number(value));
    });

    return progress;
  }

  async clear(taskId: string): Promise<void> {
    await this.redis.del(redisKeys.progress(taskId));
  }
}
