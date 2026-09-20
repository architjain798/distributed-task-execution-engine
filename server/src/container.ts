import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { createPool, waitForDatabase, type Database } from './lib/mysql.js';
import { runMigrations } from './lib/migrator.js';
import { ProgressStore } from './lib/progress-store.js';
import { RateLimiter } from './lib/rate-limiter.js';
import { createRedis, createSubscriber, waitForRedis, type RedisClient } from './lib/redis.js';
import { AnalyticsRepository } from './repositories/analytics.repository.js';
import { ClientRepository } from './repositories/client.repository.js';
import { TaskRepository } from './repositories/task.repository.js';
import { Dispatcher } from './engine/dispatcher.js';
import { FairScheduler } from './engine/fair-scheduler.js';
import { LeaseReaper } from './engine/lease-reaper.js';
import { ReadyQueue } from './engine/ready-queue.js';
import { Reconciler } from './engine/reconciler.js';
import { TaskExecutor } from './engine/task-executor.js';
import { TaskRecovery } from './engine/task-recovery.js';
import { EventBus } from './events/event-bus.js';
import { SseHub } from './events/sse-hub.js';
import { AnalyticsService } from './services/analytics.service.js';
import { SeedService } from './services/seed.service.js';
import { TaskService } from './services/task.service.js';

/**
 * The composition root. Every `new` in the application happens here, so the rest
 * of the codebase receives its collaborators and never reaches out for them.
 *
 * Both processes are built from the same modules; they differ only in which ones
 * they assemble.
 */

interface Infrastructure {
  db: Database;
  redis: RedisClient;
  subscriber: RedisClient;
}

async function connect(role: string): Promise<Infrastructure> {
  const db = createPool();
  const redis = createRedis(role);
  const subscriber = createSubscriber(redis, role);

  await Promise.all([waitForDatabase(db), waitForRedis(redis)]);
  logger.info({ role }, 'connected to mysql and redis');

  return { db, redis, subscriber };
}

export interface ApiContainer {
  db: Database;
  redis: RedisClient;
  clients: ClientRepository;
  taskService: TaskService;
  analyticsService: AnalyticsService;
  seedService: SeedService;
  rateLimiter: RateLimiter;
  events: EventBus;
  sseHub: SseHub;
  shutdown(): Promise<void>;
}

export async function createApiContainer(): Promise<ApiContainer> {
  const { db, redis, subscriber } = await connect('api');

  // The api owns the schema. The worker waits for the api to be healthy, so by
  // the time it runs a query the tables exist.
  await runMigrations(db);

  const clients = new ClientRepository(db);
  const tasks = new TaskRepository(db);
  const analyticsRepository = new AnalyticsRepository(db);

  const readyQueue = new ReadyQueue(redis);
  const progress = new ProgressStore(redis);
  const events = new EventBus(redis, subscriber);
  const sseHub = new SseHub();
  const rateLimiter = new RateLimiter(redis, env.RATE_LIMIT_MAX, env.RATE_LIMIT_WINDOW_MS);

  const taskService = new TaskService(tasks, readyQueue, progress, events, redis);
  const analyticsService = new AnalyticsService(analyticsRepository);
  const seedService = new SeedService(clients, taskService);

  // Everything the worker publishes goes straight out to the browsers.
  sseHub.start();
  await events.onEvent((event) => sseHub.broadcast(event));

  return {
    db,
    redis,
    clients,
    taskService,
    analyticsService,
    seedService,
    rateLimiter,
    events,
    sseHub,
    async shutdown() {
      sseHub.close();
      await Promise.allSettled([subscriber.quit(), redis.quit(), db.end()]);
    },
  };
}

export interface WorkerContainer {
  start(): Promise<void>;
  shutdown(): Promise<void>;
}

export async function createWorkerContainer(): Promise<WorkerContainer> {
  const { db, redis, subscriber } = await connect('worker');

  const clients = new ClientRepository(db);
  const tasks = new TaskRepository(db);

  const readyQueue = new ReadyQueue(redis);
  const progress = new ProgressStore(redis);
  const events = new EventBus(redis, subscriber);
  const recovery = new TaskRecovery(tasks, readyQueue, progress, events);

  const executor = new TaskExecutor({
    workerCount: env.WORKER_COUNT,
    tasks,
    recovery,
    progress,
    events,
    redis,
  });

  const scheduler = new FairScheduler();
  const dispatcher = new Dispatcher({
    workerId: env.WORKER_ID,
    tasks,
    clients,
    readyQueue,
    scheduler,
    executor,
    events,
  });

  const reaper = new LeaseReaper(tasks, recovery);
  const reconciler = new Reconciler(tasks, readyQueue);

  return {
    async start() {
      // Cancellations and the demo kill switch arrive from the api process.
      await events.onControl((command) => {
        if (command.type === 'task.cancel') {
          executor.cancel(command.taskId);
          return;
        }
        executor.killRandomBusy();
      });

      executor.start();
      reaper.start();
      reconciler.start();
      await dispatcher.start();
    },

    async shutdown() {
      dispatcher.stop();
      reaper.stop();
      reconciler.stop();
      recovery.clearTimers();
      await executor.stop();
      await Promise.allSettled([subscriber.quit(), redis.quit(), db.end()]);
    },
  };
}
