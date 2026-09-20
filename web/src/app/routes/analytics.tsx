import { ANALYTICS_WINDOW_MINUTES } from '../../config/env';
import { ApiError } from '../../lib/api-client';
import { useAnalytics } from '../../features/analytics/api/get-analytics';
import { DurationChart } from '../../features/analytics/components/duration-chart';
import { FailureRateChart } from '../../features/analytics/components/failure-rate-chart';
import { ThroughputChart } from '../../features/analytics/components/throughput-chart';
import { WaitTimeHistogram } from '../../features/analytics/components/wait-time-histogram';

export function AnalyticsRoute() {
  const { data, isLoading, error } = useAnalytics(ANALYTICS_WINDOW_MINUTES);

  if (error !== null) {
    return (
      <p className="error-banner">
        {error instanceof ApiError ? error.message : 'Could not load analytics'}
      </p>
    );
  }

  if (isLoading || data === undefined) return <p className="empty">Loading analytics…</p>;

  return (
    <div className="stack">
      <p className="muted">Last {ANALYTICS_WINDOW_MINUTES} minutes.</p>

      <div className="charts">
        <section className="card">
          <h2 className="card__title">Throughput — tasks completed per minute</h2>
          <ThroughputChart data={data.throughput} />
        </section>

        <section className="card">
          <h2 className="card__title">Average execution time by type</h2>
          <DurationChart data={data.executionTimeByType} />
        </section>

        <section className="card">
          <h2 className="card__title">Failure rate by type</h2>
          <FailureRateChart data={data.failureRateByType} />
        </section>

        <section className="card">
          <h2 className="card__title">Queue wait time distribution</h2>
          <WaitTimeHistogram data={data.waitTimeDistribution} />
        </section>
      </div>
    </div>
  );
}
