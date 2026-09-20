/**
 * The app always talks to a relative /api path: Vite proxies it in development,
 * nginx proxies it in the container. There is no API base URL to configure and
 * therefore none to get wrong.
 */
export const API_BASE = '/api';

/** Used until the operator picks a different client from the header. */
export const DEFAULT_API_KEY = 'acme-key-001';

/** Analytics window, in minutes. */
export const ANALYTICS_WINDOW_MINUTES = 60;
