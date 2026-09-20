import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { useTaskStream } from '../hooks/use-task-stream';
import { queryClient } from '../lib/react-query';

/**
 * The SSE connection is opened here, inside the query provider, so that exactly
 * one stream exists for the whole app and stream events can invalidate queries.
 */
function TaskStream({ children }: { children: ReactNode }) {
  useTaskStream();
  return <>{children}</>;
}

export function AppProvider({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <TaskStream>{children}</TaskStream>
    </QueryClientProvider>
  );
}
