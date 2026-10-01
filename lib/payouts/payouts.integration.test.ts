// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The payout state machine against a real Postgres (REQUIREMENTS §10.4, §12.5). Every
 * test that could pay somebody asserts how many payments the provider actually received.
 */

import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSettingsCache } from '@/lib/config';
import { getDb } from '@/lib/db/client';
import { anomalyFlags, collectorPaymentDestinations, collectors, payouts } from '@/lib/db/schema';
import { verifyChain } from '@/lib/ledger';
import { FakeLightningProvider } from '@/lib/lightning';
import {
  InvalidLightningAddressError,
  LightningEndpointUnreachableError,
  PaymentFailedError,
} from '@/lib/lightning/errors';
import type { LightningProvider } from '@/lib/lightning/LightningProvider';
import { sats } from '@/lib/money';
import {
  DESTINATION_ADDRESS,
  NOW,
  PAYOUT_TRUNCATE,
  type PayoutWorld,
  seedCollectionEvent,
  seedPayoutWorld,
  seedSnapshot,
} from '@/lib/testing/payout-fixtures';
import {
  approvePayout,
  createPayoutForEvent,
  PayoutApprovalError,
  PayoutStateError,
  processPayout,
  retryPayout,
  sweepablePayoutIds,
} from './index';

const hasDatabase = Boolean(process.env.DATABASE_URL);

/** Payout policy for a test; the engine reads it through `getSettings()`. */
function configure({ threshold = 50_000, firstPayout = false } = {}): void {
  process.env.TAKASATS__PAYOUTS__SECOND_SIGNOFF_THRESHOLD_SATS = String(threshold);
  process.env.TAKASATS__PAYOUTS__REQUIRE_APPROVAL_FIRST_PAYOUT = String(firstPayout);
  resetSettingsCache();
}

type TestProvider = Pick<LightningProvider, 'kind' | 'pay' | 'getFloatBalance'>;

/** A provider whose `pay` fails in a chosen way. */
function failingProvider(error: Error): TestProvider & { pay: ReturnType<typeof vi.fn> } {
  return {
    kind: 'fake',
    pay: vi.fn(async () => {
      throw error;
    }),
    getFloatBalance: async () => ({ available: sats(1_000_000), asOf: NOW }),
  };
}

describe.skipIf(!hasDatabase)('lib/payouts (integration)', () => {
  const db = hasDatabase ? getDb() : undefined!;
  let world: PayoutWorld;
  let fake: FakeLightningProvider;
  let infoLog: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    infoLog = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    configure();
    world = await seedPayoutWorld(db);
    fake = new FakeLightningProvider();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.TAKASATS__PAYOUTS__SECOND_SIGNOFF_THRESHOLD_SATS;
    delete process.env.TAKASATS__PAYOUTS__REQUIRE_APPROVAL_FIRST_PAYOUT;
    resetSettingsCache();
  });
  afterAll(async () => {
    if (hasDatabase) {
      await db.execute(PAYOUT_TRUNCATE);
    }
  });

  /** A fresh event + its payout, processed once with the shared fake rail. */
  async function run(supervisorId?: string) {
    const eventId = await seedCollectionEvent(db, world, supervisorId ? { supervisorId } : {});
    const payout = await createPayoutForEvent(db, eventId);
    return processPayout(db, fake, payout.id, NOW);
  }
  async function newPayout() {
    return createPayoutForEvent(db, await seedCollectionEvent(db, world));
  }
  const reload = async (id: string) => {
    const [row] = await db.select().from(payouts).where(eq(payouts.id, id));
    return row!;
  };
  const uncertainFlags = () =>
    db.select().from(anomalyFlags).where(eq(anomalyFlags.flagType, 'payout_uncertain'));

  describe('createPayoutForEvent', () => {
    it('is idempotent: one payout per collection event', async () => {
      const eventId = await seedCollectionEvent(db, world);
      const first = await createPayoutForEvent(db, eventId);
      const second = await createPayoutForEvent(db, eventId);
      expect(second.id).toBe(first.id);
      expect(first.status).toBe('awaiting_rate');
      expect(first.fiatCurrency).toBe('KES');
      const count = await db.execute(sql`select count(*)::int as n from payouts`);
      expect(count[0]?.n).toBe(1);
    });

    it('rejects an unknown event', async () => {
      await expect(
        createPayoutForEvent(db, '00000000-0000-4000-8000-000000000000'),
      ).rejects.toThrow(/not found/i);
    });
  });

  describe('the happy path', () => {
    it('prices at the snapshot, sends to the verified destination, and chains a ledger entry', async () => {
      const pay = vi.spyOn(fake, 'pay');
      const result = await run();

      expect(result.status).toBe('paid');
      expect(result.amountSats).toBe(1000); // 2.5 kg × 2000 = 5000 minor @ KES 5,000,000/BTC
      expect(result.amountFiatMinor).toBe(5000);
      expect(result.provider).toBe('fake');
      expect(result.providerPaymentRef).toBe(result.id); // the payout id is the idempotency key
      expect(result.attempts).toBe(1);
      expect(result.lastError).toBeNull();
      expect(result.ledgerEntryId).not.toBeNull();

      // The destination came from the stored verified row.
      expect(pay).toHaveBeenCalledTimes(1);
      expect(pay.mock.calls[0]?.[0]).toEqual({ lnurlOrAddress: DESTINATION_ADDRESS });
      expect(fake.paymentsSent()).toHaveLength(1);

      const chain = await verifyChain(db);
      expect(chain.ok).toBe(true);
      const entry = await db.execute(
        sql`select entry_type from ledger_entries where id = ${result.ledgerEntryId}`,
      );
      expect(entry[0]?.entry_type).toBe('payout');
    });

    it('never logs the address or the amount', async () => {
      await run();
      const lines = infoLog.mock.calls.map(
        (call: unknown[]) => JSON.parse(String(call[1])) as object,
      );
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(Object.keys(line).sort()).toEqual(
          ['attempts', 'lastError', 'payoutId', 'provider', 'status'].sort(),
        );
      }
      expect(JSON.stringify(infoLog.mock.calls)).not.toContain('wallet.example');
    });

    it('a second processPayout of a paid payout is a no-op', async () => {
      const first = await run();
      const again = await processPayout(db, fake, first.id, NOW);
      expect(again.status).toBe('paid');
      expect(fake.paymentsSent()).toHaveLength(1);
    });
  });

  describe('collector and destination gates', () => {
    it('parks awaiting_destination when the collector has none — nothing is paid', async () => {
      await db.delete(collectorPaymentDestinations);
      const result = await run();
      expect(result.status).toBe('awaiting_destination');
      expect(result.lastError).toBe('no_destination');
      expect(fake.paymentsSent()).toHaveLength(0);
    });

    it('does not pay a destination that is only pending_validation', async () => {
      await db
        .update(collectorPaymentDestinations)
        .set({ status: 'pending_validation', verifiedAt: null });
      const result = await run();
      expect(result.status).toBe('awaiting_destination');
      expect(result.lastError).toBe('destination_not_verified');
      expect(fake.paymentsSent()).toHaveLength(0);
    });

    it.each(['revoked', 'pending'] as const)(
      'fails a %s collector — never paid',
      async (status) => {
        await db.update(collectors).set({ status });
        const result = await run();
        expect(result.status).toBe('failed');
        expect(result.lastError).toBe('collector_not_authorized');
        expect(fake.paymentsSent()).toHaveLength(0);
      },
    );

    it('goes ahead once a verified destination appears', async () => {
      await db
        .update(collectorPaymentDestinations)
        .set({ status: 'pending_validation', verifiedAt: null });
      const parked = await run();
      await db.update(collectorPaymentDestinations).set({ status: 'verified' });
      const result = await processPayout(db, fake, parked.id, NOW);
      expect(result.status).toBe('paid');
      expect(fake.paymentsSent()).toHaveLength(1);
    });
  });

  describe('pricing', () => {
    it('parks awaiting_rate on a stale snapshot, and on none at all', async () => {
      await db.execute(sql`delete from exchange_rate_snapshots`);
      expect((await run()).lastError).toBe('stale_exchange_rate');

      await seedSnapshot(db, new Date(NOW.getTime() - 2 * 3_600_000));
      const stale = await run();
      expect(stale.status).toBe('awaiting_rate');
      expect(stale.amountSats).toBeNull();
      expect(fake.paymentsSent()).toHaveLength(0);

      await seedSnapshot(db, new Date(NOW.getTime() - 10_000));
      const result = await processPayout(db, fake, stale.id, NOW);
      expect(result.status).toBe('paid');
    });

    it('uses the rate that applied to the event, not the current one (D-14)', async () => {
      const eventId = await seedCollectionEvent(db, world);
      // The rate doubles AFTER the event was recorded.
      await db.execute(sql`update material_rates set effective_to = now()`);
      await db.execute(
        sql`insert into material_rates (material, rate_fiat_minor, fiat_currency, effective_from) values ('PET', 4000, 'KES', now())`,
      );
      const payout = await createPayoutForEvent(db, eventId);
      const result = await processPayout(db, fake, payout.id, NOW);
      expect(result.status).toBe('paid');
      expect(result.amountFiatMinor).toBe(5000);
      expect(result.amountSats).toBe(1000);
    });

    it('fails an event whose amount rounds to nothing (a 0-sat payout is an error)', async () => {
      await db.execute(sql`update material_rates set rate_fiat_minor = 0`);
      const result = await run();
      expect(result.status).toBe('failed');
      expect(result.lastError).toBe('amount_not_payable');
      expect(fake.paymentsSent()).toHaveLength(0);
    });
  });

  describe('approval', () => {
    it('holds a payout above the threshold, and releases it after a distinct approver', async () => {
      configure({ threshold: 999 }); // 1000 sats is above it
      const held = await run();
      expect(held.status).toBe('pending_approval');
      expect(held.amountSats).toBe(1000); // priced, so the approver sees the figure
      expect(fake.paymentsSent()).toHaveLength(0);

      // Parked payouts stay parked until someone approves — repeated processing changes nothing.
      expect((await processPayout(db, fake, held.id, NOW)).status).toBe('pending_approval');

      const { payout, changed } = await approvePayout(db, {
        payoutId: held.id,
        actor: { id: world.hubLeadId, role: 'hub_lead' },
      });
      expect(changed).toBe(true);
      expect(payout.status).toBe('queued');
      expect(payout.approvedBy).toBe(world.hubLeadId);

      const result = await processPayout(db, fake, held.id, NOW);
      expect(result.status).toBe('paid');
      expect(fake.paymentsSent()).toHaveLength(1);
    });

    it('does not hold a payout at exactly the threshold', async () => {
      configure({ threshold: 1000 });
      expect((await run()).status).toBe('paid');
    });

    it('a threshold of 0 holds EVERY payout for review', async () => {
      configure({ threshold: 0, firstPayout: false });
      expect((await run()).status).toBe('pending_approval');
      expect((await run()).status).toBe('pending_approval');
      expect(fake.paymentsSent()).toHaveLength(0);
    });

    it('holds the first payout to a new destination even when small, then not the next', async () => {
      configure({ firstPayout: true });
      const first = await run();
      expect(first.status).toBe('pending_approval');
      await approvePayout(db, {
        payoutId: first.id,
        actor: { id: world.adminId, role: 'admin' },
      });
      expect((await processPayout(db, fake, first.id, NOW)).status).toBe('paid');

      // The destination has now been paid once: the next small payout goes straight through.
      expect((await run()).status).toBe('paid');
      expect(fake.paymentsSent()).toHaveLength(2);
    });

    it('refuses an approval from the supervisor who recorded the event', async () => {
      configure({ threshold: 0 });
      // A hub lead can record collections too — here the recorder IS the would-be approver.
      const held = await run(world.hubLeadId);
      await expect(
        approvePayout(db, {
          payoutId: held.id,
          actor: { id: world.hubLeadId, role: 'hub_lead' },
        }),
      ).rejects.toMatchObject({ reason: 'self_approval' });
      expect((await reload(held.id)).status).toBe('pending_approval');
    });

    it('refuses a role without payout:approve, however it got here', async () => {
      configure({ threshold: 0 });
      const held = await run();
      await expect(
        approvePayout(db, {
          payoutId: held.id,
          actor: { id: world.otherSupervisorId, role: 'supervisor' },
        }),
      ).rejects.toBeInstanceOf(PayoutApprovalError);
      await expect(
        approvePayout(db, {
          payoutId: held.id,
          actor: { id: world.otherSupervisorId, role: 'partner' },
        }),
      ).rejects.toBeInstanceOf(PayoutApprovalError);
    });

    it('approval is idempotent, and only valid from pending_approval', async () => {
      configure({ threshold: 0 });
      const held = await run();
      const actor = { id: world.hubLeadId, role: 'hub_lead' } as const;
      expect((await approvePayout(db, { payoutId: held.id, actor })).changed).toBe(true);
      const again = await approvePayout(db, {
        payoutId: held.id,
        actor: { id: world.adminId, role: 'admin' },
      });
      expect(again.changed).toBe(false);
      expect(again.payout.approvedBy).toBe(world.hubLeadId); // the first approver stays on record

      configure({ threshold: 50_000 });
      const direct = await run();
      expect(direct.status).toBe('paid');
      // Already paid and never approved: not approvable.
      await expect(approvePayout(db, { payoutId: direct.id, actor })).rejects.toBeInstanceOf(
        PayoutStateError,
      );
    });

    it('an approval does not survive a change of destination', async () => {
      configure({ firstPayout: true });
      const held = await run();
      await approvePayout(db, {
        payoutId: held.id,
        actor: { id: world.hubLeadId, role: 'hub_lead' },
      });

      // Someone swaps the verified destination after the approval was given.
      await db
        .update(collectorPaymentDestinations)
        .set({ status: 'revoked', revokedAt: NOW })
        .where(eq(collectorPaymentDestinations.id, world.destinationId));
      const [replacement] = await db
        .insert(collectorPaymentDestinations)
        .values({
          collectorId: world.collectorId,
          type: 'lightning_address',
          address: 'someone-else@wallet.example',
          status: 'verified',
          verifiedAt: NOW,
        })
        .returning({ id: collectorPaymentDestinations.id });

      const result = await processPayout(db, fake, held.id, NOW);
      expect(result.status).toBe('pending_approval');
      expect(result.approvedBy).toBeNull();
      expect(result.destinationId).toBe(replacement!.id);
      expect(fake.paymentsSent()).toHaveLength(0);
    });
  });

  describe('float', () => {
    it('parks pending_float when the float cannot cover it, and pays once topped up', async () => {
      const small = new FakeLightningProvider({ initialFloatSats: 500 });
      const payout = await newPayout();
      const parked = await processPayout(db, small, payout.id, NOW);
      expect(parked.status).toBe('pending_float');
      expect(parked.lastError).toBe('insufficient_float');
      expect(small.paymentsSent()).toHaveLength(0);

      const topped = new FakeLightningProvider({ initialFloatSats: 5000 });
      const result = await processPayout(db, topped, payout.id, NOW);
      expect(result.status).toBe('paid');
      expect(topped.paymentsSent()).toHaveLength(1);
    });

    it('parks pending_float when the balance cannot be read', async () => {
      const broken: TestProvider = {
        kind: 'fake',
        pay: vi.fn(),
        getFloatBalance: async () => {
          throw new Error('rail down');
        },
      };
      const payout = await newPayout();
      const parked = await processPayout(db, broken, payout.id, NOW);
      expect(parked.status).toBe('pending_float');
      expect(parked.lastError).toBe('float_unavailable');
      expect(broken.pay).not.toHaveBeenCalled();
    });
  });

  describe('never pays twice', () => {
    it('sequential repeats pay exactly once', async () => {
      const payout = await newPayout();
      for (let i = 0; i < 4; i += 1) {
        await processPayout(db, fake, payout.id, NOW);
      }
      expect(fake.paymentsSent()).toHaveLength(1);
      expect((await reload(payout.id)).status).toBe('paid');
    });

    it('concurrent callers pay exactly once', async () => {
      const payout = await newPayout();
      const results = await Promise.all(
        Array.from({ length: 8 }, () => processPayout(db, fake, payout.id, NOW)),
      );
      expect(fake.paymentsSent()).toHaveLength(1);
      expect(results.filter((r) => r.status === 'paid').length).toBeGreaterThanOrEqual(1);
      const final = await reload(payout.id);
      expect(final.status).toBe('paid');
      expect(final.attempts).toBe(1);
      expect((await verifyChain(db)).ok).toBe(true);
    });

    it('a payout stuck in sending is flagged payout_uncertain — never re-sent', async () => {
      configure({ threshold: 0 }); // park it priced, then fake the crash
      const held = await run();
      await db.execute(
        sql`update payouts set status = 'sending', attempted_at = ${new Date(NOW.getTime() - 3_600_000).toISOString()} where id = ${held.id}`,
      );

      const later = new Date(NOW.getTime() + 60_000);
      for (let i = 0; i < 3; i += 1) {
        const result = await processPayout(db, fake, held.id, later);
        expect(result.status).toBe('sending');
      }
      expect(fake.paymentsSent()).toHaveLength(0);
      const flags = await uncertainFlags();
      expect(flags).toHaveLength(1); // once, however many times it is seen
      expect(flags[0]?.context).toMatchObject({ payoutId: held.id, reason: 'stale_sending' });
    });

    it('a fresh sending payout is left alone and not flagged', async () => {
      configure({ threshold: 0 });
      const held = await run();
      await db.execute(
        sql`update payouts set status = 'sending', attempted_at = ${NOW.toISOString()} where id = ${held.id}`,
      );
      await processPayout(db, fake, held.id, new Date(NOW.getTime() + 60_000));
      expect(await uncertainFlags()).toHaveLength(0);
      expect(fake.paymentsSent()).toHaveLength(0);
    });

    it('an unclassified provider error leaves it sending and flagged, not failed', async () => {
      const provider = failingProvider(new Error('socket hang up'));
      const payout = await newPayout();
      const result = await processPayout(db, provider, payout.id, NOW);
      expect(result.status).toBe('sending');
      expect(result.lastError).toBe('outcome_unknown');
      expect(await uncertainFlags()).toHaveLength(1);

      // Neither a re-run nor retry can resend it.
      await processPayout(db, provider, payout.id, new Date(NOW.getTime() + 3_600_000));
      expect(provider.pay).toHaveBeenCalledTimes(1);
      await expect(retryPayout(db, payout.id)).rejects.toBeInstanceOf(PayoutStateError);
      expect(await uncertainFlags()).toHaveLength(1);
    });
  });

  describe('provider failures', () => {
    it('a payment failure fails the payout with a short code, and retry sends it', async () => {
      const payout = await newPayout();
      const failed = await processPayout(
        db,
        failingProvider(new PaymentFailedError('route not found: amina@wallet.example')),
        payout.id,
        NOW,
      );
      expect(failed.status).toBe('failed');
      expect(failed.lastError).toBe('payment_failed'); // the provider message (an address) is not stored
      expect(failed.provider).toBe('fake');

      // `failed` is not re-run by processing alone…
      expect((await processPayout(db, fake, payout.id, NOW)).status).toBe('failed');
      expect(fake.paymentsSent()).toHaveLength(0);

      // …a staff retry puts it back, and it is paid.
      const retry = await retryPayout(db, payout.id);
      expect(retry.changed).toBe(true);
      expect(retry.payout.status).toBe('queued');
      expect((await retryPayout(db, payout.id)).changed).toBe(false);
      const result = await processPayout(db, fake, payout.id, NOW);
      expect(result.status).toBe('paid');
      expect(result.attempts).toBe(2);
      expect(fake.paymentsSent()).toHaveLength(1);
    });

    it('retry is refused for any state other than failed', async () => {
      const done = await run();
      await expect(retryPayout(db, done.id)).rejects.toBeInstanceOf(PayoutStateError);
    });

    it('an unreachable destination goes back to queued (nothing was sent)', async () => {
      const payout = await newPayout();
      const result = await processPayout(
        db,
        failingProvider(new LightningEndpointUnreachableError('timeout')),
        payout.id,
        NOW,
      );
      expect(result.status).toBe('queued');
      expect(result.lastError).toBe('destination_unreachable');
    });

    it('a destination the rail rejects fails the payout (nothing was sent)', async () => {
      const payout = await newPayout();
      const result = await processPayout(
        db,
        failingProvider(new InvalidLightningAddressError('not payable')),
        payout.id,
        NOW,
      );
      expect(result.status).toBe('failed');
      expect(result.lastError).toBe('destination_rejected');
    });
  });

  describe('the sweeper', () => {
    it('lists parked payouts that may now be resolvable, and leaves approval holds alone', async () => {
      const queued = await processPayout(
        db,
        failingProvider(new LightningEndpointUnreachableError('timeout')),
        (await newPayout()).id,
        NOW,
      );
      expect(queued.status).toBe('queued');
      const rate = await newPayout(); // awaiting_rate
      await db.update(collectorPaymentDestinations).set({ status: 'revoked' });
      const noDestination = await run(); // awaiting_destination, nothing verified

      configure({ threshold: 0 });
      await db.update(collectorPaymentDestinations).set({ status: 'verified' });
      const held = await run(); // pending_approval

      const ids = await sweepablePayoutIds(db);
      expect(ids).toContain(queued.id);
      expect(ids).toContain(rate.id);
      expect(ids).toContain(noDestination.id); // its collector has a verified destination again
      expect(ids).not.toContain(held.id);
    });

    it('does not list an awaiting_destination payout whose collector still has none', async () => {
      await db.delete(collectorPaymentDestinations);
      const parked = await run();
      expect(await sweepablePayoutIds(db)).not.toContain(parked.id);
    });
  });

  describe('database guarantees', () => {
    it('refuses a paid payout with no ledger entry', async () => {
      const payout = await newPayout();
      await expect(
        db.execute(sql`update payouts set status = 'paid' where id = ${payout.id}`),
      ).rejects.toThrow();
    });

    it('refuses a priced status without amounts', async () => {
      const payout = await newPayout();
      await expect(
        db.execute(sql`update payouts set status = 'queued' where id = ${payout.id}`),
      ).rejects.toThrow();
    });
  });
});
