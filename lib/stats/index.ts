// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The PUBLIC programme summary (`GET /api/v1/stats/summary`). Aggregates only — no alias, no
 * per-person figure, no GPS, no wallet, no photo — and the precision of the figures follows
 * `transparency.amount_disclosure` / `weight_bucket_kg`, so an operator decides how much a
 * stranger may learn. Everything here is safe to cache and to show on a public page.
 */

import { desc, eq, max, min, sql } from 'drizzle-orm';
import { getSettings } from '@/lib/config';
import type { Database } from '@/lib/db/client';
import { collectionEvents, ledgerCheckpoints, payouts } from '@/lib/db/schema';
import { floorToBucket, fromMilli, toMilli } from '@/lib/fraud/kg';
import { latestEntry } from '@/lib/ledger';

/** A sats total shown as the power-of-ten range it falls in, e.g. 4,200 → 1,000–10,000. */
export type SatsBucket = { readonly min: number; readonly max: number };

export type PublicSummary = {
  readonly events: number;
  /** Distinct collectors with at least one event. */
  readonly collectors: number;
  readonly kgByMaterial: readonly { readonly material: string; readonly kg: number }[];
  /** `exact` → the number · `bucketed` → `{ bucket }` · `omitted` → null. */
  readonly satsPaid: number | { readonly bucket: SatsBucket } | null;
  readonly firstEventAt: Date | null;
  readonly lastEventAt: Date | null;
  readonly ledger: {
    readonly entries: number;
    readonly headHash: string | null;
    readonly lastCheckpointAt: Date | null;
  };
};

/** `0` → `[0, 1)`; otherwise the decade holding `sats`. */
export function satsBucket(sats: number): SatsBucket {
  if (sats < 1) {
    return { min: 0, max: 1 };
  }
  const low = 10 ** Math.floor(Math.log10(sats));
  return { min: low, max: low * 10 };
}

export async function publicSummary(db: Database): Promise<PublicSummary> {
  const { amount_disclosure: disclosure, weight_bucket_kg: bucketKg } = getSettings().transparency;

  const [totals] = await db
    .select({
      events: sql<number>`count(*)::int`,
      collectors: sql<number>`count(distinct ${collectionEvents.collectorId})::int`,
      first: min(collectionEvents.recordedAt),
      last: max(collectionEvents.recordedAt),
    })
    .from(collectionEvents);

  const kgRows = await db
    .select({
      material: collectionEvents.material,
      total: sql<string>`sum(${collectionEvents.weightKg})::text`,
    })
    .from(collectionEvents)
    .groupBy(collectionEvents.material)
    .orderBy(collectionEvents.material);

  const [paid] = await db
    .select({ total: sql<string>`coalesce(sum(${payouts.amountSats}), 0)::text` })
    .from(payouts)
    .where(eq(payouts.status, 'paid'));
  const satsPaid = Number(paid?.total ?? 0);

  const head = await latestEntry(db);
  const [checkpoint] = await db
    .select({ createdAt: ledgerCheckpoints.createdAt })
    .from(ledgerCheckpoints)
    .orderBy(desc(ledgerCheckpoints.createdAt))
    .limit(1);

  return {
    events: totals?.events ?? 0,
    collectors: totals?.collectors ?? 0,
    kgByMaterial: kgRows.map((row) => {
      const milli = toMilli(row.total);
      return {
        material: row.material,
        kg: Number(fromMilli(disclosure === 'exact' ? milli : floorToBucket(milli, bucketKg))),
      };
    }),
    satsPaid:
      disclosure === 'exact'
        ? satsPaid
        : disclosure === 'bucketed'
          ? { bucket: satsBucket(satsPaid) }
          : null,
    firstEventAt: totals?.first ?? null,
    lastEventAt: totals?.last ?? null,
    ledger: {
      entries: head?.seq ?? 0,
      headHash: head?.entryHash ?? null,
      lastCheckpointAt: checkpoint?.createdAt ?? null,
    },
  };
}
