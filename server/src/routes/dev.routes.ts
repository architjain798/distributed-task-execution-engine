import { Router } from 'express';
import { createDevController } from '../controllers/dev.controller.js';
import type { ApiContainer } from '../container.js';

/** Mounted only when ENABLE_DEV_ROUTES is true. */
export function devRoutes(container: ApiContainer): Router {
  const router = Router();
  const controller = createDevController(
    container.seedService,
    container.clients,
    container.events,
  );

  router.post('/seed', controller.seed);
  router.post('/kill-worker', controller.killWorker);
  router.get('/clients', controller.listClients);

  return router;
}
