import { describe, expect, it } from 'vitest';
import { FairScheduler } from '../src/engine/fair-scheduler.js';

/**
 * The fairness guarantee, stated as tests. These are pure — no Redis, no MySQL —
 * which is the whole reason the deficit counters live in memory.
 */
describe('FairScheduler', () => {
  const ACME = 'client-acme';
  const GLOBEX = 'client-globex';
  const INITECH = 'client-initech';

  /** Simulates N dispatches, assuming every client always has work waiting. */
  function dispatch(scheduler: FairScheduler, clients: string[], times: number): string[] {
    const picked: string[] = [];
    for (let n = 0; n < times; n += 1) {
      const next = scheduler.nextClient(clients);
      if (next === null) break;
      picked.push(next);
    }
    return picked;
  }

  function countBy(picks: string[]): Record<string, number> {
    return picks.reduce<Record<string, number>>((counts, pick) => {
      counts[pick] = (counts[pick] ?? 0) + 1;
      return counts;
    }, {});
  }

  it('gives a flooding client no more than its share', () => {
    const scheduler = new FairScheduler();
    // Both clients have work; acme is assumed to have submitted hundreds of
    // priority-5 tasks and globex just one or two.
    const picks = dispatch(scheduler, [ACME, GLOBEX], 20);
    const counts = countBy(picks);

    expect(counts[ACME]).toBe(10);
    expect(counts[GLOBEX]).toBe(10);
  });

  it('starts a second client within one round of a flood', () => {
    const scheduler = new FairScheduler();

    // Acme alone in the queue, dispatching freely.
    dispatch(scheduler, [ACME], 50);

    // Globex submits its first task. It must not wait behind acme's backlog.
    const picks = dispatch(scheduler, [ACME, GLOBEX], 2);
    expect(picks).toContain(GLOBEX);
  });

  it('honours weights, so a 2x client gets twice the dispatch rate', () => {
    const scheduler = new FairScheduler();
    scheduler.setWeights(new Map([[INITECH, 2]]));

    const counts = countBy(dispatch(scheduler, [ACME, INITECH], 300));

    // Exactly 2:1 in the steady state; allow a little slack for where the
    // window happens to cut the rotation.
    expect(counts[INITECH] / (counts[ACME] as number)).toBeCloseTo(2, 1);
  });

  it('carries fractional weight forward instead of rounding it away', () => {
    const scheduler = new FairScheduler();
    scheduler.setWeights(new Map([[INITECH, 2.5]]));

    const counts = countBy(dispatch(scheduler, [ACME, INITECH], 700));

    expect(counts[INITECH] / (counts[ACME] as number)).toBeCloseTo(2.5, 1);
  });

  it('does not let an idle client bank credit while its queue is empty', () => {
    const scheduler = new FairScheduler();
    scheduler.setWeights(new Map([[INITECH, 2]]));

    // Initech goes away; its deficit is cleared when its queue drains.
    scheduler.nextClient([ACME, INITECH]);
    scheduler.reset(INITECH);
    expect(scheduler.deficitOf(INITECH)).toBe(0);

    // Acme runs alone for a while, then initech returns.
    dispatch(scheduler, [ACME], 20);
    const picks = dispatch(scheduler, [ACME, INITECH], 6);

    // It gets its weighted share going forward, not a burst of back pay.
    expect(countBy(picks)[INITECH]).toBeLessThanOrEqual(4);
  });

  it('rotates through every active client', () => {
    const scheduler = new FairScheduler();
    const picks = dispatch(scheduler, [ACME, GLOBEX, INITECH], 3);

    expect(new Set(picks).size).toBe(3);
  });

  it('returns null when nothing is active', () => {
    expect(new FairScheduler().nextClient([])).toBeNull();
  });
});
