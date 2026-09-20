import { parentPort } from 'node:worker_threads';
import { PROGRESS_PUBLISH_MS, PROGRESS_TICK_MS } from '../config/constants.js';
import { planExecution } from './task-type.registry.js';
import { FatalError, errorMessage } from '../utils/errors.js';
import { sleep } from '../utils/time.js';

/**
 * Runs inside a worker thread. Simulates a long task by sleeping in short ticks,
 * reporting progress as it goes.
 *
 * Cancellation is cooperative: the flag is checked every tick. That works here
 * only because the thread is idle between ticks, so its message queue drains.
 * Real CPU-bound work would need an Atomics-backed SharedArrayBuffer flag — the
 * pool's terminate() fallback exists for exactly that case.
 */

export interface RunnableTask {
  id: string;
  type: string;
  payload: Record<string, unknown>;
}

export type RunnerCommand = { type: 'run'; task: RunnableTask } | { type: 'cancel' };

export type RunnerMessage =
  | { type: 'progress'; taskId: string; percent: number }
  | { type: 'done'; taskId: string; result: Record<string, unknown> }
  | { type: 'failed'; taskId: string; message: string; retryable: boolean }
  | { type: 'cancelled'; taskId: string };

const port = parentPort;
if (port === null) {
  throw new Error('task-runner must be started as a worker thread');
}

let cancelled = false;

port.on('message', (command: RunnerCommand) => {
  if (command.type === 'cancel') {
    cancelled = true;
    return;
  }
  if (command.type === 'run') {
    void execute(command.task);
  }
});

async function execute(task: RunnableTask): Promise<void> {
  cancelled = false;

  let plan;
  try {
    plan = planExecution(task.type, task.payload);
  } catch (error) {
    // An unknown type should have been rejected at submission; if one reaches a
    // thread it is still fatal, never retried.
    post({
      type: 'failed',
      taskId: task.id,
      message: errorMessage(error),
      retryable: !(error instanceof FatalError),
    });
    return;
  }

  const ticks = Math.max(1, Math.ceil(plan.durationMs / PROGRESS_TICK_MS));
  let lastPublishedAt = 0;

  for (let tick = 1; tick <= ticks; tick += 1) {
    await sleep(PROGRESS_TICK_MS);

    if (cancelled) {
      post({ type: 'cancelled', taskId: task.id });
      return;
    }

    // Progress is throttled independently of the tick rate so a 30s task does
    // not emit 120 events.
    const percent = Math.min(99, Math.round((tick / ticks) * 100));
    const now = Date.now();
    if (now - lastPublishedAt >= PROGRESS_PUBLISH_MS) {
      lastPublishedAt = now;
      post({ type: 'progress', taskId: task.id, percent });
    }
  }

  if (plan.willFail) {
    post({
      type: 'failed',
      taskId: task.id,
      message: `Simulated ${task.type} failure`,
      retryable: true,
    });
    return;
  }

  post({
    type: 'done',
    taskId: task.id,
    result: { durationMs: plan.durationMs, completedAt: new Date().toISOString() },
  });
}

function post(message: RunnerMessage): void {
  port?.postMessage(message);
}
