import { z } from 'zod';
import { TASK_TYPES } from '@task-engine/shared';
import { FatalError } from '../utils/errors.js';

/**
 * Task types are not opaque strings. Each carries a duration profile, a failure
 * probability and a payload schema.
 *
 * The profiles differ on purpose: identical types would make "average execution
 * time by type" and "failure rate by type" four identical bars, and the dead
 * letter queue would never populate without someone forcing it.
 */
export interface TaskTypeProfile {
  name: string;
  minDurationMs: number;
  maxDurationMs: number;
  /** Probability in [0, 1] that an attempt raises a RetryableError. */
  failureRate: number;
  payloadSchema: z.ZodType;
}

/**
 * Every payload may override the profile. This keeps tests deterministic and
 * lets a reviewer force a specific outcome without editing code.
 */
function payloadSchema(shape: z.ZodRawShape) {
  return z.object({
    durationMs: z.number().int().min(100).max(120_000).optional(),
    failureRate: z.number().min(0).max(1).optional(),
    ...shape,
  });
}

const PROFILES: Record<string, TaskTypeProfile> = {
  'image-processing': {
    name: 'image-processing',
    minDurationMs: 5_000,
    maxDurationMs: 12_000,
    failureRate: 0.05,
    payloadSchema: payloadSchema({
      imageUrl: z.string().max(500).optional(),
      width: z.number().int().positive().optional(),
      height: z.number().int().positive().optional(),
    }),
  },
  'report-generation': {
    name: 'report-generation',
    minDurationMs: 15_000,
    maxDurationMs: 30_000,
    failureRate: 0.1,
    payloadSchema: payloadSchema({
      reportType: z.string().max(64).optional(),
      rangeDays: z.number().int().positive().max(365).optional(),
    }),
  },
  'data-import': {
    name: 'data-import',
    minDurationMs: 8_000,
    maxDurationMs: 20_000,
    failureRate: 0.2,
    payloadSchema: payloadSchema({
      source: z.string().max(200).optional(),
      rows: z.number().int().positive().optional(),
    }),
  },
  'email-batch': {
    name: 'email-batch',
    minDurationMs: 5_000,
    maxDurationMs: 10_000,
    failureRate: 0.02,
    payloadSchema: payloadSchema({
      template: z.string().max(64).optional(),
      recipients: z.number().int().positive().optional(),
    }),
  },
};

export const taskTypeNames = TASK_TYPES;

export function getProfile(type: string): TaskTypeProfile {
  const profile = PROFILES[type];
  if (!profile) {
    throw new FatalError(
      `Unknown task type "${type}". Known types: ${Object.keys(PROFILES).join(', ')}`,
    );
  }
  return profile;
}

/**
 * Called at submission time. A payload that fails its schema is a FatalError,
 * so the task never enters the queue and never consumes a retry.
 */
export function validatePayload(type: string, payload: Record<string, unknown>): void {
  const profile = getProfile(type);
  const result = profile.payloadSchema.safeParse(payload);

  if (!result.success) {
    throw new FatalError(
      `Invalid payload for task type "${type}"`,
      result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    );
  }
}

export interface ExecutionPlan {
  durationMs: number;
  willFail: boolean;
}

/** Decides how this attempt behaves. Runs inside the worker thread. */
export function planExecution(type: string, payload: Record<string, unknown>): ExecutionPlan {
  const profile = getProfile(type);
  const overrideDuration = payload.durationMs;
  const overrideFailureRate = payload.failureRate;

  const durationMs =
    typeof overrideDuration === 'number'
      ? overrideDuration
      : randomBetween(profile.minDurationMs, profile.maxDurationMs);

  const failureRate =
    typeof overrideFailureRate === 'number' ? overrideFailureRate : profile.failureRate;

  return { durationMs, willFail: Math.random() < failureRate };
}

function randomBetween(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min));
}
