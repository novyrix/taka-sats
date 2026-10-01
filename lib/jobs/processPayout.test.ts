// SPDX-License-Identifier: AGPL-3.0-only

import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSettingsCache } from '@/lib/config';
import { getDb } from '@/lib/db/client';
import { anomalyFlags, collectorPaymentDestinations } from '@/lib/db/schema';
import { FakeLightningProvider } from '@/lib/lightning';
import { createPayoutForEvent, processPayout } from '@/lib/payouts';
import {
  NOW,
  PAYOUT_TRUNCATE,
  type PayoutWorld,
  seedCollectionEvent,
  seedPayoutWorld,
  seedSnapshot,
} from '@/lib/testing/payout-fixtures';
import { enqueuePayoutsAwaitingDestination, processPayoutJob, sweepPayouts } from './processPayout';

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)('payout jobs (integration)', () => {
  const db = hasDatabase ? getDb() : undefined!;
  let world: PayoutWorld;
  let fake: FakeLightningProvider;

  beforeEach(async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    process.env.TAKASATS__PAYOUTS__REQUIRE_APPROVAL_FIRST_PAYOUT = 'false';
    resetSettingsCache();
    world = await seedPayoutWorld(db);
    fake = new FakeLightningProvider();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.TAKASATS__PAYOUTS__REQUIRE_APPROVAL_FIRST_PAYOUT;
    resetSettingsCache();
  });
  afterAll(async () => {
    if (hasDatabase) {
      await db.execute(PAYOUT_TRUNCATE);
    }
  });

  const newPayout = async () => createPayoutForEvent(db, await seedCollectionEvent(db, world));

  it('process-payout drives one payout and is a no-op the second time', async () => {
    const payout = await newPayout();
    await seedSnapshot(db, new Date()); // the job reads the real clock
    await processPayoutJob(db, fake, { payoutId: payout.id });
    await processPayoutJob(db, fake, { payoutId: payout.id });
    expect(fake.paymentsSent()).toHaveLength(1);
  });

  it('the sweep re-enqueues parked payouts, and flags a stale sending one', async () => {
    const parked = await newPayout(); // awaiting_rate
    const stuck = await newPayout();
    process.env.TAKASATS__PAYOUTS__SECOND_SIGNOFF_THRESHOLD_SATS = '0';
    resetSettingsCache();
    await processPayout(db, fake, stuck.id, NOW); // pending_approval, priced
    await db.execute(
      sql`update payouts set status = 'sending', attempted_at = ${new Date(NOW.getTime() - 3_600_000).toISOString()} where id = ${stuck.id}`,
    );
    delete process.env.TAKASATS__PAYOUTS__SECOND_SIGNOFF_THRESHOLD_SATS;
    resetSettingsCache();

    const enqueue = vi.fn(async () => undefined);
    const result = await sweepPayouts(db, enqueue, NOW);
    expect(result).toEqual({ enqueued: 1, flagged: 1 });
    expect(enqueue).toHaveBeenCalledWith({ payoutId: parked.id });

    // A second tick finds nothing new to flag.
    expect((await sweepPayouts(db, enqueue, NOW)).flagged).toBe(0);
    const flags = await db
      .select()
      .from(anomalyFlags)
      .where(eq(anomalyFlags.flagType, 'payout_uncertain'));
    expect(flags).toHaveLength(1);
    expect(fake.paymentsSent()).toHaveLength(0);
  });

  it('wakes only the payouts waiting on a destination for that collector', async () => {
    await db.update(collectorPaymentDestinations).set({ status: 'pending_validation' });
    const waiting = await newPayout();
    await processPayout(db, fake, waiting.id, NOW); // awaiting_destination
    const unrelated = await newPayout(); // awaiting_rate

    const enqueue = vi.fn(async () => undefined);
    await enqueuePayoutsAwaitingDestination(db, world.collectorId, enqueue);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith({ payoutId: waiting.id });
    expect(enqueue).not.toHaveBeenCalledWith({ payoutId: unrelated.id });
  });

  it('a queue outage never fails the verification that triggered the wake-up', async () => {
    await db.update(collectorPaymentDestinations).set({ status: 'pending_validation' });
    const waiting = await newPayout();
    await processPayout(db, fake, waiting.id, NOW);
    const broken = vi.fn(async () => {
      throw new Error('queue down');
    });
    await expect(
      enqueuePayoutsAwaitingDestination(db, world.collectorId, broken),
    ).resolves.toBeUndefined();
    expect(broken).toHaveBeenCalled();
  });
});
