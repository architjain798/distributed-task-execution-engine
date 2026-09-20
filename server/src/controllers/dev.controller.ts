import type { Request, Response } from 'express';
import type { ClientRepository } from '../repositories/client.repository.js';
import type { EventBus } from '../events/event-bus.js';
import type { SeedService } from '../services/seed.service.js';

/**
 * Demo affordances, enabled by ENABLE_DEV_ROUTES.
 *
 * `kill-worker` exists because crash recovery is the deepest thing this system
 * does and it is otherwise invisible — a reviewer can trigger a thread death and
 * watch the task be retried instead of taking the README's word for it.
 */
export function createDevController(
  seed: SeedService,
  clients: ClientRepository,
  events: EventBus,
) {
  return {
    async seed(_req: Request, res: Response): Promise<void> {
      res.status(201).json(await seed.seed());
    },

    /**
     * The worker threads live in the other container, so this asks rather than
     * acts — hence 202 and no task id in the response.
     */
    async killWorker(_req: Request, res: Response): Promise<void> {
      await events.publishControl({ type: 'worker.kill' });
      res.status(202).json({ message: 'Kill signal sent to the worker process' });
    },

    /** Lets the UI offer an API key picker so fairness can be demonstrated. */
    async listClients(_req: Request, res: Response): Promise<void> {
      res.json(await clients.findAll());
    },
  };
}
