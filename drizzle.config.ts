// SPDX-License-Identifier: AGPL-3.0-only

import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit configuration (D-08).
 *
 * `pnpm db:generate` writes SQL migrations to `db/`; `pnpm db:migrate` applies
 * them. Every generated migration gets a hand-written `down` before merge
 * (Code Style Guide §8) — drizzle-kit does not emit one.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './lib/db/schema.ts',
  out: './db',
  strict: true,
  verbose: true,
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://taka_sats:taka_sats@localhost:5432/taka_sats',
  },
});
