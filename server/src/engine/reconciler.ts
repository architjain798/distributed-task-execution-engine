import { RECONCILER_INTERVAL_MS } from '../config/constants.js';
import { logger } from '../lib/logger.js';
import type { TaskRepository } from '../repositories/task.repository.js';
import type { ReadyQueue } from './ready-queue.js';

/**
 * Repairs disagreements between MySQL and Redis.
 *
 * Submitting a task writes to two systems: INSERT into MySQL, then ZADD into
 * Redis. A crash between them leaves a task `queued` in the database and absent
 * from the queue — invisible to the dispatcher forever. The same window exists
 * in reverse at dispatch.
 *
 * Choosing Redis as the queue narrowed that window; it did not close it. This
 * sweep is what actually closes it, and it doubles as the repair path if Redis
 * is flushed or restarts empty: after one pass, every queued task is back.
 *
 * It is also the reason the backoff between retries can be a plain in-process
 * timer — if the process dies mid-backoff, this puts the task back.
 */

/**
 * A queued task must have been untouched for this long before it is considered
 * drifted. Anything more recent is probably mid-backoff and absent from Redis
 * on purpose.
 */
const SETTLING_PERIOD_MS = 10_000;
export class Reconciler {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly tasks: TaskRepository,
    private readonly readyQueue: ReadyQueue,
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.reconcile(), RECONCILER_INTERVAL_MS);
    void this.reconcile();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Returns how many tasks were restored. */
  async reconcile(): Promise<number> {
    try {
      const queued = await this.tasks.findQueued(SETTLING_PERIOD_MS);
      if (queued.length === 0) return 0;

      // One read per client rather than one per task.
      const clientIds = [...new Set(queued.map((task) => task.clientId))];
      const known = new Map<string, Set<string>>();
      for (const clientId of clientIds) {
        known.set(clientId, new Set(await this.readyQueue.taskIds(clientId)));
      }

      let restored = 0;
      for (const task of queued) {
        if (known.get(task.clientId)?.has(task.id)) continue;

        await this.readyQueue.enqueue(
          task.id,
          task.clientId,
          task.priority,
          new Date(task.enqueuedAt).getTime(),
        );
        restored += 1;
      }

      if (restored > 0) {
        logger.warn({ restored }, 'reconciler restored tasks missing from the ready queue');
      }

      return restored;
    } catch (error) {
      logger.error({ err: error }, 'reconciliation failed');
      return 0;
    }
  }
}
