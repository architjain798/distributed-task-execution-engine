import { DISPATCH_IDLE_MS, LEASE_TTL_MS } from '../config/constants.js';
import { logger } from '../lib/logger.js';
import type { ClientRepository } from '../repositories/client.repository.js';
import { progressFor, toTask, type TaskRepository } from '../repositories/task.repository.js';
import type { EventBus } from '../events/event-bus.js';
import { sleep } from '../utils/time.js';
import type { FairScheduler } from './fair-scheduler.js';
import type { ReadyQueue } from './ready-queue.js';
import type { TaskExecutor } from './task-executor.js';

const WEIGHT_REFRESH_MS = 30_000;

export interface DispatcherDeps {
  workerId: string;
  tasks: TaskRepository;
  clients: ClientRepository;
  readyQueue: ReadyQueue;
  scheduler: FairScheduler;
  executor: TaskExecutor;
  events: EventBus;
}

/**
 * The scheduling loop: choose a client fairly, take its best task, claim it in
 * MySQL, hand it to a worker thread.
 *
 * It is a plain loop rather than an event-driven pipeline because the pause is
 * only 200ms and the reconciler guarantees nothing is lost — the simpler shape
 * costs a fifth of a second of latency and removes a whole class of wakeup bugs.
 */
export class Dispatcher {
  private running = false;
  private weightTimer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: DispatcherDeps) {}

  async start(): Promise<void> {
    await this.refreshWeights();
    this.weightTimer = setInterval(() => void this.refreshWeights(), WEIGHT_REFRESH_MS);

    this.running = true;
    void this.loop();
    logger.info({ workerId: this.deps.workerId }, 'dispatcher started');
  }

  stop(): void {
    this.running = false;
    if (this.weightTimer) clearInterval(this.weightTimer);
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        const dispatched = await this.tick();
        if (!dispatched) await sleep(DISPATCH_IDLE_MS);
      } catch (error) {
        logger.error({ err: error }, 'dispatch tick failed');
        await sleep(DISPATCH_IDLE_MS);
      }
    }
  }

  /** One dispatch attempt. Returns true if a task started. */
  private async tick(): Promise<boolean> {
    if (this.deps.executor.freeSlots() === 0) return false;

    const activeClients = await this.deps.readyQueue.activeClients();
    const clientId = this.deps.scheduler.nextClient(activeClients);
    if (clientId === null) return false;

    const taskId = await this.deps.readyQueue.pop(clientId);
    if (taskId === null) {
      // The client's queue emptied between the SMEMBERS and the pop. Clearing
      // its deficit stops it banking credit while idle.
      this.deps.scheduler.reset(clientId);
      return false;
    }

    const row = await this.deps.tasks.claim(taskId, this.deps.workerId, LEASE_TTL_MS);
    if (row === null) {
      // The only way to lose this race is a cancellation landing between the pop
      // and the claim. The database arbitrates; we simply move on.
      logger.debug({ taskId }, 'task was no longer claimable, skipping');
      return true;
    }

    if (!this.deps.executor.execute(row)) {
      // Defensive: freeSlots() was checked above and only the dispatcher claims,
      // so this should be unreachable. Put the task back rather than strand it.
      logger.warn({ taskId }, 'no free worker after claiming, releasing task');
      await this.deps.tasks.releaseForRetry(row.id, 'No worker available');
      await this.deps.readyQueue.enqueue(row.id, row.client_id, row.priority, Date.now());
      return false;
    }

    await this.deps.events.publishEvent({
      type: 'task.updated',
      task: toTask(row, progressFor(row.status, 0)),
    });

    return true;
  }

  /** Client weights are a database column, so tiering a client needs no deploy. */
  private async refreshWeights(): Promise<void> {
    try {
      const clients = await this.deps.clients.findAll();
      this.deps.scheduler.setWeights(new Map(clients.map((c) => [c.id, c.weight])));
    } catch (error) {
      logger.error({ err: error }, 'failed to refresh client weights');
    }
  }
}
