import { z } from 'zod';

export const executionTimeByTypeSchema = z.object({
  type: z.string(),
  avgMs: z.number(),
  minMs: z.number(),
  maxMs: z.number(),
  completed: z.number().int(),
});

export const throughputPointSchema = z.object({
  /** Minute bucket, ISO string. */
  minute: z.string(),
  completed: z.number().int(),
});

export const failureRateByTypeSchema = z.object({
  type: z.string(),
  total: z.number().int(),
  failed: z.number().int(),
  /** Percentage, 0-100. Counts `failed` and `dead_letter`, not cancellations. */
  failureRate: z.number(),
});

export const waitTimeBucketSchema = z.object({
  bucket: z.string(),
  count: z.number().int(),
});

export const analyticsSchema = z.object({
  executionTimeByType: z.array(executionTimeByTypeSchema),
  throughput: z.array(throughputPointSchema),
  failureRateByType: z.array(failureRateByTypeSchema),
  waitTimeDistribution: z.array(waitTimeBucketSchema),
});

export const analyticsQuerySchema = z.object({
  /** Defaults to the last hour, which is the useful window for a live demo. */
  minutes: z.coerce.number().int().min(1).max(1440).default(60),
});

export type ExecutionTimeByType = z.infer<typeof executionTimeByTypeSchema>;
export type ThroughputPoint = z.infer<typeof throughputPointSchema>;
export type FailureRateByType = z.infer<typeof failureRateByTypeSchema>;
export type WaitTimeBucket = z.infer<typeof waitTimeBucketSchema>;
export type Analytics = z.infer<typeof analyticsSchema>;
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;
