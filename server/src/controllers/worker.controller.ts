import type { Request, Response } from 'express';
import type { TaskService } from '../services/task.service.js';

export function createWorkerController(tasks: TaskService) {
  return {
    stats: async (_req: Request, res: Response): Promise<void> => {
      res.json(await tasks.workerStats());
    },
  };
}
