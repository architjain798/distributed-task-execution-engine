import type { Task } from '@task-engine/shared';
import { EmptyState } from '../../../components/ui/empty-state';
import { StatusBadge } from '../../../components/ui/status-badge';
import { formatDuration, formatTime, shortId } from '../../../utils/format';
import { useCancelTask } from '../api/cancel-task';
import { useRetryTask } from '../api/retry-task';

const CANCELLABLE = new Set(['queued', 'running']);

export function TaskTable({ tasks }: { tasks: Task[] }) {
  const cancel = useCancelTask();
  const retry = useRetryTask();

  if (tasks.length === 0) return <EmptyState message="No tasks match these filters" />;

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Id</th>
            <th>Type</th>
            <th>Client</th>
            <th>Priority</th>
            <th>Status</th>
            <th>Attempts</th>
            <th>Wait</th>
            <th>Duration</th>
            <th>Created</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <tr key={task.id}>
              <td className="mono">{shortId(task.id)}</td>
              <td>{task.type}</td>
              <td>{task.clientName}</td>
              <td>{task.priority}</td>
              <td>
                <StatusBadge status={task.status} />
              </td>
              <td>
                {task.attempts}/{task.maxAttempts}
              </td>
              <td>{formatDuration(task.waitMs)}</td>
              <td>{formatDuration(task.durationMs)}</td>
              <td className="muted">{formatTime(task.enqueuedAt)}</td>
              <td>
                {CANCELLABLE.has(task.status) && (
                  <button
                    type="button"
                    className="button button--small button--danger"
                    onClick={() => cancel.mutate(task.id)}
                  >
                    Cancel
                  </button>
                )}
                {task.status === 'dead_letter' && (
                  <button
                    type="button"
                    className="button button--small"
                    onClick={() => retry.mutate(task.id)}
                  >
                    Retry
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
