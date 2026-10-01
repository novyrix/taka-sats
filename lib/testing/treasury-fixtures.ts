// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Fixtures for the treasury (funding vote) suites. Tests only: never imported by application
 * code. `makeRail` needs no database; `seedStewards` needs a migrated `DATABASE_URL`.
 */

import { sql } from 'drizzle-orm';
import { resetSettingsCache } from '@/lib/config';
import type { Database } from '@/lib/db/client';
import { sats } from '@/lib/money';
import type { FloatReader } from '@/lib/treasury';
import { createStaff, type StaffFixture } from './fixtures';

export const TREASURY_TRUNCATE = sql`truncate treasury_topup_signoffs, treasury_topups, payouts, anomaly_flags, collection_events, collector_payment_destinations, collector_authorizations, tag_history, collectors, ledger_entries, session_supervisors, sessions, supervisors, material_rates, exchange_rate_snapshots restart identity cascade`;

export type TestRail = {
  readonly rail: FloatReader;
  readonly state: { balance: number; failing: boolean };
};

/** A hot wallet whose balance a test sets, and whose failures leak a "secret" it must never pass on. */
export function makeRail(initial: number): TestRail {
  const state = { balance: initial, failing: false };
  const rail: FloatReader = {
    getFloatBalance: async () => {
      if (state.failing) {
        throw new Error('rail rejected key=super-secret-value');
      }
      return { available: sats(state.balance), asOf: new Date() };
    },
  };
  return { rail, state };
}

/** Treasury policy for a test, read through `getSettings()`. Pair with {@link clearTreasuryConfig}. */
export function configureTreasury({ approvals = 2, cap = 0 } = {}): void {
  process.env.TAKASATS__TREASURY__TOPUP_APPROVALS_REQUIRED = String(approvals);
  process.env.TAKASATS__TREASURY__HOT_WALLET_CAP_SATS = String(cap);
  resetSettingsCache();
}

export function clearTreasuryConfig(): void {
  delete process.env.TAKASATS__TREASURY__TOPUP_APPROVALS_REQUIRED;
  delete process.env.TAKASATS__TREASURY__HOT_WALLET_CAP_SATS;
  resetSettingsCache();
}

export type Stewards = {
  readonly proposer: StaffFixture;
  readonly b: StaffFixture;
  readonly c: StaffFixture;
  readonly d: StaffFixture;
  readonly hubLead: StaffFixture;
  readonly supervisor: StaffFixture;
};

/** An empty database with four admin stewards, a hub lead and a field supervisor. */
export async function seedStewards(db: Database): Promise<Stewards> {
  await db.execute(TREASURY_TRUNCATE);
  return {
    proposer: await createStaff(db, 'admin', 'Proposer'),
    b: await createStaff(db, 'admin', 'Steward B'),
    c: await createStaff(db, 'admin', 'Steward C'),
    d: await createStaff(db, 'admin', 'Steward D'),
    hubLead: await createStaff(db, 'hub_lead', 'Hub'),
    supervisor: await createStaff(db, 'supervisor', 'Field'),
  };
}
