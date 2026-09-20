import { logger } from '../lib/logger.js';
import type { ProgressStore } from '../lib/progress-store.js';
import type { TaskRow } from '../repositories/task.repository.js';
import { progressFor, toTask, type TaskRepository } from '../repositories/task.repository.js';
import type { EventBus } from '../events/event-bus.js';
import { toIso } from '../utils/time.js';
import type { ReadyQueue } from './ready-queue.js';

/**
 * What happens to a task that did not finish.
 *
 * Three different things go wrong — a thread crashes, the task itself throws,
 * or a lease expires because the whole process died — and all three end in the
 * same decision: retry with a delay, or dead-letter. Keeping that decision in
 * one place is why the reaper and the executor agree about it.
 */
export class TaskRecovery {
  private readonly timers = new Set<NodeJS.Timeout>();

  constructor(
    private readonly tasks: TaskRepository,
    private readonly readyQueue: ReadyQueue,
    private readonly progress: ProgressStore,
    private readonly events: EventBus,
  ) {}

  async retryOrDeadLetter(row: TaskRow, reason: string, delayMs: number): Promise<void> {
    if (row.attempts >= row.max_attempts) {
      logger.warn(
        { taskId: row.id, attempts: row.attempts, reason },
        'attempts exhausted, moving to dead letter queue',
      );
      await this.publish(await this.tasks.markTerminalFailure(row.id, 'dead_letter', reason));
      return;
    }

    await this.publish(await this.tasks.releaseForRetry(row.id, reason));
    this.enqueueAfter(row, delayMs);
  }

  /** Clears live progress and broadcasts the task's new state. */
  async publish(row: TaskRow | null): Promise<void> {
    if (row === null) return;
    await this.progress.clear(row.id);
    await this.events.publishEvent({
      type: 'task.updated',
      task: toTask(row, progressFor(row.status, null)),
    });
  }

  clearTimers(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }

  /**
   * The task is already `queued` in MySQL but withheld from Redis for the
   * backoff. If this process dies during that window the reconciler restores it
   * within 30 seconds: the delay is lost, the task is not.
   */
  private enqueueAfter(row: TaskRow, delayMs: number): void {
    // Re-enqueued at its original timestamp so a retried task keeps its place in
    // the queue instead of going to the back of the line.
    const enqueuedAt = new Date(toIso(row.enqueued_at) as string).getTime();

    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.readyQueue
        .enqueue(row.id, row.client_id, row.priority, enqueuedAt)
        .catch((error: unknown) => {
          logger.error({ err: error, taskId: row.id }, 'failed to re-enqueue for retry');
        });
    }, delayMs);

    this.timers.add(timer);
    logger.info({ taskId: row.id, attempts: row.attempts, delayMs }, 'task scheduled for retry');
  }
}
