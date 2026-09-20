import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Task } from '@task-engine/shared';
import { apiFetch } from '../../../lib/api-client';

export function useCancelTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (taskId: string) =>
      apiFetch<Task>(`/tasks/${taskId}/cancel`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  });
}
