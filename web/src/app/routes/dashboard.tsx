import { DemoActions } from '../../components/layout/demo-actions';
import { StatusBoard } from '../../features/tasks/components/status-board';
import { SubmitTaskForm } from '../../features/tasks/components/submit-task-form';
import { WorkerStrip } from '../../features/workers/components/worker-strip';
import { useTaskStore } from '../../stores/task-store';

/**
 * The live view. Everything here reads the task store, which the SSE stream
 * feeds — no polling and no queries.
 */
export function DashboardRoute() {
  const hydrated = useTaskStore((state) => state.hydrated);

  return (
    <div className="stack">
      <DemoActions />
      <WorkerStrip />
      <SubmitTaskForm />

      {hydrated ? (
        <StatusBoard />
      ) : (
        <p className="empty">Loading the current state of the system…</p>
      )}
    </div>
  );
}
