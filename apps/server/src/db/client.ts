// Mở SQLite và áp migration (drizzle-kit sinh ở apps/server/drizzle).

import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from './schema.ts';

export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

const MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url));

export function openDb(file: string): Db {
  const client = new Database(file);
  client.pragma('journal_mode = WAL');
  client.pragma('foreign_keys = ON');
  const db = drizzle({ client, schema });
  migrate(db, { migrationsFolder: MIGRATIONS });
  return db;
}

/** Thư mục dữ liệu mặc định trên macOS; đổi bằng `DELE_DATA_DIR`. */
export function defaultDataDir(): string {
  return process.env.DELE_DATA_DIR ?? join(homedir(), 'Library', 'Application Support', 'DeleBanana');
}
