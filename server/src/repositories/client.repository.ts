import type { RowDataPacket } from 'mysql2';
import type { Database } from '../lib/mysql.js';

export interface ClientRecord {
  id: string;
  name: string;
  apiKey: string;
  /** DRR quantum. A client with weight 2.0 receives twice the dispatch rate. */
  weight: number;
}

interface ClientRow extends RowDataPacket {
  id: string;
  name: string;
  api_key: string;
  weight: string;
}

function toClient(row: ClientRow): ClientRecord {
  return {
    id: row.id,
    name: row.name,
    apiKey: row.api_key,
    // DECIMAL arrives as a string; the scheduler needs a number.
    weight: Number(row.weight),
  };
}

export class ClientRepository {
  constructor(private readonly db: Database) {}

  async findByApiKey(apiKey: string): Promise<ClientRecord | null> {
    const [rows] = await this.db.execute<ClientRow[]>(
      'SELECT id, name, api_key, weight FROM clients WHERE api_key = ?',
      [apiKey],
    );
    const row = rows[0];
    return row ? toClient(row) : null;
  }

  async findAll(): Promise<ClientRecord[]> {
    const [rows] = await this.db.execute<ClientRow[]>(
      'SELECT id, name, api_key, weight FROM clients ORDER BY name',
    );
    return rows.map(toClient);
  }
}
