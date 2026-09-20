import { Router } from 'express';
import { analyticsQuerySchema } from '@task-engine/shared';
import { createAnalyticsController } from '../controllers/analytics.controller.js';
import { validate } from '../middlewares/validate.middleware.js';
import type { ApiContainer } from '../container.js';

export function analyticsRoutes(container: ApiContainer): Router {
  const router = Router();
  const controller = createAnalyticsController(container.analyticsService);

  router.get('/', validate({ query: analyticsQuerySchema }), controller.summary);

  return router;
}
