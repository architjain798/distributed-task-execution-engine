import type { Task } from '@task-engine/shared';
import { ProgressBar } from '../../../components/ui/progress-bar';
import { formatDuration, formatRelative, shortId } from '../../../utils/format';
import { useCancelTask } from '../api/cancel-task';
import { useRetryTask } from '../api/retry-task';

const CANCELLABLE = new Set(['queued', 'running']);

export function TaskCard({ task }: { task: Task }) {
  const cancel = useCancelTask();
  const retry = useRetryTask();

  return (
    <article
      className="task-card"
      style={{ '--status-color': `var(--status-${task.status})` } as React.CSSProperties}
    >
      <div className="task-card__top">
        <span className="task-card__type">{task.type}</span>
        <span className="muted mono">P{task.priority}</span>
      </div>

      <div className="task-card__meta">
        <span className="mono">{shortId(task.id)}</span>
        <span>{task.clientName}</span>
      </div>

      {task.status === 'running' && <ProgressBar value={task.progress} />}

      <div className="task-card__meta">
        <span>
          {task.status === 'queued'
            ? `queued ${formatRelative(task.enqueuedAt)}`
            : task.status === 'running'
              ? `${task.progress}%`
              : formatDuration(task.durationMs)}
        </span>
        {task.attempts > 1 && <span>attempt {task.attempts}</span>}
      </div>

      {task.lastError !== null && <p className="task-card__error">{task.lastError}</p>}

      {CANCELLABLE.has(task.status) && (
        <button
          type="button"
          className="button button--small button--danger"
          disabled={cancel.isPending}
          onClick={() => cancel.mutate(task.id)}
        >
          Cancel
        </button>
      )}

      {task.status === 'dead_letter' && (
        <button
          type="button"
          className="button button--small"
          disabled={retry.isPending}
          onClick={() => retry.mutate(task.id)}
        >
          Retry
        </button>
      )}
    </article>
  );
}
