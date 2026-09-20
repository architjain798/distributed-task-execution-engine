import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Database } from './mysql.js';
import { logger } from './logger.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations', import.meta.url));

/**
 * Append-only migrations: numbered .sql files applied once each, tracked in a
 * table. No down-migrations and no drift detection — a real project would use a
 * migration tool, and the README says so.
 */
export async function runMigrations(db: Database): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       VARCHAR(255) NOT NULL PRIMARY KEY,
      applied_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  const [rows] = await db.query<any[]>('SELECT name FROM schema_migrations');
  const applied = new Set(rows.map((row) => row.name as string));

  const files = (await readdir(MIGRATIONS_DIR)).filter((file) => file.endsWith('.sql')).sort();

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = await readFile(`${MIGRATIONS_DIR}/${file}`, 'utf8');
    for (const statement of splitStatements(sql)) {
      await db.query(statement);
    }

    await db.query('INSERT INTO schema_migrations (name) VALUES (?)', [file]);
    logger.info({ migration: file }, 'migration applied');
  }
}

/**
 * Splits a file into statements.
 *
 * Whole-line `--` comments are dropped first, because a semicolon inside a
 * comment would otherwise cut a statement in half. Sufficient for these files:
 * no stored procedures, no custom delimiters, and no `--` inside a string
 * literal. A real project would use a migration tool instead.
 */
function splitStatements(sql: string): string[] {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}
