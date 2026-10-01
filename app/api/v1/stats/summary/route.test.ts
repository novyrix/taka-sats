// SPDX-License-Identifier: AGPL-3.0-only

import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// The route never reads a session; the mock only keeps next-auth out of the test process.
vi.mock('@/auth', () => ({ auth: vi.fn(async () => null) }));

import { resetSettingsCache } from '@/lib/config';
import { getDb } from '@/lib/db/client';
import { collectorPaymentDestinations, collectors } from '@/lib/db/schema';
import { createCollector } from '@/lib/testing/fixtures';
import { seedEvent, seedPaidPayout } from '@/lib/testing/fraud-fixtures';
import { PAYOUT_TRUNCATE, type PayoutWorld, seedPayoutWorld } from '@/lib/testing/payout-fixtures';
import { GET } from './route';

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)('GET /api/v1/stats/summary — public, aggregate-only', () => {
  const db = hasDatabase ? getDb() : undefined!;
  let world: PayoutWorld;
  const disclose = (mode: string) => {
    process.env.TAKASATS__TRANSPARENCY__AMOUNT_DISCLOSURE = mode;
    resetSettingsCache();
  };

  beforeEach(async () => {
    world = await seedPayoutWorld(db);
    // A collector with a recognisable alias, wallet, code and GPS-bearing event.
    const zed = await createCollector(db, { alias: 'Zed Secret', publicCode: 'TS-ZED-0001' });
    await db.insert(collectorPaymentDestinations).values({
      collectorId: zed.id,
      type: 'lightning_address',
      address: 'zed-secret@wallet.example',
      status: 'verified',
      createdBy: world.recorderId,
    });
    await db
      .update(collectors)
      .set({ lightningAddress: 'zed-secret@wallet.example' })
      .where(eq(collectors.id, zed.id));
    const a = await seedEvent(db, world, {
      collectorId: zed.id,
      weightKg: '2.700',
      gps: { lat: -1.292066, lng: 36.821946 },
    });
    await seedEvent(db, world, { weightKg: '2.700' });
    await seedEvent(db, world, { material: 'HDPE', weightKg: '1.200' });
    await seedPaidPayout(db, a, zed.id, 4_200);
    disclose('exact');
  });
  afterEach(() => {
    delete process.env.TAKASATS__TRANSPARENCY__AMOUNT_DISCLOSURE;
    resetSettingsCache();
  });
  afterAll(async () => {
    await db.execute(PAYOUT_TRUNCATE);
  });

  it('needs no session and is cacheable', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
  });

  it('reports exact aggregates when disclosure is exact', async () => {
    const body = await (await GET()).json();
    expect(body).toMatchObject({
      events: 3,
      collectors: 2,
      kgByMaterial: [
        { material: 'HDPE', kg: 1.2 },
        { material: 'PET', kg: 5.4 },
      ],
      satsPaid: 4_200,
      ledger: {
        entries: 4,
        headHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        lastCheckpointAt: null,
      },
    });
    expect(body.firstEventAt).toMatch(/^2026-06-10T09:00:00\.000Z$/); // ISO, not a driver string
    expect(body.lastEventAt).toMatch(/^2026-06-10T09:00:00\.000Z$/);
  });

  it('buckets amounts and weights when disclosure is bucketed (weight bucket 0.5 kg)', async () => {
    disclose('bucketed');
    const body = await (await GET()).json();
    expect(body.satsPaid).toEqual({ bucket: { min: 1_000, max: 10_000 } });
    expect(body.kgByMaterial).toEqual([
      { material: 'HDPE', kg: 1 },
      { material: 'PET', kg: 5 },
    ]);
  });

  it('omits the amount when disclosure is omitted', async () => {
    disclose('omitted');
    expect((await (await GET()).json()).satsPaid).toBeNull();
  });

  it('leaks nothing about any person, wallet, location or photo', async () => {
    for (const mode of ['exact', 'bucketed', 'omitted']) {
      disclose(mode);
      const text = JSON.stringify(await (await GET()).json());
      for (const secret of [
        'Zed',
        'Secret',
        'TS-ZED',
        'wallet.example',
        'zed-secret',
        '-1.292',
        '36.82',
        'alias',
        'publicCode',
        'supervisor',
        'photo',
        world.collectorId,
        world.recorderId,
      ]) {
        expect(text).not.toContain(secret);
      }
    }
  });

  it('is well-formed on an empty programme', async () => {
    await db.execute(PAYOUT_TRUNCATE);
    const body = await (await GET()).json();
    expect(body).toEqual({
      events: 0,
      collectors: 0,
      kgByMaterial: [],
      satsPaid: 0,
      firstEventAt: null,
      lastEventAt: null,
      ledger: { entries: 0, headHash: null, lastCheckpointAt: null },
    });
  });
});
