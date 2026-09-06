// SPDX-License-Identifier: AGPL-3.0-only

import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db/client';
import { materialRates } from '@/lib/db/schema';
import {
  currentRates,
  rateActiveAt,
  RateError,
  rateHistory,
  seedMaterialRates,
  setMaterialRate,
} from './index';

describe('setMaterialRate — input validation (no DB)', () => {
  it('rejects a non-integer or negative rate', async () => {
    await expect(
      setMaterialRate(null as never, { material: 'PET', rateFiatMinor: 12.5 }),
    ).rejects.toThrow(RateError);
    await expect(
      setMaterialRate(null as never, { material: 'PET', rateFiatMinor: -1 }),
    ).rejects.toThrow(RateError);
  });
});

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)('lib/rates (integration)', () => {
  const db = hasDatabase ? getDb() : undefined!;

  beforeEach(async () => {
    await db.execute(sql`truncate table material_rates restart identity cascade`);
  });

  afterAll(async () => {
    await db.execute(sql`truncate table material_rates restart identity cascade`);
  });

  it('seeds from config, once', async () => {
    const first = await seedMaterialRates(db);
    expect(first).toBeGreaterThan(0);
    const again = await seedMaterialRates(db);
    expect(again).toBe(0);

    const active = await currentRates(db);
    expect(active.map((r) => r.material).sort()).toEqual(['HDPE', 'PET', 'aluminium']);
    expect(active.every((r) => r.effectiveTo === null)).toBe(true);
    expect(active.every((r) => r.fiatCurrency === 'KES')).toBe(true);
  });

  it('versions a rate: new row opens, prior row closes at the same instant', async () => {
    const t0 = new Date('2026-01-01T00:00:00Z');
    const t1 = new Date('2026-06-01T00:00:00Z');

    const v1 = await setMaterialRate(db, {
      material: 'PET',
      rateFiatMinor: 2000,
      effectiveFrom: t0,
    });
    const v2 = await setMaterialRate(db, {
      material: 'PET',
      rateFiatMinor: 2500,
      effectiveFrom: t1,
    });

    const rows = await rateHistory(db, 'PET');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.id).toBe(v2.id); // newest first
    expect(rows[0]?.effectiveTo).toBeNull();
    expect(rows[1]?.id).toBe(v1.id);
    expect(rows[1]?.effectiveTo?.getTime()).toBe(t1.getTime());
  });

  it('rateActiveAt resolves the version that was open at a given time', async () => {
    const t0 = new Date('2026-01-01T00:00:00Z');
    const t1 = new Date('2026-06-01T00:00:00Z');
    await setMaterialRate(db, { material: 'PET', rateFiatMinor: 2000, effectiveFrom: t0 });
    await setMaterialRate(db, { material: 'PET', rateFiatMinor: 2500, effectiveFrom: t1 });

    expect((await rateActiveAt(db, 'PET', new Date('2026-03-01T00:00:00Z')))?.rateFiatMinor).toBe(
      2000,
    );
    expect((await rateActiveAt(db, 'PET', new Date('2026-09-01T00:00:00Z')))?.rateFiatMinor).toBe(
      2500,
    );
    // The boundary belongs to the new version (effective_to is exclusive).
    expect((await rateActiveAt(db, 'PET', t1))?.rateFiatMinor).toBe(2500);
    // Before any version exists.
    expect(await rateActiveAt(db, 'PET', new Date('2025-01-01T00:00:00Z'))).toBeNull();
    expect(await rateActiveAt(db, 'HDPE', t1)).toBeNull();
  });

  it('rejects a new version that does not start after the current one', async () => {
    const t0 = new Date('2026-01-01T00:00:00Z');
    await setMaterialRate(db, { material: 'PET', rateFiatMinor: 2000, effectiveFrom: t0 });
    await expect(
      setMaterialRate(db, { material: 'PET', rateFiatMinor: 2500, effectiveFrom: t0 }),
    ).rejects.toThrow(RateError);
  });

  it('a partial unique index stops two open rows for one material', async () => {
    await db.insert(materialRates).values({
      material: 'PET',
      rateFiatMinor: 1,
      effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    });
    await expect(
      db.insert(materialRates).values({
        material: 'PET',
        rateFiatMinor: 2,
        effectiveFrom: new Date('2026-02-01T00:00:00Z'),
      }),
    ).rejects.toThrow();
  });
});
