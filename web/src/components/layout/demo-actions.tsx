import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api-client';

/**
 * Two demo affordances.
 *
 * Seeding puts the system under a load whose distribution demonstrates fairness.
 * Killing a worker triggers the crash recovery path on demand — otherwise the
 * deepest behaviour in the system is invisible unless something happens to go
 * wrong while someone is watching.
 */
export function DemoActions() {
  const queryClient = useQueryClient();

  const seed = useMutation({
    mutationFn: () => apiFetch<{ created: number }>('/dev/seed', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  });

  const killWorker = useMutation({
    mutationFn: () => apiFetch<{ message: string }>('/dev/kill-worker', { method: 'POST' }),
  });

  return (
    <div className="row">
      <button
        type="button"
        className="button"
        disabled={seed.isPending}
        onClick={() => seed.mutate()}
      >
        {seed.isPending ? 'Seeding…' : 'Seed 60 tasks'}
      </button>

      <button
        type="button"
        className="button button--danger"
        disabled={killWorker.isPending}
        onClick={() => killWorker.mutate()}
      >
        Kill a worker thread
      </button>

      {seed.isSuccess && <span className="muted">Created {seed.data.created} tasks.</span>}
      {killWorker.isSuccess && <span className="muted">Kill signal sent — watch for a retry.</span>}
    </div>
  );
}
