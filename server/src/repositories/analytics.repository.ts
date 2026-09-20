import type { RowDataPacket } from 'mysql2';
import type {
  ExecutionTimeByType,
  FailureRateByType,
  ThroughputPoint,
  WaitTimeBucket,
} from '@task-engine/shared';
import type { Database } from '../lib/mysql.js';
import { toIso } from '../utils/time.js';

/**
 * Four aggregate queries over the live `tasks` table. Correct and simple at this
 * scale; at real volume these become rollup tables, which the README explains.
 *
 * All windows are relative to `finished_at` (or `started_at` for queue wait), so
 * the numbers describe work that actually completed in the period.
 */
export class AnalyticsRepository {
  constructor(private readonly db: Database) {}

  async executionTimeByType(minutes: number): Promise<ExecutionTimeByType[]> {
    const [rows] = await this.db.execute<RowDataPacket[]>(
      `SELECT type,
              AVG(TIMESTAMPDIFF(MICROSECOND, last_attempt_at, finished_at)) / 1000 AS avg_ms,
              MIN(TIMESTAMPDIFF(MICROSECOND, last_attempt_at, finished_at)) / 1000 AS min_ms,
              MAX(TIMESTAMPDIFF(MICROSECOND, last_attempt_at, finished_at)) / 1000 AS max_ms,
              COUNT(*) AS completed
         FROM tasks
        WHERE status = 'completed'
          AND finished_at >= DATE_SUB(NOW(3), INTERVAL ? MINUTE)
          AND last_attempt_at IS NOT NULL
        GROUP BY type
        ORDER BY type`,
      [minutes],
    );

    return rows.map((row) => ({
      type: row.type as string,
      avgMs: Math.round(Number(row.avg_ms)),
      minMs: Math.round(Number(row.min_ms)),
      maxMs: Math.round(Number(row.max_ms)),
      completed: Number(row.completed),
    }));
  }

  async throughput(minutes: number): Promise<ThroughputPoint[]> {
    const [rows] = await this.db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(finished_at, '%Y-%m-%d %H:%i:00') AS minute,
              COUNT(*) AS completed
         FROM tasks
        WHERE status = 'completed'
          AND finished_at >= DATE_SUB(NOW(3), INTERVAL ? MINUTE)
        GROUP BY minute
        ORDER BY minute`,
      [minutes],
    );

    return rows.map((row) => ({
      minute: toIso(row.minute as string) as string,
      completed: Number(row.completed),
    }));
  }

  /**
   * Cancellations are excluded from both numerator and denominator — a task the
   * operator stopped is not a failure of the system.
   */
  async failureRateByType(minutes: number): Promise<FailureRateByType[]> {
    const [rows] = await this.db.execute<RowDataPacket[]>(
      `SELECT type,
              COUNT(*) AS total,
              SUM(status IN ('failed', 'dead_letter')) AS failed
         FROM tasks
        WHERE status IN ('completed', 'failed', 'dead_letter')
          AND finished_at >= DATE_SUB(NOW(3), INTERVAL ? MINUTE)
        GROUP BY type
        ORDER BY type`,
      [minutes],
    );

    return rows.map((row) => {
      const total = Number(row.total);
      const failed = Number(row.failed);
      return {
        type: row.type as string,
        total,
        failed,
        failureRate: total === 0 ? 0 : Math.round((failed / total) * 1000) / 10,
      };
    });
  }

  async waitTimeDistribution(minutes: number): Promise<WaitTimeBucket[]> {
    const [rows] = await this.db.execute<RowDataPacket[]>(
      `SELECT bucket, bucket_order, COUNT(*) AS count
         FROM (
           SELECT CASE
                    WHEN wait_ms <   1000 THEN '<1s'
                    WHEN wait_ms <   5000 THEN '1-5s'
                    WHEN wait_ms <  15000 THEN '5-15s'
                    WHEN wait_ms <  30000 THEN '15-30s'
                    WHEN wait_ms <  60000 THEN '30-60s'
                    ELSE '>60s'
                  END AS bucket,
                  CASE
                    WHEN wait_ms <   1000 THEN 1
                    WHEN wait_ms <   5000 THEN 2
                    WHEN wait_ms <  15000 THEN 3
                    WHEN wait_ms <  30000 THEN 4
                    WHEN wait_ms <  60000 THEN 5
                    ELSE 6
                  END AS bucket_order
             FROM (
               SELECT TIMESTAMPDIFF(MICROSECOND, enqueued_at, started_at) / 1000 AS wait_ms
                 FROM tasks
                WHERE started_at IS NOT NULL
                  AND started_at >= DATE_SUB(NOW(3), INTERVAL ? MINUTE)
             ) AS waits
         ) AS buckets
        GROUP BY bucket, bucket_order
        ORDER BY bucket_order`,
      [minutes],
    );

    return rows.map((row) => ({
      bucket: row.bucket as string,
      count: Number(row.count),
    }));
  }
}
