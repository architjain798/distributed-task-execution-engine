import { TASK_TYPES } from '@task-engine/shared';
import { logger } from '../lib/logger.js';
import type { ClientRepository } from '../repositories/client.repository.js';
import type { TaskService } from './task.service.js';

/**
 * Generates a load that demonstrates the system rather than merely filling the
 * table.
 *
 * The distribution is deliberate: the first client floods the queue with
 * priority-5 work while the others submit a handful each. Without fair
 * scheduling the small clients would wait behind all of it; with DRR their
 * tasks start within a round. That contrast is the point of the seed.
 */
interface ClientPlan {
  taskCount: number;
  priorities: number[];
}

const PLANS: ClientPlan[] = [
  { taskCount: 30, priorities: [5] }, // the flooder
  { taskCount: 10, priorities: [1, 2, 3] },
  { taskCount: 12, priorities: [2, 4] },
  { taskCount: 8, priorities: [1, 3, 5] },
];

export class SeedService {
  constructor(
    private readonly clients: ClientRepository,
    private readonly tasks: TaskService,
  ) {}

  async seed(): Promise<{ created: number; byClient: Record<string, number> }> {
    const clients = await this.clients.findAll();
    const byClient: Record<string, number> = {};
    let created = 0;

    for (const [index, client] of clients.entries()) {
      const plan = PLANS[index % PLANS.length] as ClientPlan;

      for (let n = 0; n < plan.taskCount; n += 1) {
        const type = TASK_TYPES[n % TASK_TYPES.length] as string;
        const priority = plan.priorities[n % plan.priorities.length] as number;

        await this.tasks.create(client, {
          type,
          priority,
          payload: buildPayload(type, n),
        });

        created += 1;
      }

      byClient[client.name] = plan.taskCount;
    }

    logger.info({ created, byClient }, 'seed complete');
    return { created, byClient };
  }
}

/**
 * Payloads look like the real thing and stay inside each type's schema. Duration
 * is shortened so a demo does not take twenty minutes to show a full lifecycle.
 */
function buildPayload(type: string, index: number): Record<string, unknown> {
  const base = { durationMs: 3_000 + ((index * 977) % 9_000) };

  switch (type) {
    case 'image-processing':
      return { ...base, imageUrl: `https://example.test/photo-${index}.jpg`, width: 1920, height: 1080 };
    case 'report-generation':
      return { ...base, reportType: index % 2 === 0 ? 'monthly' : 'weekly', rangeDays: 30 };
    case 'data-import':
      return { ...base, source: `s3://imports/batch-${index}.csv`, rows: 500 + index * 25 };
    default:
      return { ...base, template: 'welcome', recipients: 100 + index };
  }
}
