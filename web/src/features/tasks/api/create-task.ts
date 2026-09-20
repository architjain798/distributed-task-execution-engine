import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CreateTaskInput, Task } from '@task-engine/shared';
import { apiFetch } from '../../../lib/api-client';

export function useCreateTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateTaskInput) =>
      apiFetch<Task>('/tasks', { method: 'POST', body: JSON.stringify(input) }),
    // The SSE event updates the live board on its own; this refreshes the
    // paginated list, which the stream does not own.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  });
}
