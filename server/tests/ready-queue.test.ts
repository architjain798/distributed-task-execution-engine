import { describe, expect, it } from 'vitest';
import { queueScore } from '../src/engine/ready-queue.js';

/**
 * The score encoding is the only arithmetic in the system that is not obvious,
 * and the entire intra-client ordering guarantee rests on it. ZPOPMAX takes the
 * highest score, so "first to run" means "highest score" throughout.
 */
describe('queueScore', () => {
  const T0 = Date.parse('2026-01-01T12:00:00Z');

  it('ranks higher priority above lower, whatever the age', () => {
    const urgentButNew = queueScore(5, T0 + 3_600_000);
    const lowButAncient = queueScore(1, T0);

    expect(urgentButNew).toBeGreaterThan(lowButAncient);
  });

  it('keeps every priority level separated', () => {
    const scores = [1, 2, 3, 4, 5].map((priority) => queueScore(priority, T0));
    const sorted = [...scores].sort((a, b) => a - b);

    expect(scores).toEqual(sorted);
  });

  it('is FIFO within one priority', () => {
    const older = queueScore(3, T0);
    const newer = queueScore(3, T0 + 1_000);

    expect(older).toBeGreaterThan(newer);
  });

  it('separates timestamps one millisecond apart without losing precision', () => {
    // The multiplier has to leave room for millisecond resolution, or two tasks
    // submitted in the same second would order arbitrarily.
    expect(queueScore(3, T0)).not.toBe(queueScore(3, T0 + 1));
  });

  it('never lets a priority band overlap the one below it', () => {
    // The worst case: the newest possible task at priority 2 against the oldest
    // conceivable task at priority 1.
    const newestAtP2 = queueScore(2, Date.parse('2100-01-01T00:00:00Z'));
    const oldestAtP1 = queueScore(1, 0);

    expect(newestAtP2).toBeGreaterThan(oldestAtP1);
  });
});
