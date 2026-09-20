/** How long a worker holds a task before the reaper considers it abandoned. */
export const LEASE_TTL_MS = 60_000;

/** A running task renews its lease this often. Comfortably inside LEASE_TTL_MS. */
export const LEASE_HEARTBEAT_MS = 15_000;

/** How often expired leases are swept. Bounds recovery time after a container dies. */
export const REAPER_INTERVAL_MS = 10_000;

/** How often MySQL and the Redis ready queues are compared and repaired. */
export const RECONCILER_INTERVAL_MS = 30_000;

/** One dispatch costs this much of a client's deficit. See FairScheduler. */
export const DISPATCH_COST = 1;

/** Dispatcher pause when there is nothing to dispatch. Bounds submit-to-start latency. */
export const DISPATCH_IDLE_MS = 200;

/** A cancelled task gets this long to stop cooperatively before the thread is terminated. */
export const CANCEL_GRACE_MS = 2_000;

/** How often a running task checks for cancellation and advances its progress. */
export const PROGRESS_TICK_MS = 250;

/** Progress events are throttled to this, regardless of tick rate. */
export const PROGRESS_PUBLISH_MS = 1_000;

/** SSE comment frequency, to stop proxies closing idle connections. */
export const SSE_HEARTBEAT_MS = 15_000;

/** One initial attempt plus three retries. */
export const DEFAULT_MAX_ATTEMPTS = 4;

/** Retry backoff is BACKOFF_BASE_MS * 2^(attempts-1): 1s, 2s, 4s. */
export const BACKOFF_BASE_MS = 1_000;

/** Terminal tasks included in the dashboard snapshot. Keeps the live store bounded. */
export const RECENT_TERMINAL_LIMIT = 50;

/** Live progress outlives no task; an hour is generous. */
export const PROGRESS_TTL_SECONDS = 3_600;

/** Worker stats are a heartbeat — expiry is how the UI learns the worker is gone. */
export const WORKER_STATS_TTL_SECONDS = 10;
export const WORKER_STATS_INTERVAL_MS = 2_000;

/** Score packing for the ready queue: priority dominates, older wins within a priority. */
export const PRIORITY_SCORE_MULTIPLIER = 1e13;
