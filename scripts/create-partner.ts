// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Bootstrap a partner login (M2-1). Partners sign in with their `login_email`
 * + password and get a read-only, aggregate-only, sponsorship-scoped view
 * (§3.1, NFR 7.4). There is no self-service partner sign-up.
 *
 *   DATABASE_URL=postgresql://… pnpm db:create-partner -- \
 *     --name "Trezor" --email "reports@trezor.example" --password "<a strong password>"
 */

import { eq } from 'drizzle-orm';
import { hashPassword, weakPasswordReason } from '@/lib/auth/password';
import { closeDb, getDb } from '@/lib/db/client';
import { partners } from '@/lib/db/schema';

function readFlag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const name = readFlag('name');
  const email = readFlag('email')?.toLowerCase();
  const contact = readFlag('contact');
  const password = readFlag('password') ?? process.env.PARTNER_PASSWORD;

  if (!name || !email || !password) {
    console.error(
      'Usage: create-partner --name <name> --email <email> --password <password> [--contact <c>]',
    );
    process.exitCode = 1;
    return;
  }

  const db = getDb();
  try {
    const [existing] = await db
      .select({ id: partners.id })
      .from(partners)
      .where(eq(partners.loginEmail, email));
    if (existing) {
      console.error(`A partner with email ${email} already exists (id ${existing.id}).`);
      process.exitCode = 1;
      return;
    }

    const weak = weakPasswordReason(password);
    if (weak) {
      console.error(`Refusing a weak password: ${weak}.`);
      process.exitCode = 1;
      return;
    }
    const passwordHash = await hashPassword(password);
    const [row] = await db
      .insert(partners)
      .values({ name, loginEmail: email, passwordHash, ...(contact ? { contact } : {}) })
      .returning({ id: partners.id });
    console.log(`Created partner "${name}" (id ${row?.id}).`);
  } finally {
    await closeDb();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
