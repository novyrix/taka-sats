// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Sync ingest runs the anomaly detectors after the commit (ADR-0006: flags never block). The
 * detector call is wrapped in a spy that defaults to the real thing, so one test can make it
 * throw and prove the event is still `confirmed` and stored.
 */

import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/storage', () => ({ photoUrlFor: vi.fn(async () => null) }));
vi.mock('@/lib/fraud', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/fraud')>();
  return { ...actual, runEventDetectors: vi.fn(actual.runEventDetectors) };
});

import { getDb } from '@/lib/db/client';
import {
  anomalyFlags,
  collectionEvents,
  exchangeRateSnapshots,
  materialRates,
  sessions,
  sessionSupervisors,
} from '@/lib/db/schema';
import { runEventDetectors } from '@/lib/fraud';
import { assembleCollectionEvent } from '@/lib/sync';
import { createCollector, createStaff } from '@/lib/testing/fixtures';
import { ingestCollectionEvent, type SyncEventInput } from './index';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const TRUNCATE = sql`truncate anomaly_flags, collection_events, ledger_entries, session_supervisors, sessions, supervisors, collectors, material_rates, exchange_rate_snapshots restart identity cascade`;
const PHOTO = 'c'.repeat(64);
const RECORDED_AT = new Date('2026-06-10T10:00:00.000Z');

describe.skipIf(!hasDatabase)('ingest → anomaly detectors (integration)', () => {
  const db = hasDatabase ? getDb() : undefined!;
  let ctx: {
    collectorId: string;
    otherCollectorId: string;
    supervisorId: string;
    sessionId: string;
    rateId: string;
  };

  beforeEach(async () => {
    vi.mocked(runEventDetectors).mockClear();
    await db.execute(TRUNCATE);
    const supervisor = await createStaff(db, 'supervisor');
    const collector = await createCollector(db);
    const other = await createCollector(db, { alias: 'Other' });
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
      fetchedAt: RECORDED_AT,
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
    ctx = {
      collectorId: collector.id,
      otherCollectorId: other.id,
      supervisorId: supervisor.id,
      sessionId: session!.id,
      rateId: rate!.id,
    };
  });
  afterAll(async () => {
    await db.execute(TRUNCATE);
  });

  async function makeInput(collectorId: string, minutes: number): Promise<SyncEventInput> {
    const event = await assembleCollectionEvent(
      {
        collectorId,
        supervisorId: ctx.supervisorId,
        sessionId: ctx.sessionId,
        material: 'PET',
        weightKg: 2.5,
        rateId: ctx.rateId,
        rateFiatMinor: 2000,
        exchangeRate: 5_000_000,
        photoSha256: PHOTO,
        geo: { kind: 'fix', lat: -1.29, lng: 36.82, accuracyM: 8 },
        registrationType: 'tap',
      },
      { recordedAt: new Date(RECORDED_AT.getTime() + minutes * 60_000) },
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
    };
  }

  it('a photo reused for another collector is confirmed AND flagged for review', async () => {
    const first = await makeInput(ctx.collectorId, 0);
    const second = await makeInput(ctx.otherCollectorId, 5);
    expect(await ingestCollectionEvent(db, first)).toMatchObject({ status: 'confirmed' });
    expect(await ingestCollectionEvent(db, second)).toMatchObject({ status: 'confirmed' });

    const flags = await db
      .select()
      .from(anomalyFlags)
      .where(eq(anomalyFlags.flagType, 'duplicate_photo'));
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({
      collectionEventId: second.id,
      collectorId: ctx.otherCollectorId,
      context: { duplicateOfEventId: first.id, sameCollector: false },
    });
  });

  it('a resent event does not run the detectors again', async () => {
    const input = await makeInput(ctx.collectorId, 0);
    await ingestCollectionEvent(db, input);
    await ingestCollectionEvent(db, input);
    expect(runEventDetectors).toHaveBeenCalledTimes(1);
  });

  it('a detector that blows up never turns a confirmed sync into an error', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(runEventDetectors).mockRejectedValueOnce(new TypeError('boom'));

    const input = await makeInput(ctx.collectorId, 0);
    expect(await ingestCollectionEvent(db, input)).toMatchObject({ status: 'confirmed', seq: 1 });
    expect(await db.select().from(collectionEvents)).toHaveLength(1);
    expect(logged).toHaveBeenCalledWith('[sync] anomaly detectors failed', 'TypeError');
    logged.mockRestore();
  });
});
