import { QueryClient } from '@tanstack/react-query';

/**
 * Queried data is refetched when the SSE stream says something changed, so
 * polling is off everywhere. The dashboard never uses this client at all — live
 * state lives in the task store.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

export const queryKeys = {
  tasks: (filters: object) => ['tasks', filters] as const,
  analytics: (minutes: number) => ['analytics', minutes] as const,
  clients: ['clients'] as const,
};
