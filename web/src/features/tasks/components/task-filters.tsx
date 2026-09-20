import { TASK_STATUSES, TASK_TYPES } from '@task-engine/shared';
import { statusLabel } from '../../../utils/format';
import type { TaskListFilters } from '../api/get-tasks';

interface Props {
  filters: TaskListFilters;
  onChange: (next: Partial<TaskListFilters>) => void;
}

export function TaskFilters({ filters, onChange }: Props) {
  return (
    <div className="row">
      <div className="field">
        <label htmlFor="filter-search">Search</label>
        <input
          id="filter-search"
          className="input"
          placeholder="id, type or client"
          value={filters.search ?? ''}
          onChange={(event) => onChange({ search: event.target.value })}
        />
      </div>

      <div className="field">
        <label htmlFor="filter-status">Status</label>
        <select
          id="filter-status"
          className="select"
          value={filters.status ?? ''}
          onChange={(event) => onChange({ status: event.target.value || undefined })}
        >
          <option value="">All</option>
          {TASK_STATUSES.map((status) => (
            <option key={status} value={status}>
              {statusLabel(status)}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="filter-type">Type</label>
        <select
          id="filter-type"
          className="select"
          value={filters.type ?? ''}
          onChange={(event) => onChange({ type: event.target.value || undefined })}
        >
          <option value="">All</option>
          {TASK_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="filter-priority">Priority</label>
        <select
          id="filter-priority"
          className="select"
          value={filters.priority ?? ''}
          onChange={(event) =>
            onChange({
              priority: event.target.value === '' ? undefined : Number(event.target.value),
            })
          }
        >
          <option value="">All</option>
          {[5, 4, 3, 2, 1].map((priority) => (
            <option key={priority} value={priority}>
              {priority}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
