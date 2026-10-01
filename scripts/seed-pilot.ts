// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Set up a pilot / demo deployment so there is something to show: staff accounts, today's
 * active session, authorized collectors (optionally with their wallet), and a fresh BTC/fiat
 * snapshot. Idempotent and non-destructive — it only ever creates what is missing, and never
 * changes an existing account or prints an existing password.
 *
 *   pnpm db:seed-pilot -- --location "Kibera Pilot" \
 *     --collector "Akinyi=akinyi@flow.paybee.buzz" --collector "Musa" \
 *     --staff "Eddie|+254700000001|admin" --staff "Brian|+254700000003|supervisor"
 *
 *   --location <name>        session location (default "Pilot Hub")
 *   --hours <n>              how long the session stays open from now (default 12)
 *   --site <CODE>            site segment for the collectors' public codes (e.g. KBR)
 *   --collector "Alias[=wallet]"  repeatable; a wallet is a Lightning Address / LNURL (the
 *                            RECEIVE side of a wallet card — never its Pay link)
 *   --staff "Name|phone|role"     repeatable; role = supervisor | hub_lead | admin. With none
 *                            given, one of each role is created with placeholder phones
 *   --no-rate                skip the live BTC/fiat fetch
 *
 * New staff get a random password, shown ONCE on this terminal (store it in a password manager;
 * the database keeps only a hash). Run `pnpm db:migrate && pnpm db:seed` first.
 */

import { randomBytes } from 'node:crypto';
import { and, eq, gt, lt } from 'drizzle-orm';
import { hashPassword } from '@/lib/auth/password';
import { isRole, type Role } from '@/lib/auth/permissions';
import {
  attachDestination,
  enrolCollector,
  findCollectorById,
  getLiveDestination,
  searchCollectors,
  type CollectorActor,
  type CollectorRecord,
} from '@/lib/collectors';
import { type Database, closeDb, getDb } from '@/lib/db/client';
import { sessions, supervisors } from '@/lib/db/schema';
import { getLightningProvider } from '@/lib/lightning';
import { fetchExchangeRate } from '@/lib/money/rates';
import { seedMaterialRates } from '@/lib/rates';
import { createSession, patchSession } from '@/lib/sessions';

type Staff = {
  readonly name: string;
  readonly phone: string;
  readonly role: Exclude<Role, 'partner'>;
};

const DEFAULT_STAFF: readonly Staff[] = [
  { name: 'Pilot Admin', phone: '+254700000001', role: 'admin' },
  { name: 'Pilot Hub Lead', phone: '+254700000002', role: 'hub_lead' },
  { name: 'Pilot Supervisor 1', phone: '+254700000003', role: 'supervisor' },
  { name: 'Pilot Supervisor 2', phone: '+254700000004', role: 'supervisor' },
];

const MS_PER_HOUR = 3_600_000;

function flagValues(name: string): string[] {
  const values: string[] = [];
  process.argv.forEach((arg, index) => {
    const value = process.argv[index + 1];
    if (arg === `--${name}` && value !== undefined) {
      values.push(value);
    }
  });
  return values;
}

const flag = (name: string): string | undefined => flagValues(name)[0];
const hasFlag = (name: string): boolean => process.argv.includes(`--${name}`);

function parseStaff(): Staff[] {
  const given = flagValues('staff');
  if (given.length === 0) {
    return [...DEFAULT_STAFF];
  }
  return given.map((raw) => {
    const [name, phone, role] = raw.split('|').map((part) => part.trim());
    if (!name || !phone || !role || !isRole(role) || role === 'partner') {
      throw new Error(
        `--staff must be "Name|phone|role" with role supervisor|hub_lead|admin: ${raw}`,
      );
    }
    return { name, phone, role };
  });
}

/** Create the staff who do not exist yet; returns every account with a password only for new ones. */
async function ensureStaff(db: Database, wanted: readonly Staff[]) {
  const result: { id: string; staff: Staff; password?: string }[] = [];
  for (const staff of wanted) {
    const [existing] = await db
      .select({ id: supervisors.id })
      .from(supervisors)
      .where(eq(supervisors.phone, staff.phone));
    if (existing) {
      result.push({ id: existing.id, staff });
      continue;
    }
    const password = randomBytes(15).toString('base64url');
    const [created] = await db
      .insert(supervisors)
      .values({ ...staff, passwordHash: await hashPassword(password) })
      .returning({ id: supervisors.id });
    if (!created) {
      throw new Error(`could not create ${staff.name}`);
    }
    result.push({ id: created.id, staff, password });
  }
  return result;
}

/** Reuse a session that is open right now at this location, else create and activate one. */
async function ensureSession(db: Database, location: string, hours: number, staffIds: string[]) {
  const now = new Date();
  const [open] = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.location, location),
        eq(sessions.status, 'active'),
        lt(sessions.scheduledStart, now),
        gt(sessions.scheduledEnd, now),
      ),
    );
  if (open) {
    return { id: open.id, created: false };
  }
  const created = await createSession(db, {
    location,
    scheduledStart: new Date(now.getTime() - MS_PER_HOUR),
    scheduledEnd: new Date(now.getTime() + hours * MS_PER_HOUR),
    supervisorIds: staffIds,
  });
  await patchSession(db, created.id, { status: 'active' });
  return { id: created.id, created: true };
}

async function main(): Promise<void> {
  const db = getDb();
  try {
    const location = flag('location') ?? 'Pilot Hub';
    const hours = Number(flag('hours') ?? 12);
    if (!Number.isFinite(hours) || hours <= 0) {
      throw new Error('--hours must be a positive number');
    }

    console.log(`\nSeeding the pilot — ${location}\n`);

    const rates = await seedMaterialRates(db);
    console.log(
      rates > 0 ? `✓ ${rates} material rates seeded` : '• material rates already present',
    );

    const accounts = await ensureStaff(db, parseStaff());
    const admin = accounts.find((a) => a.staff.role === 'admin') ?? accounts[0];
    if (!admin) {
      throw new Error('no staff to act as the registrar');
    }
    const actor: CollectorActor = { id: admin.id, role: admin.staff.role };

    const field = accounts.filter((a) => a.staff.role !== 'admin').map((a) => a.id);
    const session = await ensureSession(db, location, hours, field);
    console.log(
      session.created
        ? `✓ session opened at "${location}" for ${hours}h, ${field.length} staff assigned`
        : `• a session is already open at "${location}"`,
    );

    const siteCode = flag('site');
    const provider = getLightningProvider();
    const collectors: { collector: CollectorRecord; wallet: string }[] = [];
    for (const spec of flagValues('collector')) {
      const [alias, wallet] = spec.split('=').map((part) => part.trim());
      if (!alias) {
        continue;
      }
      // Idempotent by alias: a re-run reuses the collector instead of registering a twin.
      const existing = (await searchCollectors(db, { q: alias, status: 'all' })).find(
        (c) => c.alias.toLowerCase() === alias.toLowerCase(),
      );
      const collector =
        (existing && (await findCollectorById(db, existing.id))) ||
        (await enrolCollector(db, { alias, ...(siteCode ? { siteCode } : {}) }, actor));

      let status = (await getLiveDestination(db, collector.id))?.status ?? 'no wallet yet';
      if (wallet && status === 'no wallet yet') {
        const { destination } = await attachDestination(
          db,
          provider,
          { collectorId: collector.id, rawCode: wallet },
          actor,
        );
        status = destination.status;
      }
      collectors.push({ collector, wallet: status });
    }
    if (collectors.length > 0) {
      console.log(`✓ ${collectors.length} collector(s) ready:`);
      for (const { collector, wallet } of collectors) {
        console.log(`    ${collector.publicCode}  ${collector.alias}  — wallet: ${wallet}`);
      }
    }

    if (!hasFlag('no-rate')) {
      try {
        const snapshot = await fetchExchangeRate(db);
        console.log(`✓ BTC/${snapshot.quote} snapshot stored (${snapshot.rate})`);
      } catch (error) {
        console.warn(
          `! could not fetch a BTC/fiat snapshot (${error instanceof Error ? error.name : 'error'}); the worker's refresh job will retry`,
        );
      }
    }

    const created = accounts.filter((a) => a.password);
    if (created.length > 0) {
      console.log('\nNew staff accounts — passwords are shown ONCE, store them now:\n');
      for (const { staff, password } of created) {
        console.log(`  ${staff.role.padEnd(10)} ${staff.phone}  ${password}   (${staff.name})`);
      }
    } else {
      console.log('\nAll staff accounts already existed — nothing changed.');
    }
    console.log('');
  } finally {
    await closeDb();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
