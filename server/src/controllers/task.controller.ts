import type { Request, Response } from 'express';
import type { CreateTaskInput, TaskFilter } from '@task-engine/shared';
import { requireClient } from '../middlewares/auth.middleware.js';
import { validated } from '../middlewares/validate.middleware.js';
import type { TaskIdParams } from '../schemas/task.schema.js';
import type { TaskService } from '../services/task.service.js';

/**
 * HTTP in, HTTP out. Every one of these is a plain async function that throws —
 * Express 5 routes rejections to the error middleware on its own.
 */
export function createTaskController(tasks: TaskService) {
  return {
    create: async (req: Request, res: Response): Promise<void> => {
      const client = requireClient(req);
      const input = validated<CreateTaskInput>(req, 'body');
      res.status(201).json(await tasks.create(client, input));
    },

    list: async (req: Request, res: Response): Promise<void> => {
      res.json(await tasks.list(validated<TaskFilter>(req, 'query')));
    },

    getById: async (req: Request, res: Response): Promise<void> => {
      const { id } = validated<TaskIdParams>(req, 'params');
      res.json(await tasks.getById(id));
    },

    cancel: async (req: Request, res: Response): Promise<void> => {
      const { id } = validated<TaskIdParams>(req, 'params');
      res.json(await tasks.cancel(id));
    },

    retry: async (req: Request, res: Response): Promise<void> => {
      const { id } = validated<TaskIdParams>(req, 'params');
      res.json(await tasks.retry(id));
    },

    dashboard: async (_req: Request, res: Response): Promise<void> => {
      res.json(await tasks.dashboard());
    },
  };
}
