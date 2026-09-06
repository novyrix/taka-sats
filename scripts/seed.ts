// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Seed operational data that a migration can't set (D-21): the initial
 * `material_rates` from `[rates].seed` in config. Idempotent — a no-op once
 * the table has any row. Run after `pnpm db:migrate`.
 *
 *   DATABASE_URL=postgresql://… pnpm db:seed
 */

import { closeDb, getDb } from '@/lib/db/client';
import { seedMaterialRates } from '@/lib/rates';

async function main(): Promise<void> {
  try {
    const inserted = await seedMaterialRates(getDb());
    console.log(
      inserted > 0
        ? `seeded ${inserted} material rate(s) from [rates].seed`
        : 'material_rates already populated — nothing to seed',
    );
  } finally {
    await closeDb();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
