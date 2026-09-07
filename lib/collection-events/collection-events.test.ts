// SPDX-License-Identifier: AGPL-3.0-only

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/storage', () => ({ photoUrlFor: vi.fn(async () => null) }));

import { getDb } from '@/lib/db/client';
import {
  collectionEvents,
  collectors,
  exchangeRateSnapshots,
  materialRates,
  sessions,
  sessionSupervisors,
  supervisors,
} from '@/lib/db/schema';
import { verifyChain } from '@/lib/ledger';
import { assembleCollectionEvent } from '@/lib/sync';
import { ingestCollectionEvent, ingestCollectionEvents, type SyncEventInput } from './index';

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
      .values({ alias: 'Amina', addressSource: 'byo' })
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
      { recordedAt: ctx.recordedAt },
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
    expect(result).toMatchObject({ status: 'needs_attention' });
    expect((result as { reason: string }).reason).toMatch(/content_hash/);
  });

  it('needs_attention: rate_id is not the rate active at recorded_at', async () => {
    const input = await makeInput({ rateId: randomUUID() }); // hash matches, rate is wrong
    const result = await ingestCollectionEvent(db, input);
    expect(result).toMatchObject({ status: 'needs_attention' });
    expect((result as { reason: string }).reason).toMatch(/rate_id/);
  });

  it('needs_attention: no rate active for the material', async () => {
    const input = await makeInput({ material: 'unobtainium', rateId: randomUUID() });
    const result = await ingestCollectionEvent(db, input);
    expect(result).toMatchObject({ status: 'needs_attention' });
    expect((result as { reason: string }).reason).toMatch(/no "unobtainium" rate/);
  });

  it('needs_attention: supervisor not assigned to the session', async () => {
    const [other] = await db
      .insert(supervisors)
      .values({ name: 'Zoe', phone: '+254700000009', passwordHash: 'x:y' })
      .returning({ id: supervisors.id });
    const input = await makeInput({ supervisorId: other!.id });
    const result = await ingestCollectionEvent(db, input);
    expect(result).toMatchObject({ status: 'needs_attention' });
    expect((result as { reason: string }).reason).toMatch(/not assigned/);
  });

  it('ingestCollectionEvents: one result per event, in order', async () => {
    const good = await makeInput();
    const bad = await makeInput({}, { weightKg: 9.9 });
    const results = await ingestCollectionEvents(db, [good, bad]);
    expect(results.map((r) => r.status)).toEqual(['confirmed', 'needs_attention']);
    expect(results[0]?.id).toBe(good.id);
    expect(results[1]?.id).toBe(bad.id);
  });
});
