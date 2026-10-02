// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Create a test team in one command: supervisors, admins and a hub lead with random strong
 * passwords. Passwords go to a private file, never to the terminal or the repository.
 *
 *   pnpm db:seed-team --supervisors 3 --admins 3 --hub-leads 1 --out ~/team-credentials.txt
 *   (on a server: docker compose run --rm tools scripts/seed-team.ts ... --out /tmp/team.txt)
 *
 *   --supervisors <n>   default 3        --admins <n>   default 3        --hub-leads <n>   default 1
 *   --prefix <letters>  staff code prefix, default TEST (codes look like TESTSUP01, TESTADM02, TESTHUB01)
 *   --session <id>      also assign the supervisors and hub leads to this session
 *   --out <file>        REQUIRED. New credentials are appended; the file is created private (mode 0600).
 *
 * Safe to run again: existing accounts are never changed and never get a new password, so a second
 * run writes only what is new. The staff code is the sign in name; there are no real phone numbers.
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { closeDb, getDb } from '@/lib/db/client';
import { seedTeam, TeamPlanError } from '@/lib/team/seedTeam';

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function count(name: string, fallback: number): number {
  const raw = flag(name);
  return raw === undefined ? fallback : Number(raw);
}

/** Refuse an output file inside the repository unless git ignores it. */
function assertNotTracked(file: string): void {
  const rel = relative(process.cwd(), file);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    return; // outside the working directory
  }
  try {
    execFileSync('git', ['check-ignore', '-q', rel], { stdio: 'ignore' });
  } catch {
    throw new TeamPlanError(
      'the --out file is inside the repository and not git ignored; choose a path outside it',
    );
  }
}

async function main(): Promise<void> {
  const out = flag('out');
  if (!out) {
    throw new TeamPlanError('--out <file> is required: passwords are never printed');
  }
  const file = resolve(out);
  assertNotTracked(file);

  const db = getDb();
  try {
    const sessionId = flag('session');
    const accounts = await seedTeam(db, {
      supervisors: count('supervisors', 3),
      admins: count('admins', 3),
      hubLeads: count('hub-leads', 1),
      prefix: flag('prefix') ?? 'TEST',
      ...(sessionId ? { sessionId } : {}),
    });

    const created = accounts.filter((a) => a.password);
    if (created.length > 0) {
      if (!existsSync(file)) {
        writeFileSync(file, '', { mode: 0o600 });
      }
      const lines = created.map(
        (a) => `${a.role.padEnd(10)} ${a.identifier.padEnd(14)} ${a.password}   (${a.name})`,
      );
      appendFileSync(
        file,
        `# Taka Sats test team, created ${new Date().toISOString()}\n# role, staff code (sign in name), password\n${lines.join('\n')}\n`,
      );
    }
    console.log(
      `${created.length} account(s) created, ${accounts.length - created.length} already existed.`,
    );
    for (const a of accounts) {
      console.log(`  ${a.role.padEnd(10)} ${a.identifier}${a.password ? '  (new)' : ''}`);
    }
    console.log(
      created.length > 0
        ? `Passwords written to ${file}. Hand them out one by one and then delete the file.`
        : 'No passwords were written: nothing was new.',
    );
  } finally {
    await closeDb();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof TeamPlanError ? error.message : 'seed-team failed');
  process.exitCode = 1;
});
