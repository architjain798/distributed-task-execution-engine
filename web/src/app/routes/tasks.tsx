import { useState } from 'react';
import { ApiError } from '../../lib/api-client';
import { useTasks, type TaskListFilters } from '../../features/tasks/api/get-tasks';
import { TaskFilters } from '../../features/tasks/components/task-filters';
import { TaskTable } from '../../features/tasks/components/task-table';

const INITIAL_FILTERS: TaskListFilters = { page: 1, pageSize: 20 };

/**
 * Server-side filtering and pagination over the full history. This route is
 * query-driven, not stream-driven — the SSE hook invalidates it when a task
 * changes state, which is enough to keep it current without duplicating the
 * live store's job.
 */
export function TasksRoute() {
  const [filters, setFilters] = useState<TaskListFilters>(INITIAL_FILTERS);
  const { data, isLoading, error } = useTasks(filters);

  // Any change other than paging returns to the first page, or you end up
  // looking at page 7 of a 2-page result.
  const update = (next: Partial<TaskListFilters>) =>
    setFilters((current) => ({ ...current, ...next, page: next.page ?? 1 }));

  const total = data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / filters.pageSize));

  return (
    <div className="stack">
      <section className="card stack">
        <h2 className="card__title">Filter</h2>
        <TaskFilters filters={filters} onChange={update} />
      </section>

      <section className="card">
        {error !== null && (
          <p className="error-banner">
            {error instanceof ApiError ? error.message : 'Could not load tasks'}
          </p>
        )}

        {isLoading && data === undefined ? (
          <p className="empty">Loading…</p>
        ) : (
          <TaskTable tasks={data?.items ?? []} />
        )}

        <div className="pagination">
          <span className="muted">
            {total} task{total === 1 ? '' : 's'} · page {filters.page} of {lastPage}
          </span>
          <button
            type="button"
            className="button button--small"
            disabled={filters.page <= 1}
            onClick={() => update({ page: filters.page - 1 })}
          >
            Previous
          </button>
          <button
            type="button"
            className="button button--small"
            disabled={filters.page >= lastPage}
            onClick={() => update({ page: filters.page + 1 })}
          >
            Next
          </button>
        </div>
      </section>
    </div>
  );
}
