// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The whole money story on a real database with the demo rail, in the order a programme lives it:
 *
 *   an admin proposes a refill -> two other admins approve -> the transfer is recorded -> the float
 *   arrives and is confirmed -> a supervisor registers a collector and a wallet -> a hub lead
 *   authorizes -> the supervisor's weigh syncs -> the payout waits for approval -> a second person
 *   approves -> the worker pays exactly once -> the ledger chain and a signed checkpoint verify.
 *
 * Nobody here can skip a step: each "must not" is asserted next to the "may".
 */

import { randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/storage', () => ({ photoUrlFor: vi.fn(async () => null) }));

import { resetSettingsCache } from '@/lib/config';
import { attachDestination, decideCollectorAuthorization, enrolCollector } from '@/lib/collectors';
import { ingestCollectionEvent, type SyncEventInput } from '@/lib/collection-events';
import { getDb } from '@/lib/db/client';
import {
  collectionEvents,
  exchangeRateSnapshots,
  ledgerEntries,
  materialRates,
  payouts,
  sessions,
  sessionSupervisors,
} from '@/lib/db/schema';
import { verifyChain } from '@/lib/ledger';
import { createCheckpoint, verifyLedger } from '@/lib/ledger/checkpoints';
import { loadSigningKey, publicKeyOf } from '@/lib/ledger/signing';
import { FakeLightningProvider } from '@/lib/lightning';
import { assembleCollectionEvent } from '@/lib/sync';
import { createStaff } from '@/lib/testing/fixtures';
import { TREASURY_TRUNCATE } from '@/lib/testing/treasury-fixtures';
import {
  approveTopup,
  confirmTopup,
  proposeTopup,
  recordTopupTransfer,
  TopupApprovalError,
} from '@/lib/treasury';
import { approvePayout, PayoutApprovalError, processPayout } from './index';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const RECORDED_AT = new Date('2026-06-10T10:00:00.000Z');
const NOW = new Date('2026-06-10T10:05:00.000Z');
const WALLET = 'amina@wallet.example';

describe.skipIf(!hasDatabase)('the whole money story (demo rail, real database)', () => {
  const db = hasDatabase ? getDb() : undefined!;
  const rail = new FakeLightningProvider({ initialFloatSats: 0 });
  const seed = randomBytes(32).toString('base64');

  beforeAll(() => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    // 5,000,000 KES per BTC and 2000 minor per kg: 2.5 kg is 1000 sats. Hold EVERY payout for review.
    process.env.TAKASATS__PAYOUTS__SECOND_SIGNOFF_THRESHOLD_SATS = '0';
    process.env.TAKASATS__TREASURY__TOPUP_APPROVALS_REQUIRED = '2';
    process.env.TAKASATS__TREASURY__HOT_WALLET_CAP_SATS = '0';
    resetSettingsCache();
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    for (const key of [
      'TAKASATS__PAYOUTS__SECOND_SIGNOFF_THRESHOLD_SATS',
      'TAKASATS__TREASURY__TOPUP_APPROVALS_REQUIRED',
      'TAKASATS__TREASURY__HOT_WALLET_CAP_SATS',
    ]) {
      delete process.env[key];
    }
    resetSettingsCache();
    if (hasDatabase) {
      await db.execute(TREASURY_TRUNCATE);
      await db.execute(sql`truncate ledger_checkpoints`);
    }
  });

  it('runs from an empty float to a paid, verified collector', async () => {
    await db.execute(TREASURY_TRUNCATE);
    await db.execute(sql`truncate ledger_checkpoints`);
    const adminA = await createStaff(db, 'admin', 'Admin A');
    const adminB = await createStaff(db, 'admin', 'Admin B');
    const adminC = await createStaff(db, 'admin', 'Admin C');
    const hubLead = await createStaff(db, 'hub_lead', 'Hub Lead');
    const supervisor = await createStaff(db, 'supervisor', 'Field');

    // ── 1. The pool refills the hot wallet by a recorded vote ────────────────────────────────
    expect((await rail.getFloatBalance()).available).toBe(0);
    const proposed = await proposeTopup(db, rail, { amountSats: 100_000, actor: adminA });
    expect(proposed.topup.status).toBe('proposed');
    await expect(
      approveTopup(db, rail, { topupId: proposed.topup.id, actor: adminA }),
    ).rejects.toBeInstanceOf(TopupApprovalError); // the proposer cannot approve their own proposal
    await expect(
      approveTopup(db, rail, { topupId: proposed.topup.id, actor: hubLead }),
    ).rejects.toBeInstanceOf(TopupApprovalError); // a hub lead holds no treasury scope
    expect(
      (await approveTopup(db, rail, { topupId: proposed.topup.id, actor: adminB })).topup.status,
    ).toBe('proposed'); // one approval is not a quorum
    expect(
      (await approveTopup(db, rail, { topupId: proposed.topup.id, actor: adminC })).topup.status,
    ).toBe('approved');
    const transferred = await recordTopupTransfer(db, rail, {
      topupId: proposed.topup.id,
      reference: 'ABC123txid',
      actor: adminA,
    });
    expect(transferred.topup.status).toBe('transferred');
    // The funds are not taken on anyone's word: until the balance shows them, it is not confirmed.
    expect(
      (await confirmTopup(db, rail, { topupId: proposed.topup.id, actor: adminB })).arrived,
    ).toBe(false);
    rail.fund(100_000); // the pool's transfer lands in the hot wallet
    const confirmed = await confirmTopup(db, rail, { topupId: proposed.topup.id, actor: adminB });
    expect(confirmed.arrived).toBe(true);
    expect(confirmed.topup.status).toBe('confirmed');

    // ── 2. Programme data: a rate, a price, a session with the supervisor on it ──────────────
    const [rate] = await db
      .insert(materialRates)
      .values({
        material: 'PET',
        rateFiatMinor: 2000,
        fiatCurrency: 'KES',
        effectiveFrom: new Date('2026-01-01T00:00:00Z'),
      })
      .returning({ id: materialRates.id });
    await db.insert(exchangeRateSnapshots).values({
      base: 'BTC',
      quote: 'KES',
      rate: '5000000',
      sources: [{ source: 'test', rate: 5_000_000 }],
      fetchedAt: new Date(NOW.getTime() - 60_000),
    });
    const [session] = await db
      .insert(sessions)
      .values({
        location: 'Hub',
        status: 'active',
        scheduledStart: new Date('2026-06-10T08:00:00Z'),
        scheduledEnd: new Date('2026-06-10T14:00:00Z'),
      })
      .returning({ id: sessions.id });
    await db
      .insert(sessionSupervisors)
      .values({ sessionId: session!.id, supervisorId: supervisor.id });

    // ── 3. A supervisor registers a collector and a wallet; nothing is payable yet ───────────
    const collector = await enrolCollector(db, { alias: 'Amina' }, supervisor);
    expect(collector.status).toBe('pending');
    const attached = await attachDestination(
      db,
      rail,
      { collectorId: collector.id, rawCode: WALLET },
      supervisor,
    );
    expect(attached.destination.status).toBe('verified');

    const makeEvent = async (): Promise<SyncEventInput> => {
      const event = await assembleCollectionEvent(
        {
          collectorId: collector.id,
          supervisorId: supervisor.id,
          sessionId: session!.id,
          material: 'PET',
          weightKg: 2.5,
          rateId: rate!.id,
          rateFiatMinor: 2000,
          exchangeRate: 5_000_000,
          photoSha256: 'e'.repeat(64),
          geo: { kind: 'fix', lat: -1.29, lng: 36.82, accuracyM: 8 },
          registrationType: 'walk_in',
        },
        { recordedAt: RECORDED_AT },
      );
      return { ...event } as unknown as SyncEventInput;
    };
    const first = await makeEvent();
    const refused = await ingestCollectionEvent(db, first);
    expect(refused).toMatchObject({ status: 'needs_attention', code: 'collector_not_authorized' });
    expect(await db.select().from(payouts)).toHaveLength(0); // no payout for an unauthorized collector

    // ── 4. A hub lead authorizes; the weigh now syncs ────────────────────────────────────────
    await decideCollectorAuthorization(db, {
      collectorId: collector.id,
      decision: 'authorize',
      actor: hubLead,
    });
    const result = await ingestCollectionEvent(db, first);
    expect(result.status).toBe('confirmed');
    const replay = await ingestCollectionEvent(db, first); // a resent sync changes nothing
    expect(replay).toEqual(result);
    const [event] = await db
      .select()
      .from(collectionEvents)
      .where(eq(collectionEvents.id, first.id));
    expect(event?.supervisorId).toBe(supervisor.id);
    const [payout] = await db.select().from(payouts);
    expect(await db.select().from(payouts)).toHaveLength(1);

    // ── 5. The payout waits for a second person ──────────────────────────────────────────────
    const held = await processPayout(db, rail, payout!.id, NOW);
    expect(held.status).toBe('pending_approval');
    expect(held.amountSats).toBe(1000);
    expect(rail.paymentsSent()).toHaveLength(0);
    // Not the person who recorded it, and not a role without the scope.
    await expect(
      approvePayout(db, { payoutId: payout!.id, actor: { id: supervisor.id, role: 'hub_lead' } }),
    ).rejects.toBeInstanceOf(PayoutApprovalError);
    await expect(
      approvePayout(db, { payoutId: payout!.id, actor: { id: supervisor.id, role: 'supervisor' } }),
    ).rejects.toBeInstanceOf(PayoutApprovalError);
    expect((await processPayout(db, rail, payout!.id, NOW)).status).toBe('pending_approval');
    expect(rail.paymentsSent()).toHaveLength(0);

    const approved = await approvePayout(db, { payoutId: payout!.id, actor: hubLead });
    expect(approved.payout.status).toBe('queued');

    // ── 6. The worker pays exactly once, however many times it runs ──────────────────────────
    const runs = await Promise.all(
      Array.from({ length: 6 }, () => processPayout(db, rail, payout!.id, NOW)),
    );
    expect(runs.every((r) => ['sending', 'paid'].includes(r.status))).toBe(true);
    await processPayout(db, rail, payout!.id, new Date(NOW.getTime() + 60_000));
    const [paid] = await db.select().from(payouts).where(eq(payouts.id, payout!.id));
    expect(paid?.status).toBe('paid');
    expect(paid?.providerPaymentRef).toBeTruthy();
    expect(paid?.ledgerEntryId).toBeTruthy();
    expect(rail.paymentsSent()).toHaveLength(1);
    expect(rail.paymentsSent()[0]?.amount).toBe(1000);
    expect((await rail.getFloatBalance()).available).toBe(100_000 - 1000);
    expect(await ingestCollectionEvent(db, first)).toEqual(result);
    expect(rail.paymentsSent()).toHaveLength(1); // a replay of the weigh paid nothing more

    // ── 7. Everything is on one chain that verifies, and a signed checkpoint anchors it ──────
    const types = (
      await db.execute(
        sql`select entry_type, count(*)::int as n from ledger_entries group by entry_type`,
      )
    ).reduce<Record<string, number>>(
      (acc, row) => ({ ...acc, [String(row.entry_type)]: Number(row.n) }),
      {},
    );
    expect(types).toMatchObject({ collection_event: 1, payout: 1, collector_authorization: 1 });
    expect(types.treasury_topup).toBeGreaterThanOrEqual(5); // proposal, 2 approvals, transfer, confirmation
    expect(await verifyChain(db)).toMatchObject({ ok: true });

    const key = loadSigningKey(seed);
    const checkpoint = await createCheckpoint(db, { signingKey: key });
    expect(checkpoint).not.toBeNull();
    const verified = await verifyLedger(db, { publicKey: publicKeyOf(key) });
    expect(verified).toMatchObject({
      ok: true,
      checkpoints: { verified: 1, signaturesChecked: true },
    });
    // A different key does not verify it.
    const stranger = publicKeyOf(loadSigningKey(randomBytes(32).toString('base64')));
    expect((await verifyLedger(db, { publicKey: stranger })).ok).toBe(false);
    expect((await db.select().from(ledgerEntries)).length).toBeGreaterThanOrEqual(8);
  });
});
