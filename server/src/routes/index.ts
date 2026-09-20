import { Router } from 'express';
import { env } from '../config/env.js';
import { createEventController } from '../controllers/event.controller.js';
import { createHealthController } from '../controllers/health.controller.js';
import { createTaskController } from '../controllers/task.controller.js';
import { createWorkerController } from '../controllers/worker.controller.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import type { ApiContainer } from '../container.js';
import { analyticsRoutes } from './analytics.routes.js';
import { devRoutes } from './dev.routes.js';
import { taskRoutes } from './task.routes.js';

export function apiRoutes(container: ApiContainer): Router {
  const router = Router();

  const health = createHealthController(container.db, container.redis);
  const tasks = createTaskController(container.taskService);
  const workers = createWorkerController(container.taskService);
  const events = createEventController(container.sseHub);

  // Unauthenticated: compose and load balancers need it before any key exists.
  router.get('/health', health.check);

  router.use(authMiddleware(container.clients));

  router.use('/tasks', taskRoutes(container));
  router.use('/analytics', analyticsRoutes(container));
  router.get('/dashboard', tasks.dashboard);
  router.get('/workers', workers.stats);
  router.get('/events', events.stream);

  if (env.ENABLE_DEV_ROUTES) {
    router.use('/dev', devRoutes(container));
  }

  return router;
}
