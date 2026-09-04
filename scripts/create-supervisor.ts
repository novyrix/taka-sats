// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Bootstrap the first supervisor/admin account (M2-1). There is no other way
 * to create one — the API's collector routes require an existing session,
 * and there is no public sign-up (§3.1: staff are provisioned, not
 * self-registered).
 *
 *   DATABASE_URL=postgresql://… node scripts/create-supervisor.ts \
 *     --name "Ronnie" --phone "+254700000000" --role admin --password "<a strong password>"
 *
 * The password is read from the `--password` flag or, if omitted, the
 * `SUPERVISOR_PASSWORD` env var — never logged either way. Relative imports
 * only (like `migrate.ts`) so this runs under plain `node`, no bundler.
 */

import { eq } from 'drizzle-orm';
import { hashPassword } from '../lib/auth/password';
import { isRole } from '../lib/auth/permissions';
import { getDb } from '../lib/db/client';
import { supervisors } from '../lib/db/schema';

function readFlag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const name = readFlag('name');
  const phone = readFlag('phone');
  const role = readFlag('role') ?? 'admin';
  const password = readFlag('password') ?? process.env.SUPERVISOR_PASSWORD;

  if (!name || !phone || !password) {
    console.error(
      'Usage: create-supervisor --name <name> --phone <phone> --role <role> --password <password>',
    );
    process.exitCode = 1;
    return;
  }
  if (!isRole(role) || role === 'partner') {
    console.error(`--role must be one of: supervisor, hub_lead, admin (got "${role}")`);
    process.exitCode = 1;
    return;
  }

  const db = getDb();
  const [existing] = await db
    .select({ id: supervisors.id })
    .from(supervisors)
    .where(eq(supervisors.phone, phone));
  if (existing) {
    console.error(`A supervisor with phone ${phone} already exists (id ${existing.id}).`);
    process.exitCode = 1;
    return;
  }

  const passwordHash = await hashPassword(password);
  const [row] = await db
    .insert(supervisors)
    .values({ name, phone, role, passwordHash })
    .returning({ id: supervisors.id, role: supervisors.role });

  console.log(`Created ${row?.role} "${name}" (id ${row?.id}).`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
