// SPDX-License-Identifier: AGPL-3.0-only

import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/storage', () => ({ photoUrlFor: vi.fn(async () => null) }));

import { getDb } from '@/lib/db/client';
import {
  collectionEvents,
  collectors,
  exchangeRateSnapshots,
  ledgerEntries,
  materialRates,
  payouts,
  sessions,
  sessionSupervisors,
  supervisors,
} from '@/lib/db/schema';
import { verifyChain } from '@/lib/ledger';
import { assembleCollectionEvent, collectionEventPayload, contentHash } from '@/lib/sync';
import { decideCollectorAuthorization } from '@/lib/collectors';
import { createStaff } from '@/lib/testing/fixtures';
import {
  ingestCollectionEvent,
  ingestCollectionEvents,
  parseSyncEvent,
  type SyncEventInput,
} from './index';

const HEX64 = 'e'.repeat(64);
const hasDatabase = Boolean(process.env.DATABASE_URL);

const TRUNCATE = sql`truncate collection_events, ledger_entries, session_supervisors, sessions, supervisors, collectors, material_rates, exchange_rate_snapshots restart identity cascade`;

describe.skipIf(!hasDatabase)('lib/collection-events (integration)', () => {
  const db = hasDatabase ? getDb() : undefined!;

  let ctx: {
    collectorId: string;
    supervisorId: string;
    sessionId: string;
    rateId: string;
    recordedAt: Date;
  };

  beforeEach(async () => {
    await db.execute(TRUNCATE);

    const [sup] = await db
      .insert(supervisors)
      .values({
        name: 'Brian',
        phone: `+2547${Math.floor(Math.random() * 1e8)}`,
        passwordHash: 'x:y',
      })
      .returning({ id: supervisors.id });
    const [col] = await db
      .insert(collectors)
      .values({ alias: 'Amina', addressSource: 'byo', publicCode: 'TS-0001', status: 'active' })
      .returning({ id: collectors.id });
    const recordedAt = new Date('2026-06-10T10:00:00.000Z');
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
      sources: [{ source: 't', rate: 5_000_000 }],
      fetchedAt: recordedAt,
    });
    const [ses] = await db
      .insert(sessions)
      .values({
        location: 'Hub',
        status: 'active',
        scheduledStart: new Date('2026-06-10T08:00:00Z'),
        scheduledEnd: new Date('2026-06-10T14:00:00Z'),
      })
      .returning({ id: sessions.id });
    await db.insert(sessionSupervisors).values({ sessionId: ses!.id, supervisorId: sup!.id });

    ctx = {
      collectorId: col!.id,
      supervisorId: sup!.id,
      sessionId: ses!.id,
      rateId: rate!.id,
      recordedAt,
    };
  });
  afterAll(async () => {
    await db.execute(TRUNCATE);
  });

  /** A hash-consistent input. `draft` overrides go through the hasher; `after` is applied raw. */
  async function makeInput(
    draft: Partial<Parameters<typeof assembleCollectionEvent>[0]> = {},
    after: Partial<SyncEventInput> = {},
    recordedAt: Date = ctx.recordedAt,
  ): Promise<SyncEventInput> {
    const event = await assembleCollectionEvent(
      {
        collectorId: ctx.collectorId,
        supervisorId: ctx.supervisorId,
        sessionId: ctx.sessionId,
        material: 'PET',
        weightKg: 2.5,
        rateId: ctx.rateId,
        rateFiatMinor: 2000,
        exchangeRate: 5_000_000,
        photoSha256: HEX64,
        geo: { kind: 'fix', lat: -1.29, lng: 36.82, accuracyM: 8 },
        registrationType: 'tap',
        ...draft,
      },
      { recordedAt },
    );
    return {
      id: event.id,
      collectorId: event.collectorId,
      supervisorId: event.supervisorId,
      sessionId: event.sessionId,
      material: event.material,
      weightKg: event.weightKg,
      rateId: event.rateId,
      rateFiatMinor: event.rateFiatMinor,
      exchangeRate: event.exchangeRate,
      indicativeSats: event.indicativeSats,
      photoSha256: event.photoSha256,
      geo: event.geo,
      registrationType: event.registrationType,
      recordedAt: event.recordedAt,
      weightSource: event.weightSource,
      scaleId: event.scaleId,
      scaleReadingRaw: event.scaleReadingRaw,
      contentHash: event.contentHash,
      ...after,
    };
  }

  it('confirms a valid event: ledger entry + linked detail row, chain verifies', async () => {
    const input = await makeInput();
    const result = await ingestCollectionEvent(db, input);
    expect(result).toEqual({ id: input.id, status: 'confirmed', seq: 1 });

    const [ce] = await db.select().from(collectionEvents);
    expect(ce?.id).toBe(input.id);
    expect(ce?.weightKg).toBe('2.500');
    expect(ce?.ledgerEntryId).toBeTruthy();
    expect(ce?.photoUrl).toBeNull();

    expect(await verifyChain(db)).toMatchObject({ ok: true, count: 1, throughSeq: 1 });
  });

  it('is idempotent — resending returns the same seq, no duplicate', async () => {
    const input = await makeInput();
    const first = await ingestCollectionEvent(db, input);
    const second = await ingestCollectionEvent(db, input);
    expect(second).toEqual(first);
    expect(await db.select().from(collectionEvents)).toHaveLength(1);
  });

  it('needs_attention: content_hash does not match the fields', async () => {
    const input = await makeInput({}, { weightKg: 9.9 }); // hash was for 2.5
    const result = await ingestCollectionEvent(db, input);
    expect(result).toMatchObject({ status: 'needs_attention', code: 'content_hash_mismatch' });
    expect((result as { reason: string }).reason).toMatch(/content_hash/);
  });

  it('needs_attention: rate_id is not the rate active at recorded_at', async () => {
    const input = await makeInput({ rateId: randomUUID() }); // hash matches, rate is wrong
    const result = await ingestCollectionEvent(db, input);
    expect(result).toMatchObject({ status: 'needs_attention', code: 'rate_mismatch' });
    expect((result as { reason: string }).reason).toMatch(/rate_id/);
  });

  it('needs_attention: no rate active for the material', async () => {
    const input = await makeInput({ material: 'unobtainium', rateId: randomUUID() });
    const result = await ingestCollectionEvent(db, input);
    expect(result).toMatchObject({ status: 'needs_attention', code: 'no_rate' });
    expect((result as { reason: string }).reason).toMatch(/no "unobtainium" rate/);
  });

  it('needs_attention: supervisor not assigned to the session', async () => {
    const [other] = await db
      .insert(supervisors)
      .values({ name: 'Zoe', phone: '+254700000009', passwordHash: 'x:y' })
      .returning({ id: supervisors.id });
    const input = await makeInput({ supervisorId: other!.id });
    const result = await ingestCollectionEvent(db, input);
    expect(result).toMatchObject({ status: 'needs_attention', code: 'supervisor_not_assigned' });
    expect((result as { reason: string }).reason).toMatch(/not assigned/);
  });

  describe('the collector authorization gate (D-25)', () => {
    it.each(['pending', 'revoked'] as const)(
      'needs_attention: the collector is %s — and nothing reaches the ledger',
      async (status) => {
        await db.update(collectors).set({ status }).where(eq(collectors.id, ctx.collectorId));
        const input = await makeInput();

        expect(await ingestCollectionEvent(db, input)).toMatchObject({
          status: 'needs_attention',
          code: 'collector_not_authorized',
        });
        expect(await db.select().from(collectionEvents)).toHaveLength(0);
        expect(await db.select().from(ledgerEntries)).toHaveLength(0);
      },
    );

    it('needs_attention (not a 500): the collector does not exist', async () => {
      const input = await makeInput({ collectorId: randomUUID() });
      expect(await ingestCollectionEvent(db, input)).toMatchObject({
        status: 'needs_attention',
        code: 'collector_not_found',
      });
    });

    it('accepts the event again once the collector is authorized — resend is safe', async () => {
      await db
        .update(collectors)
        .set({ status: 'pending' })
        .where(eq(collectors.id, ctx.collectorId));
      const input = await makeInput();
      expect(await ingestCollectionEvent(db, input)).toMatchObject({ status: 'needs_attention' });

      await db
        .update(collectors)
        .set({ status: 'active' })
        .where(eq(collectors.id, ctx.collectorId));
      expect(await ingestCollectionEvent(db, input)).toMatchObject({ status: 'confirmed', seq: 1 });
    });
  });

  describe('weight provenance (D-27)', () => {
    it('defaults to manual and stores no scale fields', async () => {
      const input = await makeInput();
      expect(input.weightSource).toBe('manual');
      await ingestCollectionEvent(db, input);
      const [ce] = await db.select().from(collectionEvents);
      expect(ce).toMatchObject({
        weightSource: 'manual',
        scaleId: null,
        scaleReadingRaw: null,
        verificationLevel: 'V0',
      });
    });

    it('stores the scale reading that was signed on the device', async () => {
      const input = await makeInput({
        weightSource: 'ble_scale',
        scaleId: 'scale-kbr-03',
        scaleReadingRaw: '8.40 kg',
      });
      expect(await ingestCollectionEvent(db, input)).toMatchObject({ status: 'confirmed' });
      const [ce] = await db.select().from(collectionEvents);
      expect(ce).toMatchObject({
        weightSource: 'ble_scale',
        scaleId: 'scale-kbr-03',
        scaleReadingRaw: '8.40 kg',
      });
    });

    it('is tamper-evident: claiming a different source than was hashed is rejected', async () => {
      const input = await makeInput(
        { weightSource: 'ble_scale', scaleId: 'scale-kbr-03' },
        { weightSource: 'manual' },
      );
      expect(await ingestCollectionEvent(db, input)).toMatchObject({
        status: 'needs_attention',
        code: 'content_hash_mismatch',
      });
    });

    it('still verifies an event queued on a device before these fields existed', async () => {
      const event = await assembleCollectionEvent(
        {
          collectorId: ctx.collectorId,
          supervisorId: ctx.supervisorId,
          sessionId: ctx.sessionId,
          material: 'PET',
          weightKg: 2.5,
          rateId: ctx.rateId,
          rateFiatMinor: 2000,
          exchangeRate: 5_000_000,
          photoSha256: HEX64,
          geo: { kind: 'unavailable', reason: 'indoors' },
          registrationType: 'tap',
        },
        { recordedAt: ctx.recordedAt },
      );
      // What an old client hashed: the same facts, with no weight fields at all.
      const legacyHash = await contentHash(
        collectionEventPayload({ ...event, weightSource: undefined } as never),
      );
      const legacy = {
        id: event.id,
        collectorId: event.collectorId,
        supervisorId: event.supervisorId,
        sessionId: event.sessionId,
        material: event.material,
        weightKg: event.weightKg,
        rateId: event.rateId,
        rateFiatMinor: event.rateFiatMinor,
        exchangeRate: event.exchangeRate,
        indicativeSats: event.indicativeSats,
        photoSha256: event.photoSha256,
        geo: event.geo,
        registrationType: event.registrationType,
        recordedAt: event.recordedAt,
        contentHash: legacyHash,
      } satisfies SyncEventInput;

      expect(await ingestCollectionEvent(db, legacy)).toMatchObject({ status: 'confirmed' });
      const [ce] = await db.select().from(collectionEvents);
      expect(ce?.weightSource).toBe('manual');
    });
  });

  describe('payout creation (M5)', () => {
    it('creates one payout per confirmed event, atomically, and tells the hook after commit', async () => {
      const input = await makeInput();
      const hook = vi.fn(async () => undefined);
      expect(await ingestCollectionEvent(db, input, hook)).toMatchObject({ status: 'confirmed' });

      const [payout] = await db.select().from(payouts);
      expect(payout).toMatchObject({
        collectionEventId: input.id,
        collectorId: ctx.collectorId,
        status: 'awaiting_rate',
        fiatCurrency: 'KES',
      });
      expect(hook).toHaveBeenCalledTimes(1);
      expect(hook).toHaveBeenCalledWith(payout?.id);

      // A resend is idempotent: no second payout, no second job.
      await ingestCollectionEvent(db, input, hook);
      expect(await db.select().from(payouts)).toHaveLength(1);
      expect(hook).toHaveBeenCalledTimes(1);
    });

    it('creates no payout for a rejected event', async () => {
      const hook = vi.fn(async () => undefined);
      await ingestCollectionEvent(db, await makeInput({}, { weightKg: 9.9 }), hook);
      expect(await db.select().from(payouts)).toHaveLength(0);
      expect(hook).not.toHaveBeenCalled();
    });

    it('a failing hook never fails the sync result', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const input = await makeInput();
      const result = await ingestCollectionEvent(db, input, async () => {
        throw new Error('queue down');
      });
      expect(result).toMatchObject({ id: input.id, status: 'confirmed' });
      expect(await db.select().from(payouts)).toHaveLength(1);
    });
  });

  it('ingestCollectionEvents: one result per event, in order', async () => {
    const good = await makeInput();
    const bad = await makeInput({}, { weightKg: 9.9 });
    const results = await ingestCollectionEvents(db, [good, bad]);
    expect(results.map((r) => r.status)).toEqual(['confirmed', 'needs_attention']);
    expect(results[0]?.id).toBe(good.id);
    expect(results[1]?.id).toBe(bad.id);
  });

  describe('weight limits match the column (numeric(6,3))', () => {
    it.each([1000, 1500, 99999])(
      '%s kg is refused as invalid_event, not a database overflow',
      async (kg) => {
        const input = await makeInput({ weightKg: kg });
        const parsed = parseSyncEvent(input);
        expect(parsed).toMatchObject({
          ok: false,
          result: { status: 'needs_attention', code: 'invalid_event', id: input.id },
        });
      },
    );

    it.each([0.0004, 1.2345, 0.0005, 2.50001])(
      '%s kg (a 4th decimal) is refused — stored must equal signed',
      async (kg) => {
        const parsed = parseSyncEvent(await makeInput({ weightKg: kg }));
        expect(parsed).toMatchObject({ ok: false, result: { code: 'invalid_event' } });
      },
    );

    it('accepts the extremes the column can hold: 0.001 kg and 999.999 kg', async () => {
      for (const kg of [0.001, 999.999]) {
        const input = await makeInput({ weightKg: kg });
        expect(parseSyncEvent(input).ok).toBe(true);
        expect(await ingestCollectionEvent(db, input)).toMatchObject({ status: 'confirmed' });
      }
      const stored = await db.select({ w: collectionEvents.weightKg }).from(collectionEvents);
      expect(stored.map((r) => r.w).sort()).toEqual(['0.001', '999.999']);
    });

    it('names the field in the reason and never echoes the value', async () => {
      const parsed = parseSyncEvent(await makeInput({ weightKg: 1500 }));
      expect(parsed.ok).toBe(false);
      if (!parsed.ok && parsed.result.status === 'needs_attention') {
        expect(parsed.result.reason).toMatch(/^weightKg:/);
        expect(parsed.result.reason).not.toContain('1500');
      }
    });

    it('a malformed event with no usable id still yields a result, with an empty id', () => {
      expect(parseSyncEvent({ id: 'not-a-uuid' })).toMatchObject({
        ok: false,
        result: { id: '', code: 'invalid_event' },
      });
      expect(parseSyncEvent(null)).toMatchObject({ ok: false, result: { code: 'invalid_event' } });
      expect(parseSyncEvent('nonsense')).toMatchObject({ ok: false });
    });
  });

  describe('recordedAt is bounded by the session (a supervisor cannot pick the rate by backdating)', () => {
    // The fixture session runs 08:00–14:00 on 2026-06-10; grace defaults to 30 minutes.
    const at = (hhmm: string) => new Date(`2026-06-10T${hhmm}:00.000Z`);

    it.each(['07:31', '08:00', '12:00', '14:00', '14:29'])(
      '%s is inside the window (or its grace)',
      async (hhmm) => {
        const input = await makeInput({}, {}, at(hhmm));
        expect(await ingestCollectionEvent(db, input)).toMatchObject({ status: 'confirmed' });
      },
    );

    it.each(['07:29', '03:00', '14:31', '23:59'])(
      '%s is outside the window → outside_session_window',
      async (hhmm) => {
        const input = await makeInput({}, {}, at(hhmm));
        expect(await ingestCollectionEvent(db, input)).toMatchObject({
          status: 'needs_attention',
          code: 'outside_session_window',
        });
        expect(await db.select().from(collectionEvents)).toHaveLength(0);
      },
    );

    it('refuses a timestamp in the future', async () => {
      await db.update(sessions).set({ scheduledEnd: new Date('2099-01-01T00:00:00Z') });
      const tomorrow = new Date(Date.now() + 86_400_000);
      const input = await makeInput({}, {}, tomorrow);
      expect(await ingestCollectionEvent(db, input)).toMatchObject({
        status: 'needs_attention',
        code: 'future_timestamp',
      });
    });

    it('needs_attention (not a foreign-key 500) when the session does not exist', async () => {
      const input = await makeInput({ sessionId: randomUUID() });
      expect(await ingestCollectionEvent(db, input)).toMatchObject({
        status: 'needs_attention',
        code: 'session_not_found',
      });
    });

    it('is re-evaluated on a resend — widening the window lets a stuck event through', async () => {
      const input = await makeInput({}, {}, at('15:00'));
      expect(await ingestCollectionEvent(db, input)).toMatchObject({
        code: 'outside_session_window',
      });
      await db.update(sessions).set({ scheduledEnd: new Date('2026-06-10T16:00:00Z') });
      expect(await ingestCollectionEvent(db, input)).toMatchObject({ status: 'confirmed' });
    });
  });

  describe('a poisoned event never blocks the events behind it', () => {
    it('a database DATA error (class 22/23) becomes needs_attention: invalid_data', async () => {
      const input = await makeInput();
      const spy = vi
        .spyOn(db, 'transaction')
        .mockRejectedValueOnce(
          Object.assign(new Error('numeric field overflow'), { code: '22003' }),
        );
      expect(await ingestCollectionEvent(db, input)).toMatchObject({
        status: 'needs_attention',
        code: 'invalid_data',
      });
      spy.mockRestore();
    });

    it('an INFRASTRUCTURE error still throws (retrying is the right response)', async () => {
      const input = await makeInput();
      const spy = vi
        .spyOn(db, 'transaction')
        .mockRejectedValueOnce(Object.assign(new Error('connection lost'), { code: '08006' }));
      await expect(ingestCollectionEvent(db, input)).rejects.toThrow('connection lost');
      spy.mockRestore();
    });
  });

  describe('revoke vs ingest', () => {
    it('never deadlocks, and never lets an event through for a collector revoked first', async () => {
      const admin = await createStaff(db, 'admin');
      for (let round = 0; round < 12; round += 1) {
        await db
          .update(collectors)
          .set({ status: 'active' })
          .where(eq(collectors.id, ctx.collectorId));
        const input = await makeInput();

        const [result] = await Promise.all([
          ingestCollectionEvent(db, input),
          decideCollectorAuthorization(db, {
            collectorId: ctx.collectorId,
            decision: 'revoke',
            actor: admin,
          }),
        ]);

        // Either order is legitimate; what is NOT is a half state or a thrown deadlock.
        const stored = await db
          .select()
          .from(collectionEvents)
          .where(eq(collectionEvents.id, input.id));
        if (result.status === 'confirmed') {
          expect(stored).toHaveLength(1);
        } else {
          expect(result).toMatchObject({ code: 'collector_not_authorized' });
          expect(stored).toHaveLength(0);
        }
      }
      expect((await verifyChain(db)).ok).toBe(true);
    });
  });
});
