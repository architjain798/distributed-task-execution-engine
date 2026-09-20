import type { Request, Response } from 'express';
import type { AnalyticsQuery } from '@task-engine/shared';
import { validated } from '../middlewares/validate.middleware.js';
import type { AnalyticsService } from '../services/analytics.service.js';

export function createAnalyticsController(analytics: AnalyticsService) {
  return {
    summary: async (req: Request, res: Response): Promise<void> => {
      const { minutes } = validated<AnalyticsQuery>(req, 'query');
      res.json(await analytics.summary(minutes));
    },
  };
}
