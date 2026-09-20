import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Task } from '@task-engine/shared';
import { apiFetch } from '../../../lib/api-client';

/** Only dead-lettered tasks can be retried; the server returns 409 otherwise. */
export function useRetryTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (taskId: string) => apiFetch<Task>(`/tasks/${taskId}/retry`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  });
}
