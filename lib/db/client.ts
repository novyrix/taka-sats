// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The typed Drizzle client (D-08).
 *
 * `DATABASE_URL` is a secret and comes from the environment only, never from
 * `config/*.toml` (D-21 §13.1). The client is created lazily so importing this
 * module (e.g. in a test that never touches the DB) does not require the env
 * var to be set. Zero framework imports (D-04).
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Database = ReturnType<typeof createDatabase>;

function createDatabase(connectionString: string) {
  const client = postgres(connectionString, { prepare: false });
  return drizzle(client, { schema });
}

let instance: Database | undefined;

/** The process-wide database client. Throws if `DATABASE_URL` is unset. */
export function getDb(): Database {
  if (!instance) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error('DATABASE_URL is not set');
    }
    instance = createDatabase(url);
  }
  return instance;
}
