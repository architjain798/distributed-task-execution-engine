import type { Analytics } from '@task-engine/shared';
import type { AnalyticsRepository } from '../repositories/analytics.repository.js';

/**
 * Four independent aggregates, issued together. They share nothing, so running
 * them in parallel costs one round trip instead of four.
 */
export class AnalyticsService {
  constructor(private readonly analytics: AnalyticsRepository) {}

  async summary(minutes: number): Promise<Analytics> {
    const [executionTimeByType, throughput, failureRateByType, waitTimeDistribution] =
      await Promise.all([
        this.analytics.executionTimeByType(minutes),
        this.analytics.throughput(minutes),
        this.analytics.failureRateByType(minutes),
        this.analytics.waitTimeDistribution(minutes),
      ]);

    return { executionTimeByType, throughput, failureRateByType, waitTimeDistribution };
  }
}
