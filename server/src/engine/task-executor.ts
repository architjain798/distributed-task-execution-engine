import {
  BACKOFF_BASE_MS,
  LEASE_HEARTBEAT_MS,
  LEASE_TTL_MS,
  WORKER_STATS_INTERVAL_MS,
  WORKER_STATS_TTL_SECONDS,
} from '../config/constants.js';
import { logger } from '../lib/logger.js';
import type { ProgressStore } from '../lib/progress-store.js';
import type { RedisClient } from '../lib/redis.js';
import { redisKeys } from '../lib/redis-keys.js';
import type { TaskRepository, TaskRow } from '../repositories/task.repository.js';
import type { EventBus } from '../events/event-bus.js';
import { backoffMs } from '../utils/time.js';
import type { TaskRecovery } from './task-recovery.js';
import type { RunnableTask } from './task-runner.js';
import { WorkerPool, type TaskOutcome } from './worker-pool.js';

export interface TaskExecutorDeps {
  workerCount: number;
  tasks: TaskRepository;
  recovery: TaskRecovery;
  progress: ProgressStore;
  events: EventBus;
  redis: RedisClient;
}

/**
 * Owns the worker pool and decides what a finished task becomes.
 *
 * The dispatcher decides *what* runs; this decides what happens *after*.
 * Retry and dead-letter rules live in TaskRecovery, which the lease reaper
 * shares, so the two cannot drift apart.
 */
export class TaskExecutor {
  private readonly pool: WorkerPool;
  private leaseTimer: NodeJS.Timeout | null = null;
  private statsTimer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: TaskExecutorDeps) {
    this.pool = new WorkerPool(deps.workerCount, {
      onProgress: (taskId, percent) => void this.onProgress(taskId, percent),
      onSettled: (task, outcome) => void this.onSettled(task, outcome),
    });
  }

  start(): void {
    this.pool.start();

    // Renewing well inside LEASE_TTL_MS means a live task is never reaped, while
    // a dead process stops renewing and is reclaimed within the TTL.
    this.leaseTimer = setInterval(() => this.renewLeases(), LEASE_HEARTBEAT_MS);
    this.statsTimer = setInterval(() => void this.publishStats(), WORKER_STATS_INTERVAL_MS);
    void this.publishStats();
  }

  async stop(): Promise<void> {
    if (this.leaseTimer) clearInterval(this.leaseTimer);
    if (this.statsTimer) clearInterval(this.statsTimer);
    await this.pool.shutdown();
  }

  freeSlots(): number {
    return this.pool.freeSlots();
  }

  stats(): { total: number; busy: number; idle: number } {
    return this.pool.stats();
  }

  execute(row: TaskRow): boolean {
    const task: RunnableTask = { id: row.id, type: row.type, payload: row.payload ?? {} };
    return this.pool.run(task);
  }

  cancel(taskId: string): boolean {
    return this.pool.cancel(taskId);
  }

  killRandomBusy(): string | null {
    return this.pool.killRandomBusy();
  }

  private async onProgress(taskId: string, percent: number): Promise<void> {
    await this.deps.progress.set(taskId, percent);
    await this.deps.events.publishEvent({ type: 'task.progress', taskId, progress: percent });
  }

  private async onSettled(task: RunnableTask, outcome: TaskOutcome): Promise<void> {
    try {
      const row = await this.deps.tasks.findById(task.id);
      if (row === null) return;

      switch (outcome.kind) {
        case 'completed':
          await this.deps.recovery.publish(
            await this.deps.tasks.markCompleted(task.id, outcome.result),
          );
          return;

        case 'cancelled':
          await this.deps.recovery.publish(await this.deps.tasks.markCancelled(task.id));
          return;

        case 'failed':
          if (outcome.retryable) {
            await this.retry(row, outcome.message);
            return;
          }
          // Fatal: the same input would fail the same way, so it never retries.
          await this.deps.recovery.publish(
            await this.deps.tasks.markTerminalFailure(task.id, 'failed', outcome.message),
          );
          return;

        case 'crashed':
          logger.warn({ taskId: task.id, reason: outcome.message }, 'task lost to a crash');
          await this.retry(row, outcome.message);
          return;
      }
    } catch (error) {
      logger.error({ err: error, taskId: task.id }, 'failed to record task outcome');
    }
  }

  private async retry(row: TaskRow, reason: string): Promise<void> {
    await this.deps.recovery.retryOrDeadLetter(row, reason, backoffMs(row.attempts, BACKOFF_BASE_MS));
  }

  private renewLeases(): void {
    for (const taskId of this.pool.runningTaskIds()) {
      this.deps.tasks.renewLease(taskId, LEASE_TTL_MS).catch((error: unknown) => {
        logger.error({ err: error, taskId }, 'failed to renew lease');
      });
    }
  }

  private async publishStats(): Promise<void> {
    const workers = { ...this.pool.stats(), updatedAt: new Date().toISOString() };

    try {
      // The TTL is the point: when this process dies the key expires and the
      // dashboard shows the worker as offline rather than frozen.
      await this.deps.redis.set(
        redisKeys.workerStats,
        JSON.stringify(workers),
        'EX',
        WORKER_STATS_TTL_SECONDS,
      );
      await this.deps.events.publishEvent({ type: 'workers.stats', workers });
    } catch (error) {
      logger.error({ err: error }, 'failed to publish worker stats');
    }
  }
}
