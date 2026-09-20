import { useQuery } from '@tanstack/react-query';
import type { PaginatedTasks } from '@task-engine/shared';
import { apiFetch, buildQuery } from '../../../lib/api-client';
import { queryKeys } from '../../../lib/react-query';

export interface TaskListFilters {
  status?: string;
  type?: string;
  priority?: number;
  search?: string;
  page: number;
  pageSize: number;
}

/**
 * Server-side filtering and pagination. Deliberately not the live store: this
 * view can show thousands of historic tasks, which have no business being held
 * in memory.
 */
export function useTasks(filters: TaskListFilters) {
  return useQuery({
    queryKey: queryKeys.tasks(filters),
    queryFn: () => apiFetch<PaginatedTasks>(`/tasks${buildQuery({ ...filters })}`),
    placeholderData: (previous) => previous,
  });
}
