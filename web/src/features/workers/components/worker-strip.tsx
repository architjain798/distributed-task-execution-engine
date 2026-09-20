import { useTaskStore } from '../../../stores/task-store';
import { formatRelative } from '../../../utils/format';

/**
 * Worker utilisation. The stats key on the server carries a short TTL, so
 * `updatedAt === null` means the worker process is gone rather than idle — a
 * distinction worth showing.
 */
export function WorkerStrip() {
  const workers = useTaskStore((state) => state.workers);
  const offline = workers.updatedAt === null;

  return (
    <section className="card">
      <h2 className="card__title">Worker pool</h2>

      <div className="workers">
        <div className="workers__metric">
          <span className="workers__value" style={{ color: 'var(--status-running)' }}>
            {workers.busy}
          </span>
          <span className="workers__label">busy</span>
        </div>

        <div className="workers__metric">
          <span className="workers__value">{workers.idle}</span>
          <span className="workers__label">idle</span>
        </div>

        <div className="workers__bar">
          {Array.from({ length: workers.total }, (_, index) => (
            <span
              key={index}
              style={{
                flex: 1,
                background: index < workers.busy ? 'var(--status-running)' : 'transparent',
                borderRight: '1px solid var(--bg)',
              }}
            />
          ))}
        </div>

        <span className="muted">
          {offline ? 'worker offline' : `updated ${formatRelative(workers.updatedAt)}`}
        </span>
      </div>
    </section>
  );
}
