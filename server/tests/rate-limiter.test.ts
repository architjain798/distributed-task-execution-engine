import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RateLimiter } from '../src/lib/rate-limiter.js';
import type { RedisClient } from '../src/lib/redis.js';
import { FakeRedis } from './support/fake-redis.js';

const WINDOW_MS = 60_000;
const LIMIT = 10;

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));
    limiter = new RateLimiter(new FakeRedis() as unknown as RedisClient, LIMIT, WINDOW_MS);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function submit(times: number, clientId = 'client-a') {
    const results = [];
    for (let n = 0; n < times; n += 1) results.push(await limiter.check(clientId));
    return results;
  }

  it('allows exactly the limit and rejects the next one', async () => {
    const allowed = await submit(LIMIT);
    expect(allowed.every((result) => result.allowed)).toBe(true);

    const rejected = await limiter.check('client-a');
    expect(rejected.allowed).toBe(false);
    expect(rejected.remaining).toBe(0);
  });

  it('counts down the remaining allowance', async () => {
    const results = await submit(3);
    expect(results.map((result) => result.remaining)).toEqual([9, 8, 7]);
  });

  /**
   * The reason for a sliding window rather than a fixed one. A fixed window
   * would allow 20 submissions across this boundary; the log allows 10.
   */
  it('does not allow a burst across a window boundary', async () => {
    await submit(LIMIT);
    vi.advanceTimersByTime(WINDOW_MS - 1_000);

    // Still inside the window of the earlier ten.
    expect((await limiter.check('client-a')).allowed).toBe(false);
  });

  it('admits again once the oldest entries age out', async () => {
    await submit(LIMIT);
    vi.advanceTimersByTime(WINDOW_MS + 1);

    expect((await limiter.check('client-a')).allowed).toBe(true);
  });

  it('meters each client separately', async () => {
    await submit(LIMIT, 'client-a');

    expect((await limiter.check('client-a')).allowed).toBe(false);
    expect((await limiter.check('client-b')).allowed).toBe(true);
  });

  it('reports when the caller may retry', async () => {
    await submit(LIMIT);
    vi.advanceTimersByTime(20_000);

    const rejected = await limiter.check('client-a');
    expect(rejected.retryAfterSeconds).toBe(40);
  });
});
