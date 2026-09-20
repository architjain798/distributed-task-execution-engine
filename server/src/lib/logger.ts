import { pino } from 'pino';
import { env } from '../config/env.js';

/**
 * JSON logs on stdout. No pretty-printing even in development: the point of
 * structured logging is that the same lines are parseable everywhere.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: process.env.SERVICE_NAME ?? 'api' },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label }),
  },
});

export type Logger = typeof logger;
