import { z } from 'zod';

/**
 * Everything the API and the browser agree on about a task lives here.
 * Types are inferred from these schemas, never written twice.
 */

export const TASK_STATUSES = [
  'queued',
  'running',
  'cancelling',
  'completed',
  'failed',
  'cancelled',
  'dead_letter',
] as const;

/** Statuses a task can never leave. */
export const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled', 'dead_letter'] as const;

/** Statuses that still occupy the system's attention. */
export const ACTIVE_STATUSES = ['queued', 'running', 'cancelling'] as const;

export const TASK_TYPES = [
  'image-processing',
  'report-generation',
  'data-import',
  'email-batch',
] as const;

export const MIN_PRIORITY = 1;
export const MAX_PRIORITY = 5;

export const taskStatusSchema = z.enum(TASK_STATUSES);
export const taskTypeSchema = z.enum(TASK_TYPES);
export const prioritySchema = z.number().int().min(MIN_PRIORITY).max(MAX_PRIORITY);

export const taskSchema = z.object({
  id: z.string(),
  clientId: z.string(),
  clientName: z.string(),
  type: z.string(),
  priority: prioritySchema,
  payload: z.record(z.string(), z.unknown()),
  status: taskStatusSchema,
  attempts: z.number().int(),
  maxAttempts: z.number().int(),
  progress: z.number().min(0).max(100),
  lastError: z.string().nullable(),
  result: z.record(z.string(), z.unknown()).nullable(),
  enqueuedAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  /** Milliseconds between enqueue and first dispatch. Null until the task starts. */
  waitMs: z.number().nullable(),
  /** Milliseconds spent on the attempt that finished. Null until the task finishes. */
  durationMs: z.number().nullable(),
});

/**
 * Task submission. `payload` is deliberately open — each task type narrows it
 * further with its own schema in the server's task type registry.
 */
export const createTaskSchema = z.object({
  type: z.string().min(1).max(64),
  priority: prioritySchema,
  payload: z.record(z.string(), z.unknown()).default({}),
});

export const taskFilterSchema = z.object({
  status: taskStatusSchema.optional(),
  type: z.string().max(64).optional(),
  priority: z.coerce.number().int().min(MIN_PRIORITY).max(MAX_PRIORITY).optional(),
  clientId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  search: z.string().max(128).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const paginatedTasksSchema = z.object({
  items: z.array(taskSchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

export const workerStatsSchema = z.object({
  total: z.number().int(),
  busy: z.number().int(),
  idle: z.number().int(),
  /** Absent while the worker container is down — the UI shows this as offline. */
  updatedAt: z.string().nullable(),
});

export const dashboardSchema = z.object({
  tasks: z.array(taskSchema),
  workers: workerStatsSchema,
});

export const clientSchema = z.object({
  id: z.string(),
  name: z.string(),
  apiKey: z.string(),
  weight: z.number(),
});

export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type TaskType = z.infer<typeof taskTypeSchema>;
export type Task = z.infer<typeof taskSchema>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type TaskFilter = z.infer<typeof taskFilterSchema>;
export type PaginatedTasks = z.infer<typeof paginatedTasksSchema>;
export type WorkerStats = z.infer<typeof workerStatsSchema>;
export type Dashboard = z.infer<typeof dashboardSchema>;
export type Client = z.infer<typeof clientSchema>;

export function isTerminal(status: TaskStatus): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

export function isActive(status: TaskStatus): boolean {
  return (ACTIVE_STATUSES as readonly string[]).includes(status);
}
