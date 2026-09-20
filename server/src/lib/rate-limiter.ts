import { randomUUID } from 'node:crypto';
import type { RedisClient } from './redis.js';
import { redisKeys } from './redis-keys.js';

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAtMs: number;
  retryAfterSeconds: number;
}

/**
 * Sliding window log, backed by a Redis sorted set of submission timestamps.
 *
 * A fixed window would be three lines shorter but permits twice the limit across
 * a boundary — ten submissions at 11:59:59 and ten more at 12:00:00. That is
 * precisely what someone probing a rate limiter tries first.
 *
 * A token bucket was the other candidate; it smooths bursts but introduces a
 * burst parameter that the requirement ("max 10 per minute") gives no basis to
 * choose. Exact counting matches the spec as written.
 */
export class RateLimiter {
  constructor(
    private readonly redis: RedisClient,
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  async check(clientId: string): Promise<RateLimitResult> {
    const key = redisKeys.rateLimit(clientId);
    const now = Date.now();
    const member = `${now}-${randomUUID()}`;

    // Evict, count, record and set the TTL as one atomic unit, so concurrent
    // submissions cannot both read a stale count.
    const results = await this.redis
      .multi()
      .zremrangebyscore(key, 0, now - this.windowMs)
      .zcard(key)
      .zadd(key, now, member)
      .pexpire(key, this.windowMs * 2)
      .exec();

    const countBeforeThis = Number(results?.[1]?.[1] ?? 0);

    if (countBeforeThis >= this.limit) {
      // Over the limit: take back the entry just added so a rejected request
      // does not extend the window it was rejected by.
      await this.redis.zrem(key, member);
      const resetAtMs = await this.oldestExpiry(key, now);

      return {
        allowed: false,
        limit: this.limit,
        remaining: 0,
        resetAtMs,
        retryAfterSeconds: Math.max(1, Math.ceil((resetAtMs - now) / 1000)),
      };
    }

    return {
      allowed: true,
      limit: this.limit,
      remaining: this.limit - countBeforeThis - 1,
      resetAtMs: now + this.windowMs,
      retryAfterSeconds: 0,
    };
  }

  /** The window frees a slot when its oldest entry ages out. */
  private async oldestExpiry(key: string, now: number): Promise<number> {
    const oldest = await this.redis.zrange(key, '0', '0', 'WITHSCORES');
    const score = oldest[1];
    return (score === undefined ? now : Number(score)) + this.windowMs;
  }
}
