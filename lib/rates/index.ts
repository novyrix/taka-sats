// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The versioned material-rate table (D-14, D-21, §8.3, ROADMAP M2-4).
 *
 * Rows are never overwritten. A rate change inserts a new row and closes the
 * prior one's `effective_to`. A historical event always resolves the rate
 * that was active when it was recorded — never the current rate. Rates are
 * fiat minor units per kg; sats are computed at payout time (`lib/money`),
 * never stored here. Only `admin` changes rates (enforced at the API layer).
 *
 * Zero framework imports (D-04).
 */

import { and, eq, gt, type InferSelectModel, isNull, lte, or } from 'drizzle-orm';
import { getSettings } from '@/lib/config';
import type { Database } from '@/lib/db/client';
import { materialRates } from '@/lib/db/schema';

export type MaterialRate = InferSelectModel<typeof materialRates>;

export class RateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateError';
  }
}

/**
 * Seed `material_rates` from `[rates].seed` in config, once (D-21). A no-op
 * if the table already holds any row — safe to call on every boot / from
 * `pnpm db:seed`.
 */
export async function seedMaterialRates(db: Database, now: Date = new Date()): Promise<number> {
  const existing = await db.select({ id: materialRates.id }).from(materialRates).limit(1);
  if (existing.length > 0) {
    return 0;
  }

  const settings = getSettings();
  const rows = settings.rates.seed.map((entry) => ({
    material: entry.material,
    rateFiatMinor: entry.rate_fiat_minor_per_kg,
    fiatCurrency: settings.programme.fiat_currency,
    effectiveFrom: now,
  }));
  if (rows.length === 0) {
    return 0;
  }
  await db.insert(materialRates).values(rows);
  return rows.length;
}

export type SetMaterialRateInput = {
  readonly material: string;
  readonly rateFiatMinor: number;
  /** When the new rate takes effect; defaults to now. */
  readonly effectiveFrom?: Date;
};

/**
 * Record a new rate version for a material: close the currently-open row
 * (its `effective_to` becomes the new `effective_from`) and insert the new
 * open row. Atomic. Rejects a start that is not strictly after the current
 * version's start.
 */
export async function setMaterialRate(
  db: Database,
  input: SetMaterialRateInput,
): Promise<MaterialRate> {
  if (!Number.isInteger(input.rateFiatMinor) || input.rateFiatMinor < 0) {
    throw new RateError('rateFiatMinor must be a non-negative integer (fiat minor units per kg)');
  }
  const effectiveFrom = input.effectiveFrom ?? new Date();
  const fiatCurrency = getSettings().programme.fiat_currency;

  return db.transaction(async (tx) => {
    const [open] = await tx
      .select()
      .from(materialRates)
      .where(and(eq(materialRates.material, input.material), isNull(materialRates.effectiveTo)));

    if (open) {
      if (effectiveFrom <= open.effectiveFrom) {
        throw new RateError(
          `new rate for "${input.material}" must start after the current version (${open.effectiveFrom.toISOString()})`,
        );
      }
      await tx
        .update(materialRates)
        .set({ effectiveTo: effectiveFrom })
        .where(eq(materialRates.id, open.id));
    }

    const [inserted] = await tx
      .insert(materialRates)
      .values({
        material: input.material,
        rateFiatMinor: input.rateFiatMinor,
        fiatCurrency,
        effectiveFrom,
      })
      .returning();
    if (!inserted) {
      throw new RateError('setMaterialRate: insert returned no row');
    }
    return inserted;
  });
}

/** The rate for `material` that was active at time `at`, or null. */
export async function rateActiveAt(
  db: Database,
  material: string,
  at: Date,
): Promise<MaterialRate | null> {
  const [row] = await db
    .select()
    .from(materialRates)
    .where(
      and(
        eq(materialRates.material, material),
        lte(materialRates.effectiveFrom, at),
        or(isNull(materialRates.effectiveTo), gt(materialRates.effectiveTo, at)),
      ),
    );
  return row ?? null;
}

/** Every currently-active rate (one per material). */
export async function currentRates(db: Database): Promise<MaterialRate[]> {
  return db
    .select()
    .from(materialRates)
    .where(isNull(materialRates.effectiveTo))
    .orderBy(materialRates.material);
}

/** Full history, newest first per material. Optionally filter to one material. */
export async function rateHistory(db: Database, material?: string): Promise<MaterialRate[]> {
  const base = db.select().from(materialRates);
  const rows = material ? await base.where(eq(materialRates.material, material)) : await base;
  return rows.sort((a, b) => {
    if (a.material !== b.material) {
      return a.material.localeCompare(b.material);
    }
    return b.effectiveFrom.getTime() - a.effectiveFrom.getTime();
  });
}
