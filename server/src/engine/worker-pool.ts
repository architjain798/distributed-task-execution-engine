import { Worker } from 'node:worker_threads';
import { CANCEL_GRACE_MS } from '../config/constants.js';
import { logger } from '../lib/logger.js';
import type { RunnableTask, RunnerCommand, RunnerMessage } from './task-runner.js';

/**
 * A fixed pool of worker threads. Pool size is also the concurrency limit:
 * one task per thread at a time.
 */

export type TaskOutcome =
  | { kind: 'completed'; result: Record<string, unknown> }
  | { kind: 'failed'; message: string; retryable: boolean }
  | { kind: 'cancelled' }
  | { kind: 'crashed'; message: string };

export interface PoolHandlers {
  onProgress(taskId: string, percent: number): void;
  onSettled(task: RunnableTask, outcome: TaskOutcome): void;
}

interface Slot {
  id: string;
  worker: Worker;
  task: RunnableTask | null;
  /** Set while a cancellation is pending; fires terminate() if the task ignores it. */
  cancelTimer: NodeJS.Timeout | null;
  /** Distinguishes a deliberate terminate() from a genuine crash. */
  terminating: boolean;
}

// tsx runs the TypeScript sources directly in development; the container runs
// compiled JavaScript. Resolve the sibling file either way.
const RUNNER_URL = new URL(
  import.meta.url.endsWith('.ts') ? './task-runner.ts' : './task-runner.js',
  import.meta.url,
);

export class WorkerPool {
  private readonly slots: Slot[] = [];
  private shuttingDown = false;

  constructor(
    private readonly size: number,
    private readonly handlers: PoolHandlers,
  ) {}

  start(): void {
    for (let index = 0; index < this.size; index += 1) {
      this.slots.push(this.spawn(`thread-${index + 1}`));
    }
    logger.info({ workers: this.size }, 'worker pool started');
  }

  freeSlots(): number {
    return this.slots.filter((slot) => slot.task === null).length;
  }

  busyCount(): number {
    return this.slots.length - this.freeSlots();
  }

  stats(): { total: number; busy: number; idle: number } {
    const busy = this.busyCount();
    return { total: this.slots.length, busy, idle: this.slots.length - busy };
  }

  runningTaskIds(): string[] {
    return this.slots.flatMap((slot) => (slot.task ? [slot.task.id] : []));
  }

  /** Returns false when every thread is busy — the dispatcher then waits. */
  run(task: RunnableTask): boolean {
    const slot = this.slots.find((candidate) => candidate.task === null);
    if (!slot) return false;

    slot.task = task;
    slot.terminating = false;
    this.send(slot, { type: 'run', task });
    return true;
  }

  /**
   * Asks the thread running `taskId` to stop. If it has not acknowledged within
   * the grace period the thread is terminated and replaced — which is why the
   * pool tracks intent, so a deliberate kill is not mistaken for a crash.
   */
  cancel(taskId: string): boolean {
    const slot = this.slots.find((candidate) => candidate.task?.id === taskId);
    if (!slot || slot.cancelTimer !== null) return false;

    this.send(slot, { type: 'cancel' });

    slot.cancelTimer = setTimeout(() => {
      if (slot.task?.id !== taskId) return;
      logger.warn({ taskId, slot: slot.id }, 'task ignored cancellation, terminating thread');
      this.settle(slot, { kind: 'cancelled' });
      this.replace(slot);
    }, CANCEL_GRACE_MS);

    return true;
  }

  /**
   * Kills a thread that is mid-task, so crash recovery can be demonstrated on
   * demand rather than waited for. Exposed through POST /api/dev/kill-worker.
   */
  killRandomBusy(): string | null {
    const busy = this.slots.filter((slot) => slot.task !== null);
    if (busy.length === 0) return null;

    const slot = busy[Math.floor(Math.random() * busy.length)] as Slot;
    const taskId = slot.task?.id ?? null;
    logger.warn({ slot: slot.id, taskId }, 'deliberately killing a busy worker thread');

    // Not marked as terminating: this must look exactly like a real crash so it
    // travels the same recovery path.
    void slot.worker.terminate();
    return taskId;
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    await Promise.all(this.slots.map((slot) => slot.worker.terminate()));
  }

  private spawn(id: string): Slot {
    const slot: Slot = {
      id,
      worker: new Worker(RUNNER_URL),
      task: null,
      cancelTimer: null,
      terminating: false,
    };

    slot.worker.on('message', (message: RunnerMessage) => this.onMessage(slot, message));

    slot.worker.on('error', (error: Error) => {
      logger.error({ err: error, slot: slot.id }, 'worker thread error');
      this.settle(slot, { kind: 'crashed', message: error.message });
      this.replace(slot);
    });

    slot.worker.on('exit', (code: number) => {
      if (this.shuttingDown || slot.terminating) return;
      logger.error({ slot: slot.id, code, taskId: slot.task?.id }, 'worker thread exited');
      this.settle(slot, { kind: 'crashed', message: `Worker thread exited with code ${code}` });
      this.replace(slot);
    });

    return slot;
  }

  private onMessage(slot: Slot, message: RunnerMessage): void {
    if (slot.task?.id !== message.taskId) return;

    switch (message.type) {
      case 'progress':
        this.handlers.onProgress(message.taskId, message.percent);
        return;
      case 'done':
        this.settle(slot, { kind: 'completed', result: message.result });
        return;
      case 'failed':
        this.settle(slot, {
          kind: 'failed',
          message: message.message,
          retryable: message.retryable,
        });
        return;
      case 'cancelled':
        this.settle(slot, { kind: 'cancelled' });
        return;
    }
  }

  /** Frees the slot and reports the outcome exactly once. */
  private settle(slot: Slot, outcome: TaskOutcome): void {
    const task = slot.task;
    if (task === null) return;

    slot.task = null;
    if (slot.cancelTimer !== null) {
      clearTimeout(slot.cancelTimer);
      slot.cancelTimer = null;
    }

    this.handlers.onSettled(task, outcome);
  }

  /** Replaces a dead or unresponsive thread so the pool keeps its size. */
  private replace(slot: Slot): void {
    if (this.shuttingDown) return;

    slot.terminating = true;
    void slot.worker.terminate();

    const replacement = this.spawn(slot.id);
    const index = this.slots.indexOf(slot);
    if (index >= 0) this.slots[index] = replacement;
  }

  private send(slot: Slot, command: RunnerCommand): void {
    slot.worker.postMessage(command);
  }
}
