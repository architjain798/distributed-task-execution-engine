import { z } from 'zod';

/**
 * Request shapes that only the server cares about. Everything describing the
 * task itself lives in @task-engine/shared, so the browser validates against
 * the same definitions.
 */
export const taskIdParamsSchema = z.object({
  id: z.uuid('Task id must be a UUID'),
});

export type TaskIdParams = z.infer<typeof taskIdParamsSchema>;
