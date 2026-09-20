import { useQuery } from '@tanstack/react-query';
import type { Analytics } from '@task-engine/shared';
import { apiFetch, buildQuery } from '../../../lib/api-client';
import { queryKeys } from '../../../lib/react-query';

/**
 * Aggregates are computed in SQL per request. They are cheap at this scale and
 * refetching on an interval keeps the charts moving during a demo without
 * needing their own event type.
 */
export function useAnalytics(minutes: number) {
  return useQuery({
    queryKey: queryKeys.analytics(minutes),
    queryFn: () => apiFetch<Analytics>(`/analytics${buildQuery({ minutes })}`),
    refetchInterval: 10_000,
  });
}
