import { useMemo } from 'react';
import type { TaskStatus } from '@task-engine/shared';
import { groupByStatus, useTaskStore } from '../../../stores/task-store';
import { StatusColumn } from './status-column';

/**
 * The five columns the brief asks for. `cancelling` tasks are shown in the
 * running column because that is where they still are — a thread is holding
 * them until it acknowledges the stop.
 */
const COLUMNS: Array<{ status: TaskStatus; include: TaskStatus[] }> = [
  { status: 'queued', include: ['queued'] },
  { status: 'running', include: ['running', 'cancelling'] },
  { status: 'completed', include: ['completed'] },
  { status: 'failed', include: ['failed', 'cancelled'] },
  { status: 'dead_letter', include: ['dead_letter'] },
];

export function StatusBoard() {
  const tasks = useTaskStore((state) => state.tasks);
  const grouped = useMemo(() => groupByStatus(tasks), [tasks]);

  return (
    <div className="board">
      {COLUMNS.map((column) => (
        <StatusColumn
          key={column.status}
          status={column.status}
          tasks={column.include.flatMap((status) => grouped[status])}
        />
      ))}
    </div>
  );
}
