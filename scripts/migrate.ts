// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Apply pending migrations from `db/` (D-08, M0-6).
 *
 *   DATABASE_URL=postgres://… pnpm db:migrate
 *
 * Runs the `up` SQL for every journal entry not yet applied. The paired
 * `<tag>.down.sql` files are the hand-written rollbacks (Code Style Guide §8);
 * drizzle's forward-only migrator does not run them — a rollback is applied
 * deliberately by an operator, never automatically.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set');
  }

  const sql = postgres(url, { max: 1 });
  try {
    await migrate(drizzle(sql), { migrationsFolder: './db' });
    console.log('migrations up to date');
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
