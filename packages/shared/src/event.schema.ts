import { z } from 'zod';
import { taskSchema, workerStatsSchema } from './task.schema.js';

/**
 * The SSE wire format. A discriminated union so the browser can switch on
 * `type` and have the payload narrowed for it.
 */

export const taskCreatedEventSchema = z.object({
  type: z.literal('task.created'),
  task: taskSchema,
});

export const taskUpdatedEventSchema = z.object({
  type: z.literal('task.updated'),
  task: taskSchema,
});

/** Sent far more often than the others, so it carries the minimum. */
export const taskProgressEventSchema = z.object({
  type: z.literal('task.progress'),
  taskId: z.string(),
  progress: z.number().min(0).max(100),
});

export const workerStatsEventSchema = z.object({
  type: z.literal('workers.stats'),
  workers: workerStatsSchema,
});

export const serverEventSchema = z.discriminatedUnion('type', [
  taskCreatedEventSchema,
  taskUpdatedEventSchema,
  taskProgressEventSchema,
  workerStatsEventSchema,
]);

/** API → worker. Sent when a running task must stop. */
export const cancelCommandSchema = z.object({
  type: z.literal('task.cancel'),
  taskId: z.string(),
});

/**
 * API → worker. Kills a busy worker thread so crash recovery can be triggered
 * on demand instead of waited for. Only reachable when dev routes are enabled.
 */
export const killWorkerCommandSchema = z.object({
  type: z.literal('worker.kill'),
});

export const controlCommandSchema = z.discriminatedUnion('type', [
  cancelCommandSchema,
  killWorkerCommandSchema,
]);

export type TaskCreatedEvent = z.infer<typeof taskCreatedEventSchema>;
export type TaskUpdatedEvent = z.infer<typeof taskUpdatedEventSchema>;
export type TaskProgressEvent = z.infer<typeof taskProgressEventSchema>;
export type WorkerStatsEvent = z.infer<typeof workerStatsEventSchema>;
export type ServerEvent = z.infer<typeof serverEventSchema>;
export type CancelCommand = z.infer<typeof cancelCommandSchema>;
export type KillWorkerCommand = z.infer<typeof killWorkerCommandSchema>;
export type ControlCommand = z.infer<typeof controlCommandSchema>;
