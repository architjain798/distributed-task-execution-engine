import { randomUUID } from 'node:crypto';
import type {
  CreateTaskInput,
  Dashboard,
  PaginatedTasks,
  Task,
  TaskFilter,
  WorkerStats,
} from '@task-engine/shared';
import { isTerminal, workerStatsSchema } from '@task-engine/shared';
import { DEFAULT_MAX_ATTEMPTS, RECENT_TERMINAL_LIMIT } from '../config/constants.js';
import { logger } from '../lib/logger.js';
import type { ProgressStore } from '../lib/progress-store.js';
import type { RedisClient } from '../lib/redis.js';
import { redisKeys } from '../lib/redis-keys.js';
import type { ClientRecord } from '../repositories/client.repository.js';
import { progressFor, toTask, type TaskRepository, type TaskRow } from '../repositories/task.repository.js';
import type { ReadyQueue } from '../engine/ready-queue.js';
import { validatePayload } from '../engine/task-type.registry.js';
import type { EventBus } from '../events/event-bus.js';
import { ConflictError, NotFoundError } from '../utils/errors.js';

const OFFLINE_WORKERS: WorkerStats = { total: 0, busy: 0, idle: 0, updatedAt: null };

/**
 * Task operations as the API sees them. Knows nothing about HTTP — controllers
 * translate, this decides.
 */
export class TaskService {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly readyQueue: ReadyQueue,
    private readonly progress: ProgressStore,
    private readonly events: EventBus,
    private readonly redis: RedisClient,
  ) {}

  async create(client: ClientRecord, input: CreateTaskInput): Promise<Task> {
    // Throws FatalError (400) for an unknown type or a payload that fails the
    // type's schema, so bad work never reaches the queue or consumes a retry.
    validatePayload(input.type, input.payload);

    const row = await this.tasks.insert({
      id: randomUUID(),
      clientId: client.id,
      type: input.type,
      priority: input.priority,
      payload: input.payload,
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
    });

    // MySQL first, then Redis. A crash between the two leaves a task that the
    // reconciler restores within 30 seconds.
    await this.readyQueue.enqueue(
      row.id,
      row.client_id,
      row.priority,
      new Date(row.enqueued_at.replace(' ', 'T') + 'Z').getTime(),
    );

    const task = toTask(row, 0);
    await this.events.publishEvent({ type: 'task.created', task });

    logger.info(
      { taskId: task.id, type: task.type, priority: task.priority, clientId: client.id },
      'task submitted',
    );

    return task;
  }

  async getById(id: string): Promise<Task> {
    const row = await this.tasks.findById(id);
    if (row === null) throw new NotFoundError('Task', id);
    return this.withProgress([row]).then((tasks) => tasks[0] as Task);
  }

  async list(filter: TaskFilter): Promise<PaginatedTasks> {
    const { rows, total } = await this.tasks.search(filter);
    return {
      items: await this.withProgress(rows),
      page: filter.page,
      pageSize: filter.pageSize,
      total,
    };
  }

  /** Hydrates the live dashboard: everything active, plus recent history. */
  async dashboard(): Promise<Dashboard> {
    const rows = await this.tasks.findActiveAndRecent(RECENT_TERMINAL_LIMIT);
    return {
      tasks: await this.withProgress(rows),
      workers: await this.workerStats(),
    };
  }

  /**
   * The stats key carries a short TTL, so its absence means the worker process
   * is gone rather than merely idle.
   */
  async workerStats(): Promise<WorkerStats> {
    const raw = await this.redis.get(redisKeys.workerStats);
    if (raw === null) return OFFLINE_WORKERS;

    const parsed = workerStatsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : OFFLINE_WORKERS;
  }

  /**
   * Cancelling takes one of two paths depending on whether the task has started,
   * and the database decides which — not a check-then-act in this method.
   */
  async cancel(id: string): Promise<Task> {
    const row = await this.tasks.findById(id);
    if (row === null) throw new NotFoundError('Task', id);
    if (isTerminal(row.status)) {
      throw new ConflictError(`Task ${id} is already ${row.status} and cannot be cancelled`);
    }

    if (row.status === 'queued') {
      await this.readyQueue.remove(id, row.client_id);

      if (await this.tasks.cancelIfQueued(id)) {
        return this.publishUpdate(await this.tasks.findById(id));
      }
      // The dispatcher claimed it between the two statements. Fall through and
      // cancel it as a running task.
      logger.debug({ taskId: id }, 'task was claimed while being cancelled');
    }

    const cancelling = await this.tasks.markCancelling(id);

    // The worker process owns the thread, so the stop request travels over Redis.
    await this.events.publishCancel(id);

    return this.publishUpdate(cancelling);
  }

  /** Manual retry from the dead letter queue. Grants a fresh budget of attempts. */
  async retry(id: string): Promise<Task> {
    const row = await this.tasks.findById(id);
    if (row === null) throw new NotFoundError('Task', id);
    if (row.status !== 'dead_letter') {
      throw new ConflictError(`Only dead-lettered tasks can be retried; task ${id} is ${row.status}`);
    }

    const reset = await this.tasks.resetForManualRetry(id);
    if (reset === null) throw new NotFoundError('Task', id);

    await this.readyQueue.enqueue(reset.id, reset.client_id, reset.priority, Date.now());
    logger.info({ taskId: id }, 'dead-lettered task requeued');

    return this.publishUpdate(reset);
  }

  /** Merges live progress from Redis onto rows read from MySQL. */
  private async withProgress(rows: TaskRow[]): Promise<Task[]> {
    const live = await this.progress.getMany(rows.map((row) => row.id));
    return rows.map((row) => toTask(row, progressFor(row.status, live.get(row.id) ?? null)));
  }

  private async publishUpdate(row: TaskRow | null): Promise<Task> {
    if (row === null) throw new Error('task disappeared during update');
    const [task] = await this.withProgress([row]);
    await this.events.publishEvent({ type: 'task.updated', task: task as Task });
    return task as Task;
  }
}
