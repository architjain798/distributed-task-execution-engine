import { REAPER_INTERVAL_MS } from '../config/constants.js';
import { logger } from '../lib/logger.js';
import type { TaskRepository } from '../repositories/task.repository.js';
import type { TaskRecovery } from './task-recovery.js';

const BATCH_SIZE = 50;

/**
 * Reclaims tasks whose worker stopped renewing their lease.
 *
 * The pool's `exit` handler covers a thread dying, but nothing inside a process
 * can report that process's own death. A task holds a lease renewed every 15
 * seconds against a 60 second expiry, so a container that is killed leaves rows
 * this sweep finds and requeues.
 *
 * Recovery here is retried immediately rather than backed off: the task already
 * waited out the lease.
 */
export class LeaseReaper {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly tasks: TaskRepository,
    private readonly recovery: TaskRecovery,
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.sweep(), REAPER_INTERVAL_MS);
    void this.sweep();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async sweep(): Promise<number> {
    try {
      const abandoned = await this.tasks.findExpiredLeases(BATCH_SIZE);
      if (abandoned.length === 0) return 0;

      logger.warn({ count: abandoned.length }, 'reclaiming tasks with expired leases');

      for (const row of abandoned) {
        await this.recovery.retryOrDeadLetter(row, 'Worker lease expired', 0);
      }

      return abandoned.length;
    } catch (error) {
      logger.error({ err: error }, 'lease sweep failed');
      return 0;
    }
  }
}
