import { z } from 'zod';

/**
 * Environment is parsed once, at boot, and the process refuses to start if it
 * is wrong. Finding out about a bad DB password at startup beats finding out
 * when the first task tries to run.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['silent', 'fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  MYSQL_HOST: z.string().min(1).default('localhost'),
  MYSQL_PORT: z.coerce.number().int().default(3306),
  MYSQL_USER: z.string().min(1).default('root'),
  MYSQL_PASSWORD: z.string().default('root'),
  MYSQL_DATABASE: z.string().min(1).default('task_engine'),
  MYSQL_POOL_SIZE: z.coerce.number().int().min(1).max(50).default(10),

  REDIS_HOST: z.string().min(1).default('localhost'),
  REDIS_PORT: z.coerce.number().int().default(6379),

  /** Worker threads in the pool. Also the concurrency limit: one task per thread. */
  WORKER_COUNT: z.coerce.number().int().min(1).max(32).default(4),
  /** Identifies this worker process in task leases. */
  WORKER_ID: z.string().min(1).default('worker-1'),

  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60_000),

  /** Enables /api/dev/* — seeding and the deliberate worker kill. */
  ENABLE_DEV_ROUTES: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    // Logger depends on env, so this one message has to use the console.
    console.error(`Invalid environment configuration:\n${problems}`);
    process.exit(1);
  }

  return result.data;
}

export const env = loadEnv();
