import type { Task, TaskStatus } from '@task-engine/shared';
import { EmptyState } from '../../../components/ui/empty-state';
import { statusLabel } from '../../../utils/format';
import { TaskCard } from './task-card';

/** Cards rendered per column. Deeper history belongs on the Tasks page. */
const VISIBLE_LIMIT = 40;

export function StatusColumn({ status, tasks }: { status: TaskStatus; tasks: Task[] }) {
  return (
    <section className="card">
      <header className="column__header">
        <h2 className="card__title" style={{ margin: 0, color: `var(--status-${status})` }}>
          {statusLabel(status)}
        </h2>
        <span className="column__count">{tasks.length}</span>
      </header>

      <div className="column__body">
        {tasks.length === 0 && <EmptyState message="Nothing here" />}
        {tasks.slice(0, VISIBLE_LIMIT).map((task) => (
          <TaskCard key={task.id} task={task} />
        ))}
      </div>
    </section>
  );
}
