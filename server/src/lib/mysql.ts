import mysql from 'mysql2/promise';
import { env } from '../config/env.js';
import { logger } from './logger.js';

export type Database = mysql.Pool;

export function createPool(): Database {
  return mysql.createPool({
    host: env.MYSQL_HOST,
    port: env.MYSQL_PORT,
    user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD,
    database: env.MYSQL_DATABASE,
    connectionLimit: env.MYSQL_POOL_SIZE,
    waitForConnections: true,
    // Timestamps come back as strings so the app, not the driver, decides the
    // timezone. Everything is serialised as UTC ISO strings at the boundary.
    dateStrings: true,
    timezone: 'Z',
  });
}

/**
 * MySQL is routinely slower to accept connections than the app is to start, so
 * both entrypoints wait for it rather than crash-looping on the compose network.
 */
export async function waitForDatabase(pool: Database, attempts = 30): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (error) {
      if (attempt === attempts) throw error;
      logger.warn({ attempt, attempts }, 'waiting for mysql');
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
}
