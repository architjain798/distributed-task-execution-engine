/** Every Redis key the system uses, in one place. */
export const redisKeys = {
  /** ZSET of queued task ids for one client. Score packs priority and age. */
  queue: (clientId: string) => `queue:${clientId}`,

  /** SET of client ids with a non-empty queue. The scheduler's candidate list. */
  activeClients: 'clients:active',

  /** Latest progress for a running task, so a page refresh is accurate. */
  progress: (taskId: string) => `progress:${taskId}`,

  /** Sliding-window log of submission timestamps for one client. */
  rateLimit: (clientId: string) => `ratelimit:${clientId}`,

  /** Worker pool utilisation heartbeat. Absence means the worker is down. */
  workerStats: 'workers:stats',

  /** Worker → API. Task lifecycle and progress, fanned out over SSE. */
  eventsChannel: 'channel:events',

  /** API → worker. Cancellation of a task that is already running. */
  controlChannel: 'channel:control',
} as const;
