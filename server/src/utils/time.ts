/**
 * The MySQL driver runs with `dateStrings: true` and `timezone: 'Z'`, so
 * TIMESTAMP columns arrive as 'YYYY-MM-DD HH:MM:SS.mmm' in UTC. Everything
 * leaving the API is an ISO 8601 string.
 */
export function toIso(value: string | Date | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(`${value.replace(' ', 'T')}Z`).toISOString();
}

export function msBetween(
  from: string | Date | null | undefined,
  to: string | Date | null | undefined,
): number | null {
  const start = toIso(from);
  const end = toIso(to);
  if (start === null || end === null) return null;
  return new Date(end).getTime() - new Date(start).getTime();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retry backoff: 1s, 2s, 4s for attempts 1, 2, 3. */
export function backoffMs(attempts: number, baseMs: number): number {
  return baseMs * 2 ** Math.max(0, attempts - 1);
}
