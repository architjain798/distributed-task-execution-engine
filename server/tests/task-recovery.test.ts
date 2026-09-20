import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskRecovery } from '../src/engine/task-recovery.js';
import type { ReadyQueue } from '../src/engine/ready-queue.js';
import type { EventBus } from '../src/events/event-bus.js';
import type { ProgressStore } from '../src/lib/progress-store.js';
import type { TaskRepository, TaskRow } from '../src/repositories/task.repository.js';

/**
 * The retry and dead-letter rules, which decide what a crashed or failed task
 * becomes. The lease reaper and the worker pool both route through this, so
 * these assertions cover every path into the dead letter queue.
 */
type TaskRowOverrides = Partial<Omit<TaskRow, 'constructor'>>;

function taskRow(overrides: TaskRowOverrides = {}): TaskRow {
  return {
    id: 'task-1',
    client_id: 'client-a',
    client_name: 'Acme',
    type: 'data-import',
    priority: 3,
    payload: {},
    status: 'running',
    attempts: 1,
    max_attempts: 4,
    worker_id: 'worker-1',
    lease_expires_at: null,
    last_error: null,
    result: null,
    enqueued_at: '2026-01-01 12:00:00.000',
    started_at: '2026-01-01 12:00:01.000',
    last_attempt_at: '2026-01-01 12:00:01.000',
    finished_at: null,
    ...overrides,
  } as TaskRow;
}

describe('TaskRecovery', () => {
  let tasks: {
    markTerminalFailure: ReturnType<typeof vi.fn>;
    releaseForRetry: ReturnType<typeof vi.fn>;
  };
  let readyQueue: { enqueue: ReturnType<typeof vi.fn> };
  let progress: { clear: ReturnType<typeof vi.fn> };
  let events: { publishEvent: ReturnType<typeof vi.fn> };
  let recovery: TaskRecovery;

  beforeEach(() => {
    vi.useFakeTimers();
    tasks = {
      markTerminalFailure: vi.fn((id: string, status: string) =>
        Promise.resolve(taskRow({ id, status })),
      ),
      releaseForRetry: vi.fn((id: string) => Promise.resolve(taskRow({ id, status: 'queued' }))),
    };
    readyQueue = { enqueue: vi.fn(() => Promise.resolve()) };
    progress = { clear: vi.fn(() => Promise.resolve()) };
    events = { publishEvent: vi.fn(() => Promise.resolve()) };

    recovery = new TaskRecovery(
      tasks as unknown as TaskRepository,
      readyQueue as unknown as ReadyQueue,
      progress as unknown as ProgressStore,
      events as unknown as EventBus,
    );
  });

  it('requeues a task that still has attempts left', async () => {
    await recovery.retryOrDeadLetter(taskRow({ attempts: 1 }), 'worker crashed', 0);

    expect(tasks.releaseForRetry).toHaveBeenCalledWith('task-1', 'worker crashed');
    expect(tasks.markTerminalFailure).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(0);
    expect(readyQueue.enqueue).toHaveBeenCalledOnce();
  });

  it('dead-letters once the attempts are exhausted', async () => {
    await recovery.retryOrDeadLetter(taskRow({ attempts: 4, max_attempts: 4 }), 'crashed again', 0);

    expect(tasks.markTerminalFailure).toHaveBeenCalledWith(
      'task-1',
      'dead_letter',
      'crashed again',
    );
    expect(tasks.releaseForRetry).not.toHaveBeenCalled();
    expect(readyQueue.enqueue).not.toHaveBeenCalled();
  });

  it('records the reason so the dead letter view explains itself', async () => {
    await recovery.retryOrDeadLetter(taskRow({ attempts: 4 }), 'Worker lease expired', 0);

    expect(tasks.markTerminalFailure).toHaveBeenCalledWith(
      'task-1',
      'dead_letter',
      'Worker lease expired',
    );
  });

  it('holds a retry back for the backoff delay', async () => {
    await recovery.retryOrDeadLetter(taskRow({ attempts: 2 }), 'transient failure', 2_000);

    await vi.advanceTimersByTimeAsync(1_999);
    expect(readyQueue.enqueue).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(readyQueue.enqueue).toHaveBeenCalledOnce();
  });

  /** A retried task has already waited once; it should not go to the back. */
  it('re-enqueues at the original timestamp, keeping its place in the queue', async () => {
    const row = taskRow({ attempts: 1, enqueued_at: '2026-01-01 12:00:00.000' });
    await recovery.retryOrDeadLetter(row, 'transient failure', 0);
    await vi.advanceTimersByTimeAsync(0);

    expect(readyQueue.enqueue).toHaveBeenCalledWith(
      'task-1',
      'client-a',
      3,
      new Date('2026-01-01T12:00:00.000Z').getTime(),
    );
  });

  it('clears live progress and announces every transition', async () => {
    await recovery.retryOrDeadLetter(taskRow({ attempts: 4 }), 'gone', 0);

    expect(progress.clear).toHaveBeenCalledWith('task-1');
    expect(events.publishEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'task.updated' }),
    );
  });
});
