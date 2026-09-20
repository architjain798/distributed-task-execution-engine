import { Router } from 'express';
import { createTaskSchema, taskFilterSchema } from '@task-engine/shared';
import { createTaskController } from '../controllers/task.controller.js';
import { rateLimitMiddleware } from '../middlewares/rate-limit.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { taskIdParamsSchema } from '../schemas/task.schema.js';
import type { ApiContainer } from '../container.js';

/**
 * URL to controller. No logic lives here — if a route file grows a condition,
 * it belongs in a service.
 */
export function taskRoutes(container: ApiContainer): Router {
  const router = Router();
  const controller = createTaskController(container.taskService);

  // Only submission is rate limited. Limiting reads would make the dashboard
  // unusable and protects nothing.
  router.post(
    '/',
    rateLimitMiddleware(container.rateLimiter),
    validate({ body: createTaskSchema }),
    controller.create,
  );

  router.get('/', validate({ query: taskFilterSchema }), controller.list);
  router.get('/:id', validate({ params: taskIdParamsSchema }), controller.getById);
  router.post('/:id/cancel', validate({ params: taskIdParamsSchema }), controller.cancel);
  router.post('/:id/retry', validate({ params: taskIdParamsSchema }), controller.retry);

  return router;
}
