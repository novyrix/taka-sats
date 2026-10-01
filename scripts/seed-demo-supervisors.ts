// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Create five non-production supervisor logins for pilot testing and assign them to the
 * newest active session that is open now. The identifiers are deliberately synthetic
 * (`SUP01`–`SUP05`); passwords are random and printed once only for newly created rows.
 * Existing accounts are never changed and their credentials are never reprinted.
 *
 * Capture stdout into a mode-0600 operator file when running on a shared host:
 *
 *   umask 077
 *   pnpm db:seed-demo-supervisors > demo-supervisor-credentials.txt
 */

import { randomBytes } from 'node:crypto';
import { and, desc, eq, gt, lt } from 'drizzle-orm';
import { hashPassword } from '@/lib/auth/password';
import { closeDb, getDb } from '@/lib/db/client';
import { sessions, sessionSupervisors, supervisors } from '@/lib/db/schema';

const DEMO_SUPERVISORS = Array.from({ length: 5 }, (_, index) => {
  const suffix = String(index + 1).padStart(2, '0');
  return { identifier: `SUP${suffix}`, name: `Demo Supervisor ${suffix}` };
});

async function main(): Promise<void> {
  const db = getDb();
  try {
    const now = new Date();
    const [activeSession] = await db
      .select({ id: sessions.id, location: sessions.location })
      .from(sessions)
      .where(
        and(
          eq(sessions.status, 'active'),
          lt(sessions.scheduledStart, now),
          gt(sessions.scheduledEnd, now),
        ),
      )
      .orderBy(desc(sessions.scheduledStart))
      .limit(1);

    const created: { identifier: string; name: string; password: string }[] = [];
    const accountIds: string[] = [];

    for (const account of DEMO_SUPERVISORS) {
      const [existing] = await db
        .select({ id: supervisors.id })
        .from(supervisors)
        .where(eq(supervisors.phone, account.identifier));

      if (existing) {
        accountIds.push(existing.id);
        continue;
      }

      const password = randomBytes(18).toString('base64url');
      const [row] = await db
        .insert(supervisors)
        .values({
          name: account.name,
          phone: account.identifier,
          role: 'supervisor',
          passwordHash: await hashPassword(password),
        })
        .returning({ id: supervisors.id });
      if (!row) {
        throw new Error(`Could not create ${account.identifier}`);
      }
      accountIds.push(row.id);
      created.push({ ...account, password });
    }

    if (activeSession && accountIds.length > 0) {
      await db
        .insert(sessionSupervisors)
        .values(
          accountIds.map((supervisorId) => ({
            sessionId: activeSession.id,
            supervisorId,
          })),
        )
        .onConflictDoNothing();
    }

    console.log('Taka Sats demo supervisors');
    console.log(
      `Created: ${created.length}; already present: ${accountIds.length - created.length}`,
    );
    console.log(
      activeSession
        ? `Assigned all five to active session: ${activeSession.location} (${activeSession.id})`
        : 'No open active session found; accounts can sign in but field actions remain gated.',
    );

    if (created.length > 0) {
      console.log('\nNew credentials — shown once:');
      for (const account of created) {
        console.log(`${account.identifier}\t${account.password}\t${account.name}`);
      }
    } else {
      console.log('No passwords printed because all five accounts already existed.');
    }
  } finally {
    await closeDb();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
