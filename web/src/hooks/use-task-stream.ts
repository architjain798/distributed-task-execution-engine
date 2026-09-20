import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Dashboard } from '@task-engine/shared';
import { serverEventSchema } from '@task-engine/shared';
import { API_BASE } from '../config/env';
import { apiFetch } from '../lib/api-client';
import { useApiKeyStore } from '../stores/api-key-store';
import { useTaskStore } from '../stores/task-store';

const EVENT_TYPES = ['task.created', 'task.updated', 'task.progress', 'workers.stats'] as const;

/**
 * Opens the single SSE connection for the whole app and feeds it into the task
 * store. Mounted once, by the provider.
 *
 * Every open — the first one and every automatic reconnect — refetches the
 * dashboard snapshot. That is the entire reconnection strategy: no event log, no
 * Last-Event-ID, and correct by construction.
 */
export function useTaskStream(): void {
  const apiKey = useApiKeyStore((state) => state.apiKey);
  const queryClient = useQueryClient();

  useEffect(() => {
    let closed = false;

    const hydrate = async () => {
      try {
        const dashboard = await apiFetch<Dashboard>('/dashboard');
        if (!closed) useTaskStore.getState().hydrate(dashboard);
      } catch {
        // The stream's own error handling surfaces the disconnection; a failed
        // snapshot just means the next open will try again.
      }
    };

    // EventSource cannot send headers, so the key travels as a query parameter
    // on this one endpoint. The server documents that concession.
    const source = new EventSource(`${API_BASE}/events?apiKey=${encodeURIComponent(apiKey)}`);

    source.onopen = () => {
      useTaskStore.getState().setConnected(true);
      void hydrate();
    };

    source.onerror = () => {
      useTaskStore.getState().setConnected(false);
    };

    for (const type of EVENT_TYPES) {
      source.addEventListener(type, (message) => {
        const parsed = serverEventSchema.safeParse(JSON.parse((message as MessageEvent<string>).data));
        if (!parsed.success) return;

        useTaskStore.getState().applyEvent(parsed.data);

        // Progress fires several times a second and changes nothing a query
        // cares about; lifecycle changes do.
        if (parsed.data.type === 'task.created' || parsed.data.type === 'task.updated') {
          void queryClient.invalidateQueries({ queryKey: ['tasks'] });
        }
      });
    }

    return () => {
      closed = true;
      source.close();
    };
  }, [apiKey, queryClient]);
}
