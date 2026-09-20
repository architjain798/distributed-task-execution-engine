import { useQuery } from '@tanstack/react-query';
import type { Client } from '@task-engine/shared';
import { apiFetch } from '../../lib/api-client';
import { queryKeys } from '../../lib/react-query';
import { useApiKeyStore } from '../../stores/api-key-store';

/**
 * Switches which client the browser acts as.
 *
 * This is what makes fair scheduling observable: flood the queue as one client,
 * switch, submit a single task as another, and watch it start within a round
 * instead of queueing behind the flood.
 */
export function ApiKeyPicker() {
  const apiKey = useApiKeyStore((state) => state.apiKey);
  const setApiKey = useApiKeyStore((state) => state.setApiKey);

  const { data: clients = [] } = useQuery({
    queryKey: queryKeys.clients,
    queryFn: () => apiFetch<Client[]>('/dev/clients'),
    staleTime: Infinity,
  });

  return (
    <label className="row">
      <span className="muted">Acting as</span>
      <select
        className="select"
        value={apiKey}
        onChange={(event) => setApiKey(event.target.value)}
        aria-label="Client API key"
      >
        {clients.length === 0 && <option value={apiKey}>{apiKey}</option>}
        {clients.map((client) => (
          <option key={client.id} value={client.apiKey}>
            {client.name} (weight {client.weight})
          </option>
        ))}
      </select>
    </label>
  );
}
