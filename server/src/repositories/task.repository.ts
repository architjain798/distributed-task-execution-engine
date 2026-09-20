import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import type { Task, TaskFilter, TaskStatus } from '@task-engine/shared';
import { ACTIVE_STATUSES, TERMINAL_STATUSES } from '@task-engine/shared';
import type { Database } from '../lib/mysql.js';
import { msBetween, toIso } from '../utils/time.js';

export interface TaskRow extends RowDataPacket {
  id: string;
  client_id: string;
  client_name: string;
  type: string;
  priority: number;
  payload: Record<string, unknown>;
  status: TaskStatus;
  attempts: number;
  max_attempts: number;
  worker_id: string | null;
  lease_expires_at: string | null;
  last_error: string | null;
  result: Record<string, unknown> | null;
  enqueued_at: string;
  started_at: string | null;
  last_attempt_at: string | null;
  finished_at: string | null;
}

export interface NewTask {
  id: string;
  clientId: string;
  type: string;
  priority: number;
  payload: Record<string, unknown>;
  maxAttempts: number;
}

const SELECT_TASK = `
  SELECT t.id, t.client_id, c.name AS client_name, t.type, t.priority, t.payload,
         t.status, t.attempts, t.max_attempts, t.worker_id, t.lease_expires_at,
         t.last_error, t.result, t.enqueued_at, t.started_at, t.last_attempt_at,
         t.finished_at
    FROM tasks t
    JOIN clients c ON c.id = t.client_id`;

/**
 * Database row to wire format. `progress` is not a column — it lives in Redis
 * and is merged in by the service, defaulting to 0 (queued) or 100 (completed).
 */
export function toTask(row: TaskRow, progress: number): Task {
  return {
    id: row.id,
    clientId: row.client_id,
    clientName: row.client_name,
    type: row.type,
    priority: row.priority,
    payload: row.payload ?? {},
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    progress,
    lastError: row.last_error,
    result: row.result,
    enqueuedAt: toIso(row.enqueued_at) as string,
    startedAt: toIso(row.started_at),
    finishedAt: toIso(row.finished_at),
    // Wait is measured to the first attempt, execution over the attempt that
    // finished — so retries inflate neither number.
    waitMs: msBetween(row.enqueued_at, row.started_at),
    durationMs: msBetween(row.last_attempt_at, row.finished_at),
  };
}

/**
 * Progress is not a column. A completed task is always 100%, a queued one is
 * always 0%, and anything in between comes from Redis.
 */
export function progressFor(status: TaskStatus, stored: number | null | undefined): number {
  if (status === 'completed') return 100;
  if (status === 'queued') return 0;
  return stored ?? 0;
}

export class TaskRepository {
  constructor(private readonly db: Database) {}

  async insert(task: NewTask): Promise<TaskRow> {
    await this.db.execute(
      `INSERT INTO tasks (id, client_id, type, priority, payload, status, max_attempts, enqueued_at)
       VALUES (?, ?, ?, ?, CAST(? AS JSON), 'queued', ?, NOW(3))`,
      [
        task.id,
        task.clientId,
        task.type,
        task.priority,
        JSON.stringify(task.payload),
        task.maxAttempts,
      ],
    );
    const row = await this.findById(task.id);
    if (row === null) throw new Error(`task ${task.id} vanished immediately after insert`);
    return row;
  }

  async findById(id: string): Promise<TaskRow | null> {
    const [rows] = await this.db.execute<TaskRow[]>(`${SELECT_TASK} WHERE t.id = ?`, [id]);
    return rows[0] ?? null;
  }

  async findManyByIds(ids: string[]): Promise<TaskRow[]> {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(', ');
    const [rows] = await this.db.execute<TaskRow[]>(
      `${SELECT_TASK} WHERE t.id IN (${placeholders})`,
      ids,
    );
    return rows;
  }

  /**
   * Atomically takes ownership of a queued task. The `status = 'queued'`
   * predicate is what makes this safe: if a cancellation landed between the
   * ZPOPMAX and this update, zero rows change and the dispatcher moves on.
   */
  async claim(id: string, workerId: string, leaseTtlMs: number): Promise<TaskRow | null> {
    const [result] = await this.db.execute<ResultSetHeader>(
      `UPDATE tasks
          SET status           = 'running',
              worker_id        = ?,
              lease_expires_at = DATE_ADD(NOW(3), INTERVAL ? MICROSECOND),
              started_at       = COALESCE(started_at, NOW(3)),
              last_attempt_at  = NOW(3),
              attempts         = attempts + 1
        WHERE id = ? AND status = 'queued'`,
      [workerId, leaseTtlMs * 1000, id],
    );

    if (result.affectedRows === 0) return null;
    return this.findById(id);
  }

  async renewLease(id: string, leaseTtlMs: number): Promise<void> {
    await this.db.execute(
      `UPDATE tasks
          SET lease_expires_at = DATE_ADD(NOW(3), INTERVAL ? MICROSECOND)
        WHERE id = ? AND status IN ('running', 'cancelling')`,
      [leaseTtlMs * 1000, id],
    );
  }

  async markCompleted(id: string, result: Record<string, unknown>): Promise<TaskRow | null> {
    await this.db.execute(
      `UPDATE tasks
          SET status = 'completed', result = CAST(? AS JSON), finished_at = NOW(3),
              worker_id = NULL, lease_expires_at = NULL, last_error = NULL
        WHERE id = ? AND status IN ('running', 'cancelling')`,
      [JSON.stringify(result), id],
    );
    return this.findById(id);
  }

  /** Terminal failure with no retry: `failed` for fatal, `dead_letter` for exhausted. */
  async markTerminalFailure(
    id: string,
    status: Extract<TaskStatus, 'failed' | 'dead_letter'>,
    error: string,
  ): Promise<TaskRow | null> {
    await this.db.execute(
      `UPDATE tasks
          SET status = ?, last_error = ?, finished_at = NOW(3),
              worker_id = NULL, lease_expires_at = NULL
        WHERE id = ?`,
      [status, error, id],
    );
    return this.findById(id);
  }

  /**
   * Cancels a task that has not started. Returns false if the dispatcher claimed
   * it first, in which case the caller falls through to cancelling a running
   * task instead. The status predicate is what makes the two paths exclusive.
   */
  async cancelIfQueued(id: string): Promise<boolean> {
    const [result] = await this.db.execute<ResultSetHeader>(
      `UPDATE tasks
          SET status = 'cancelled', finished_at = NOW(3)
        WHERE id = ? AND status = 'queued'`,
      [id],
    );
    return result.affectedRows === 1;
  }

  async markCancelling(id: string): Promise<TaskRow | null> {
    await this.db.execute(
      `UPDATE tasks SET status = 'cancelling' WHERE id = ? AND status = 'running'`,
      [id],
    );
    return this.findById(id);
  }

  async markCancelled(id: string): Promise<TaskRow | null> {
    await this.db.execute(
      `UPDATE tasks
          SET status = 'cancelled', finished_at = NOW(3),
              worker_id = NULL, lease_expires_at = NULL
        WHERE id = ? AND status IN ('queued', 'running', 'cancelling')`,
      [id],
    );
    return this.findById(id);
  }

  /** Puts a failed attempt back in the queue. The attempt has already been counted. */
  async releaseForRetry(id: string, error: string): Promise<TaskRow | null> {
    await this.db.execute(
      `UPDATE tasks
          SET status = 'queued', last_error = ?, worker_id = NULL, lease_expires_at = NULL
        WHERE id = ?`,
      [error, id],
    );
    return this.findById(id);
  }

  /** Manual retry from the dead letter queue: a fresh budget of attempts. */
  async resetForManualRetry(id: string): Promise<TaskRow | null> {
    await this.db.execute(
      `UPDATE tasks
          SET status = 'queued', attempts = 0, last_error = NULL, result = NULL,
              worker_id = NULL, lease_expires_at = NULL,
              enqueued_at = NOW(3), started_at = NULL, last_attempt_at = NULL, finished_at = NULL
        WHERE id = ? AND status = 'dead_letter'`,
      [id],
    );
    return this.findById(id);
  }

  /** Tasks whose worker stopped renewing the lease. They were abandoned. */
  async findExpiredLeases(limit: number): Promise<TaskRow[]> {
    const [rows] = await this.db.execute<TaskRow[]>(
      `${SELECT_TASK}
        WHERE t.status IN ('running', 'cancelling')
          AND t.lease_expires_at IS NOT NULL
          AND t.lease_expires_at < NOW(3)
        ORDER BY t.lease_expires_at
        LIMIT ${Number(limit)}`,
    );
    return rows;
  }

  /**
   * Reconciler input: tasks MySQL believes are waiting to run and which have
   * been sitting still for a while. The settling period matters — a task in
   * retry backoff is legitimately `queued` and deliberately absent from Redis,
   * and reconciling it early would defeat the backoff.
   */
  async findQueued(
    settledForMs: number,
  ): Promise<Array<{ id: string; clientId: string; priority: number; enqueuedAt: string }>> {
    const [rows] = await this.db.execute<RowDataPacket[]>(
      `SELECT id, client_id, priority, enqueued_at
         FROM tasks
        WHERE status = 'queued'
          AND updated_at < DATE_SUB(NOW(3), INTERVAL ? MICROSECOND)`,
      [settledForMs * 1000],
    );
    return rows.map((row) => ({
      id: row.id as string,
      clientId: row.client_id as string,
      priority: row.priority as number,
      enqueuedAt: toIso(row.enqueued_at as string) as string,
    }));
  }

  async findActiveAndRecent(terminalLimit: number): Promise<TaskRow[]> {
    const activePlaceholders = ACTIVE_STATUSES.map(() => '?').join(', ');
    const terminalPlaceholders = TERMINAL_STATUSES.map(() => '?').join(', ');

    const [active] = await this.db.execute<TaskRow[]>(
      `${SELECT_TASK} WHERE t.status IN (${activePlaceholders}) ORDER BY t.created_at DESC`,
      [...ACTIVE_STATUSES],
    );
    const [recent] = await this.db.execute<TaskRow[]>(
      `${SELECT_TASK} WHERE t.status IN (${terminalPlaceholders})
        ORDER BY t.finished_at DESC
        LIMIT ${Number(terminalLimit)}`,
      [...TERMINAL_STATUSES],
    );

    return [...active, ...recent];
  }

  async search(filter: TaskFilter): Promise<{ rows: TaskRow[]; total: number }> {
    const conditions: string[] = [];
    const params: Array<string | number | Date> = [];

    if (filter.status) {
      conditions.push('t.status = ?');
      params.push(filter.status);
    }
    if (filter.type) {
      conditions.push('t.type = ?');
      params.push(filter.type);
    }
    if (filter.priority !== undefined) {
      conditions.push('t.priority = ?');
      params.push(filter.priority);
    }
    if (filter.clientId) {
      conditions.push('t.client_id = ?');
      params.push(filter.clientId);
    }
    if (filter.from) {
      conditions.push('t.created_at >= ?');
      params.push(new Date(filter.from));
    }
    if (filter.to) {
      conditions.push('t.created_at <= ?');
      params.push(new Date(filter.to));
    }
    if (filter.search) {
      conditions.push('(t.id LIKE ? OR t.type LIKE ? OR c.name LIKE ?)');
      const term = `%${filter.search}%`;
      params.push(term, term, term);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const [countRows] = await this.db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM tasks t JOIN clients c ON c.id = t.client_id ${where}`,
      params,
    );

    // LIMIT and OFFSET are interpolated rather than bound: mysql2's prepared
    // statement protocol rejects placeholders there. Both are zod-validated
    // integers, so there is nothing to inject.
    const offset = (filter.page - 1) * filter.pageSize;
    const [rows] = await this.db.execute<TaskRow[]>(
      `${SELECT_TASK} ${where}
        ORDER BY t.created_at DESC
        LIMIT ${Number(filter.pageSize)} OFFSET ${Number(offset)}`,
      params,
    );

    return { rows, total: Number(countRows[0]?.total ?? 0) };
  }
}
