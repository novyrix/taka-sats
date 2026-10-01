// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Resolving a payout stuck in `sending`, against a real Postgres. The point of the feature is that
 * a person can settle an uncertain payment WITHOUT it ever being paid twice, so most cases assert
 * what the provider received and what the ledger holds as well as the payout's status.
 */

import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSettingsCache } from '@/lib/config';
import { getDb } from '@/lib/db/client';
import { anomalyFlags, ledgerEntries, payoutResolutions, payouts } from '@/lib/db/schema';
import { verifyChain } from '@/lib/ledger';
import { FakeLightningProvider } from '@/lib/lightning';
import { PaymentOutcomeUnknownError } from '@/lib/lightning/errors';
import type { LightningProvider, PaymentLookup } from '@/lib/lightning/LightningProvider';
import { sats } from '@/lib/money';
import { createStaff } from '@/lib/testing/fixtures';
import {
  NOW,
  PAYOUT_TRUNCATE,
  type PayoutWorld,
  seedCollectionEvent,
  seedPayoutWorld,
} from '@/lib/testing/payout-fixtures';
import {
  checkPayout,
  createPayoutForEvent,
  PayoutResolveError,
  PayoutStateError,
  processPayout,
  resolvePayout,
  retryPayout,
} from './index';

const hasDatabase = Boolean(process.env.DATABASE_URL);

const HASH = 'ab'.repeat(32);
const LATER = new Date(NOW.getTime() + 3_600_000);

type Rail = Pick<LightningProvider, 'kind' | 'pay' | 'getFloatBalance'>;

/** A rail whose `pay` ends in an unknown outcome. */
function unknownRail(hash: string | null): Rail & { pay: ReturnType<typeof vi.fn> } {
  return {
    kind: 'fake',
    pay: vi.fn(async () => {
      throw new PaymentOutcomeUnknownError('pending', hash ?? undefined);
    }),
    getFloatBalance: async () => ({ available: sats(1_000_000), asOf: NOW }),
  };
}

/** A provider whose lookup answers `answer` (or throws). */
function lookupProvider(answer: PaymentLookup | Error) {
  const lookupPayment = vi.fn(async () => {
    if (answer instanceof Error) {
      throw answer;
    }
    return answer;
  });
  return { kind: 'fake' as const, lookupPayment };
}

describe.skipIf(!hasDatabase)('lib/payouts resolve (integration)', () => {
  const db = hasDatabase ? getDb() : undefined!;
  let world: PayoutWorld;
  let admin2: string;
  let admin3: string;

  beforeEach(async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    process.env.TAKASATS__PAYOUTS__SECOND_SIGNOFF_THRESHOLD_SATS = '50000';
    process.env.TAKASATS__PAYOUTS__REQUIRE_APPROVAL_FIRST_PAYOUT = 'false';
    resetSettingsCache();
    world = await seedPayoutWorld(db);
    admin2 = (await createStaff(db, 'admin', 'Admin Two')).id;
    admin3 = (await createStaff(db, 'admin', 'Admin Three')).id;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.TAKASATS__PAYOUTS__SECOND_SIGNOFF_THRESHOLD_SATS;
    delete process.env.TAKASATS__PAYOUTS__REQUIRE_APPROVAL_FIRST_PAYOUT;
    delete process.env.TAKASATS__PAYOUTS__RESOLUTION_REQUIRES_DISTINCT_ACTOR;
    resetSettingsCache();
  });
  afterAll(async () => {
    if (hasDatabase) {
      await db.execute(PAYOUT_TRUNCATE);
    }
  });

  /** A payout stuck in `sending` after an unknown outcome (flagged), plus the rail that got stuck. */
  async function stuckPayout(options: { hash?: string | undefined; supervisorId?: string } = {}) {
    const rail = unknownRail('hash' in options ? (options.hash ?? null) : HASH);
    const eventId = await seedCollectionEvent(
      db,
      world,
      options.supervisorId ? { supervisorId: options.supervisorId } : {},
    );
    const payout = await createPayoutForEvent(db, eventId);
    const sending = await processPayout(db, rail, payout.id, NOW);
    expect(sending.status).toBe('sending');
    return { payout: sending, rail };
  }

  const reload = async (id: string) => {
    const [row] = await db.select().from(payouts).where(eq(payouts.id, id));
    return row!;
  };
  const ledgerCount = async () => {
    const rows = await db.execute(sql`select count(*)::int as n from ledger_entries`);
    return Number(rows[0]?.n);
  };
  const flags = () =>
    db.select().from(anomalyFlags).where(eq(anomalyFlags.flagType, 'payout_uncertain'));
  const resolutions = () => db.select().from(payoutResolutions);
  const admin = () => ({ id: world.adminId, role: 'admin' as const });
  const asAdmin2 = () => ({ id: admin2, role: 'admin' as const });

  describe('resolving as paid', () => {
    it('records the payout as paid with the stored payment hash, a payout ledger entry, and closes the flag', async () => {
      const { payout } = await stuckPayout();
      expect(payout.providerPaymentRef).toBe(HASH); // kept from the unknown outcome
      expect(await flags()).toHaveLength(1);
      const before = await ledgerCount();

      const result = await resolvePayout(
        db,
        null,
        { payoutId: payout.id, actor: admin(), outcome: 'paid', note: 'seen in the wallet' },
        LATER,
      );
      expect(result.changed).toBe(true);
      expect(result.payout.status).toBe('paid');
      expect(result.payout.providerPaymentRef).toBe(HASH);
      expect(result.payout.settledAt?.toISOString()).toBe(LATER.toISOString());

      expect(await ledgerCount()).toBe(before + 1);
      const [entry] = await db
        .select()
        .from(ledgerEntries)
        .where(eq(ledgerEntries.id, result.payout.ledgerEntryId!));
      expect(entry?.entryType).toBe('payout');
      expect((await verifyChain(db)).ok).toBe(true);

      const [resolution] = await resolutions();
      expect(resolution).toMatchObject({
        outcome: 'paid',
        reference: HASH,
        note: 'seen in the wallet',
        resolvedBy: world.adminId,
        providerState: 'unsupported',
      });
      const [flag] = await flags();
      expect(flag?.reviewedAt).not.toBeNull();
      expect(flag?.reviewNote).toBe('resolved as paid');
    });

    it('takes a reference from the admin when the payout holds none', async () => {
      const { payout } = await stuckPayout({ hash: undefined });
      expect(payout.providerPaymentRef).toBeNull();
      await expect(
        resolvePayout(db, null, { payoutId: payout.id, actor: admin(), outcome: 'paid' }, LATER),
      ).rejects.toMatchObject({ reason: 'reference_required' });
      const done = await resolvePayout(
        db,
        null,
        { payoutId: payout.id, actor: admin(), outcome: 'paid', reference: 'tx-123456' },
        LATER,
      );
      expect(done.payout.providerPaymentRef).toBe('tx-123456');
    });

    it.each(['', '   ', 'short', 'has spaces in it', 'x'.repeat(201), "'; drop table payouts;--"])(
      'rejects the malformed reference %j',
      async (reference) => {
        const { payout } = await stuckPayout({ hash: undefined });
        await expect(
          resolvePayout(
            db,
            null,
            { payoutId: payout.id, actor: admin(), outcome: 'paid', reference },
            LATER,
          ),
        ).rejects.toBeInstanceOf(PayoutResolveError);
        expect((await reload(payout.id)).status).toBe('sending');
      },
    );

    it('refuses a reference different from the one the payout was sent with', async () => {
      const { payout } = await stuckPayout();
      await expect(
        resolvePayout(
          db,
          null,
          { payoutId: payout.id, actor: admin(), outcome: 'paid', reference: 'cd'.repeat(32) },
          LATER,
        ),
      ).rejects.toMatchObject({ reason: 'reference_mismatch' });
    });

    it('one provider payment can never settle two payouts', async () => {
      const first = await stuckPayout({ hash: undefined });
      const second = await stuckPayout({ hash: undefined });
      await resolvePayout(
        db,
        null,
        { payoutId: first.payout.id, actor: admin(), outcome: 'paid', reference: 'tx-shared-1' },
        LATER,
      );
      await expect(
        resolvePayout(
          db,
          null,
          {
            payoutId: second.payout.id,
            actor: asAdmin2(),
            outcome: 'paid',
            reference: 'tx-shared-1',
          },
          LATER,
        ),
      ).rejects.toMatchObject({ reason: 'reference_in_use' });
      expect((await reload(second.payout.id)).status).toBe('sending');
    });
  });

  describe('resolving as failed', () => {
    it('marks it failed, appends a correction entry, does not requeue and never sends', async () => {
      const { payout, rail } = await stuckPayout();
      const before = await ledgerCount();
      const result = await resolvePayout(
        db,
        null,
        { payoutId: payout.id, actor: admin(), outcome: 'failed' },
        LATER,
      );
      expect(result.payout.status).toBe('failed');
      expect(result.payout.lastError).toBe('resolved_failed');
      expect(result.payout.ledgerEntryId).toBeNull();
      expect(await ledgerCount()).toBe(before + 1);
      const [resolution] = await resolutions();
      const [entry] = await db
        .select()
        .from(ledgerEntries)
        .where(eq(ledgerEntries.id, resolution!.ledgerEntryId));
      expect(entry?.entryType).toBe('correction');
      expect((await verifyChain(db)).ok).toBe(true);

      // Not re-run by processing, not re-sent.
      await processPayout(db, rail, payout.id, LATER);
      expect(rail.pay).toHaveBeenCalledTimes(1);
      expect((await reload(payout.id)).status).toBe('failed');
    });

    it('a retry after a failed resolution pays once; a payout stuck again re-opens its flag', async () => {
      const { payout } = await stuckPayout();
      await resolvePayout(
        db,
        null,
        { payoutId: payout.id, actor: admin(), outcome: 'failed' },
        LATER,
      );
      await retryPayout(db, payout.id);
      const second = unknownRail('ef'.repeat(32));
      const stuckAgain = await processPayout(db, second, payout.id, NOW);
      expect(stuckAgain.status).toBe('sending');
      expect(stuckAgain.attempts).toBe(2);
      const [flag] = await flags();
      expect(flag?.reviewedAt).toBeNull(); // re-opened for a person
      expect(flag?.context).toMatchObject({ reopened: true });

      // The second attempt is resolved on its own, by someone else.
      const done = await resolvePayout(
        db,
        null,
        { payoutId: payout.id, actor: asAdmin2(), outcome: 'paid' },
        new Date(LATER.getTime() + 60_000),
      );
      expect(done.payout.status).toBe('paid');
      expect(done.payout.providerPaymentRef).toBe('ef'.repeat(32));
      expect(await resolutions()).toHaveLength(2);
    });
  });

  describe('who and when', () => {
    it.each(['supervisor', 'hub_lead', 'partner'] as const)(
      '%s cannot resolve or check',
      async (role) => {
        const { payout } = await stuckPayout();
        const actor = { id: world.recorderId, role };
        await expect(
          resolvePayout(db, null, { payoutId: payout.id, actor, outcome: 'failed' }, LATER),
        ).rejects.toMatchObject({ reason: 'not_permitted' });
        await expect(checkPayout(db, null, { payoutId: payout.id, actor })).rejects.toMatchObject({
          reason: 'not_permitted',
        });
        expect((await reload(payout.id)).status).toBe('sending');
      },
    );

    it('the admin who approved the payout cannot resolve it', async () => {
      const { payout } = await stuckPayout();
      await db.update(payouts).set({ approvedBy: world.adminId }).where(eq(payouts.id, payout.id));
      await expect(
        resolvePayout(db, null, { payoutId: payout.id, actor: admin(), outcome: 'failed' }, LATER),
      ).rejects.toMatchObject({ reason: 'self_resolution' });
      // Another admin can.
      const ok = await resolvePayout(
        db,
        null,
        { payoutId: payout.id, actor: { id: admin3, role: 'admin' }, outcome: 'failed' },
        LATER,
      );
      expect(ok.payout.status).toBe('failed');
    });

    it('the admin who recorded the weigh cannot resolve its payout', async () => {
      const { payout } = await stuckPayout({ supervisorId: admin2 });
      await expect(
        resolvePayout(
          db,
          null,
          { payoutId: payout.id, actor: asAdmin2(), outcome: 'failed' },
          LATER,
        ),
      ).rejects.toMatchObject({ reason: 'self_resolution' });
    });

    it('a one-admin deployment can switch the distinct-actor rule off', async () => {
      process.env.TAKASATS__PAYOUTS__RESOLUTION_REQUIRES_DISTINCT_ACTOR = 'false';
      resetSettingsCache();
      const { payout } = await stuckPayout();
      await db.update(payouts).set({ approvedBy: world.adminId }).where(eq(payouts.id, payout.id));
      const ok = await resolvePayout(
        db,
        null,
        { payoutId: payout.id, actor: admin(), outcome: 'failed' },
        LATER,
      );
      expect(ok.payout.status).toBe('failed');
    });

    it('a payout still being sent (fresh, not flagged) cannot be resolved', async () => {
      const { payout } = await stuckPayout();
      await db.delete(anomalyFlags).where(eq(anomalyFlags.flagType, 'payout_uncertain'));
      await expect(
        resolvePayout(db, null, { payoutId: payout.id, actor: admin(), outcome: 'failed' }, NOW),
      ).rejects.toMatchObject({ reason: 'not_resolvable' });
    });

    it('a stale payout without a flag can be resolved', async () => {
      const { payout } = await stuckPayout();
      await db.delete(anomalyFlags).where(eq(anomalyFlags.flagType, 'payout_uncertain'));
      const ok = await resolvePayout(
        db,
        null,
        { payoutId: payout.id, actor: admin(), outcome: 'failed' },
        LATER,
      );
      expect(ok.changed).toBe(true);
    });

    it('a payout that is not in sending is not resolvable', async () => {
      // awaiting_rate: never reached the provider.
      const fresh = await createPayoutForEvent(db, await seedCollectionEvent(db, world));
      await expect(
        resolvePayout(db, null, { payoutId: fresh.id, actor: admin(), outcome: 'failed' }, LATER),
      ).rejects.toBeInstanceOf(PayoutStateError);

      // pending_approval: held for a second person.
      process.env.TAKASATS__PAYOUTS__SECOND_SIGNOFF_THRESHOLD_SATS = '0';
      resetSettingsCache();
      const held = await processPayout(
        db,
        new FakeLightningProvider(),
        (await createPayoutForEvent(db, await seedCollectionEvent(db, world))).id,
        NOW,
      );
      expect(held.status).toBe('pending_approval');
      await expect(
        resolvePayout(
          db,
          null,
          { payoutId: held.id, actor: admin(), outcome: 'paid', reference: 'tx-123456' },
          LATER,
        ),
      ).rejects.toBeInstanceOf(PayoutStateError);

      // paid by the engine: nothing to resolve, nothing changes.
      process.env.TAKASATS__PAYOUTS__SECOND_SIGNOFF_THRESHOLD_SATS = '50000';
      resetSettingsCache();
      const fake = new FakeLightningProvider();
      const paid = await processPayout(
        db,
        fake,
        (await createPayoutForEvent(db, await seedCollectionEvent(db, world))).id,
        NOW,
      );
      expect(paid.status).toBe('paid');
      await expect(
        resolvePayout(db, null, { payoutId: paid.id, actor: admin(), outcome: 'failed' }, LATER),
      ).rejects.toBeInstanceOf(PayoutStateError);
      expect((await reload(paid.id)).status).toBe('paid');
    });

    it('an unknown payout is a not-found error', async () => {
      await expect(
        resolvePayout(
          db,
          null,
          { payoutId: '00000000-0000-4000-8000-000000000000', actor: admin(), outcome: 'failed' },
          LATER,
        ),
      ).rejects.toThrow(/not found/i);
    });
  });

  describe('idempotency', () => {
    it('repeating the same resolution changes nothing and adds no ledger entry', async () => {
      const { payout } = await stuckPayout();
      const input = { payoutId: payout.id, actor: admin(), outcome: 'paid' as const };
      await resolvePayout(db, null, input, LATER);
      const entries = await ledgerCount();
      const again = await resolvePayout(db, null, input, LATER);
      expect(again.changed).toBe(false);
      expect(again.payout.status).toBe('paid');
      expect(await ledgerCount()).toBe(entries);
      expect(await resolutions()).toHaveLength(1);
      // Another admin repeating it is fine too.
      expect((await resolvePayout(db, null, { ...input, actor: asAdmin2() }, LATER)).changed).toBe(
        false,
      );
    });

    it('a conflicting resolution is refused and nothing changes', async () => {
      const { payout } = await stuckPayout();
      await resolvePayout(
        db,
        null,
        { payoutId: payout.id, actor: admin(), outcome: 'paid' },
        LATER,
      );
      const entries = await ledgerCount();
      await expect(
        resolvePayout(
          db,
          null,
          { payoutId: payout.id, actor: asAdmin2(), outcome: 'failed' },
          LATER,
        ),
      ).rejects.toMatchObject({ reason: 'resolution_final' });
      expect((await reload(payout.id)).status).toBe('paid');
      expect(await ledgerCount()).toBe(entries);
    });

    it('a resolved-paid payout cannot be paid again by the engine', async () => {
      const { payout } = await stuckPayout();
      await resolvePayout(
        db,
        null,
        { payoutId: payout.id, actor: admin(), outcome: 'paid' },
        LATER,
      );
      const fake = new FakeLightningProvider();
      await processPayout(db, fake, payout.id, LATER);
      await expect(retryPayout(db, payout.id)).rejects.toBeInstanceOf(PayoutStateError);
      expect(fake.paymentsSent()).toHaveLength(0);
    });

    it('two simultaneous identical resolutions write exactly one entry', async () => {
      const { payout } = await stuckPayout();
      const results = await Promise.allSettled([
        resolvePayout(db, null, { payoutId: payout.id, actor: admin(), outcome: 'paid' }, LATER),
        resolvePayout(db, null, { payoutId: payout.id, actor: asAdmin2(), outcome: 'paid' }, LATER),
        resolvePayout(
          db,
          null,
          { payoutId: payout.id, actor: { id: admin3, role: 'admin' }, outcome: 'paid' },
          LATER,
        ),
      ]);
      const changed = results.filter((r) => r.status === 'fulfilled' && r.value.changed);
      expect(changed).toHaveLength(1);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(0);
      expect(await resolutions()).toHaveLength(1);
      expect((await verifyChain(db)).ok).toBe(true);
    });

    it('simultaneous paid and failed: one wins, the other is refused, one resolution exists', async () => {
      const { payout } = await stuckPayout();
      const results = await Promise.allSettled([
        resolvePayout(db, null, { payoutId: payout.id, actor: admin(), outcome: 'paid' }, LATER),
        resolvePayout(
          db,
          null,
          { payoutId: payout.id, actor: asAdmin2(), outcome: 'failed' },
          LATER,
        ),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
      expect(await resolutions()).toHaveLength(1);
      const [resolution] = await resolutions();
      expect((await reload(payout.id)).status).toBe(resolution!.outcome);
    });
  });

  describe('the provider can veto', () => {
    it('failed is refused when the provider says the payment is paid', async () => {
      const { payout } = await stuckPayout();
      const provider = lookupProvider({ state: 'paid', paymentRef: HASH, matches: 1 });
      await expect(
        resolvePayout(
          db,
          provider,
          { payoutId: payout.id, actor: admin(), outcome: 'failed' },
          LATER,
        ),
      ).rejects.toMatchObject({ reason: 'provider_disagrees' });
      expect((await reload(payout.id)).status).toBe('sending');
      expect(provider.lookupPayment).toHaveBeenCalledWith({
        paymentRef: HASH,
        idempotencyKey: payout.id,
      });
    });

    it('failed is refused while the provider says it is pending', async () => {
      const { payout } = await stuckPayout();
      await expect(
        resolvePayout(
          db,
          lookupProvider({ state: 'pending', matches: 1 }),
          { payoutId: payout.id, actor: admin(), outcome: 'failed' },
          LATER,
        ),
      ).rejects.toMatchObject({ reason: 'provider_disagrees' });
    });

    it('paid is refused when the provider says it failed', async () => {
      const { payout } = await stuckPayout();
      await expect(
        resolvePayout(
          db,
          lookupProvider({ state: 'failed', matches: 1 }),
          { payoutId: payout.id, actor: admin(), outcome: 'paid' },
          LATER,
        ),
      ).rejects.toMatchObject({ reason: 'provider_disagrees' });
    });

    it('not_found and a failing lookup are no evidence: the person decides, and the state is recorded', async () => {
      const a = await stuckPayout();
      await resolvePayout(
        db,
        lookupProvider({ state: 'not_found', matches: 0 }),
        { payoutId: a.payout.id, actor: admin(), outcome: 'failed' },
        LATER,
      );
      const b = await stuckPayout();
      await resolvePayout(
        db,
        lookupProvider(new Error('Blink is down')),
        { payoutId: b.payout.id, actor: admin(), outcome: 'failed' },
        LATER,
      );
      const states = (await resolutions()).map((r) => r.providerState).sort();
      expect(states).toEqual(['error', 'not_found']);
    });

    it('a "paid" the provider shows for a hash another payout already settled is not evidence', async () => {
      // The ALREADY_PAID case: a destination reused an invoice. This payout truly was not paid.
      const settled = await stuckPayout();
      await resolvePayout(
        db,
        null,
        { payoutId: settled.payout.id, actor: admin(), outcome: 'paid' },
        LATER,
      );
      const duplicate = await stuckPayout(); // same hash HASH, stored on a second payout
      const ok = await resolvePayout(
        db,
        lookupProvider({ state: 'paid', paymentRef: HASH, matches: 1 }),
        { payoutId: duplicate.payout.id, actor: asAdmin2(), outcome: 'failed' },
        LATER,
      );
      expect(ok.payout.status).toBe('failed');
      // ...and it cannot be resolved as paid with that hash either.
      const third = await stuckPayout();
      await expect(
        resolvePayout(
          db,
          null,
          { payoutId: third.payout.id, actor: admin(), outcome: 'paid' },
          LATER,
        ),
      ).rejects.toMatchObject({ reason: 'reference_in_use' });
    });

    it('a provider from another rail is not asked', async () => {
      const { payout } = await stuckPayout(); // sent through `fake`
      const other = { kind: 'blink' as const, lookupPayment: vi.fn() };
      await resolvePayout(
        db,
        other,
        { payoutId: payout.id, actor: admin(), outcome: 'failed' },
        LATER,
      );
      expect(other.lookupPayment).not.toHaveBeenCalled();
    });
  });

  describe('checkPayout (read only)', () => {
    it('reports what the provider says and changes nothing', async () => {
      const { payout } = await stuckPayout();
      const provider = lookupProvider({
        state: 'paid',
        paymentRef: HASH,
        proofVerified: true,
        matches: 1,
      });
      const entries = await ledgerCount();
      const result = await checkPayout(db, provider, {
        payoutId: payout.id,
        actor: { role: 'admin' },
      });
      expect(result).toMatchObject({
        supported: true,
        lookup: { state: 'paid', proofVerified: true },
      });
      expect((await reload(payout.id)).status).toBe('sending');
      expect(await ledgerCount()).toBe(entries);
      expect(await resolutions()).toHaveLength(0);
    });

    it('says so when the provider cannot look payments up, or is another rail', async () => {
      const { payout } = await stuckPayout();
      expect(
        await checkPayout(db, null, { payoutId: payout.id, actor: { role: 'admin' } }),
      ).toMatchObject({
        supported: false,
        reason: 'provider_cannot_look_up',
      });
      expect(
        await checkPayout(
          db,
          { kind: 'blink', lookupPayment: vi.fn() },
          { payoutId: payout.id, actor: { role: 'admin' } },
        ),
      ).toMatchObject({ supported: false, reason: 'wrong_provider' });
    });

    it('refuses a payout that was never sent', async () => {
      const payout = await createPayoutForEvent(db, await seedCollectionEvent(db, world));
      await expect(
        checkPayout(db, lookupProvider({ state: 'paid' }), {
          payoutId: payout.id,
          actor: { role: 'admin' },
        }),
      ).rejects.toMatchObject({ reason: 'nothing_to_check' });
    });

    it('works against the demo rail end to end: the fake knows what it paid', async () => {
      const fake = new FakeLightningProvider();
      const payout = await createPayoutForEvent(db, await seedCollectionEvent(db, world));
      await processPayout(db, fake, payout.id, NOW);
      const result = await checkPayout(db, fake, { payoutId: payout.id, actor: { role: 'admin' } });
      expect(result).toMatchObject({ supported: true, lookup: { state: 'paid' } });
    });
  });

  it('a recorded resolution can never be edited or deleted', async () => {
    const { payout } = await stuckPayout();
    await resolvePayout(
      db,
      null,
      { payoutId: payout.id, actor: admin(), outcome: 'failed' },
      LATER,
    );
    await expect(db.execute(sql`update payout_resolutions set outcome = 'paid'`)).rejects.toThrow();
    await expect(db.execute(sql`delete from payout_resolutions`)).rejects.toThrow();
    expect(await resolutions()).toHaveLength(1);
  });
});
