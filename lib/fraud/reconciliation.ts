// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Reconciliation (FR-3.5, ADR-0006) — the primary fraud control. For a period and material it
 * compares what supervisors COLLECTED (and what was PAID for) against what the recycler
 * ACCEPTED. Collected minus recycler is the variance; beyond `reconciliation.variance_tolerance_pct`
 * the material is `flagged`. It is a detective control: it reports and raises a flag, it never
 * blocks anything.
 *
 * Weights are summed by Postgres (`numeric`, exact) and compared here in integer milli-kg
 * (`kg.ts`) — no floating-point ever touches a kilogram total. Periods are `[from, to)`.
 */

import { and, desc, eq, gte, lt, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { getSettings } from '@/lib/config';
import type { Database, Queryable } from '@/lib/db/client';
import { collectionEvents, payouts, reconciliationReports, recyclerSales } from '@/lib/db/schema';
import { decodeCursor, encodeCursor, PAGE_DEFAULT, PAGE_MAX } from '@/lib/pagination';
import { detectPayoutConcentration } from './concentration';
import { raiseFlag } from './flags';
import { exceedsTolerance, fromMilli, percentOf, toMilli } from './kg';

export const reconciliationPeriodSchema = z
  .object({
    from: z.coerce.date(),
    to: z.coerce.date(),
    material: z.string().trim().min(1).max(64).optional(),
  })
  .refine((v) => v.to > v.from, { message: '"to" must be after "from"', path: ['to'] });
export type ReconciliationPeriod = z.infer<typeof reconciliationPeriodSchema>;

export type ReconciliationStatus = 'within_tolerance' | 'flagged' | 'no_recycler_data';

/** All kilogram figures are exact 3-decimal strings; percentages likewise. */
export type ReconciliationRow = {
  readonly material: string;
  readonly collectedKg: string;
  readonly paidKg: string;
  readonly recyclerKg: string;
  readonly varianceKg: string;
  readonly variancePct: string;
  readonly tolerancePct: string;
  readonly status: ReconciliationStatus;
};

type Totals = Map<string, { milli: bigint; count: number }>;

const totals = (rows: readonly { material: string; total: string; count: number }[]): Totals =>
  new Map(rows.map((r) => [r.material, { milli: toMilli(r.total), count: r.count }] as const));

const inMaterial = (column: PgColumn, material?: string): SQL | undefined =>
  material ? eq(column, material) : undefined;

function collectedQuery(db: Queryable, p: ReconciliationPeriod) {
  return db
    .select({
      material: collectionEvents.material,
      total: sql<string>`sum(${collectionEvents.weightKg})::text`,
      count: sql<number>`count(*)::int`,
    })
    .from(collectionEvents)
    .where(
      and(
        gte(collectionEvents.recordedAt, p.from),
        lt(collectionEvents.recordedAt, p.to),
        inMaterial(collectionEvents.material, p.material),
      ),
    )
    .groupBy(collectionEvents.material);
}

/** Events in the period whose payout is `paid` — what money actually left for. */
function paidQuery(db: Queryable, p: ReconciliationPeriod) {
  return db
    .select({
      material: collectionEvents.material,
      total: sql<string>`sum(${collectionEvents.weightKg})::text`,
      count: sql<number>`count(*)::int`,
    })
    .from(collectionEvents)
    .innerJoin(payouts, eq(payouts.collectionEventId, collectionEvents.id))
    .where(
      and(
        eq(payouts.status, 'paid'),
        gte(collectionEvents.recordedAt, p.from),
        lt(collectionEvents.recordedAt, p.to),
        inMaterial(collectionEvents.material, p.material),
      ),
    )
    .groupBy(collectionEvents.material);
}

function recyclerQuery(db: Queryable, p: ReconciliationPeriod) {
  return db
    .select({
      material: recyclerSales.material,
      total: sql<string>`sum(${recyclerSales.weightKg})::text`,
      count: sql<number>`count(*)::int`,
    })
    .from(recyclerSales)
    .where(
      and(
        gte(recyclerSales.soldAt, p.from),
        lt(recyclerSales.soldAt, p.to),
        inMaterial(recyclerSales.material, p.material),
      ),
    )
    .groupBy(recyclerSales.material);
}

/**
 * Status rules. No sale rows for the material → `no_recycler_data` (nothing to compare — not
 * a pass). Kilograms sold that were never collected (`collected = 0`, a sale exists) has no
 * meaningful percentage but is the loudest possible mismatch, so it is `flagged`. Otherwise
 * `|variance| / collected × 100 > tolerance` → `flagged`; exactly at the tolerance is within it.
 */
function statusFor(
  collected: bigint,
  recycler: bigint,
  saleCount: number,
  tolerancePct: number,
): ReconciliationStatus {
  if (saleCount === 0) {
    return 'no_recycler_data';
  }
  if (collected === 0n) {
    return recycler > 0n ? 'flagged' : 'within_tolerance';
  }
  return exceedsTolerance(collected - recycler, collected, tolerancePct)
    ? 'flagged'
    : 'within_tolerance';
}

/** Compare collected / paid / recycler kilograms for the period, per material. Writes nothing. */
export async function computeReconciliation(
  db: Queryable,
  period: ReconciliationPeriod,
): Promise<ReconciliationRow[]> {
  const tolerance = getSettings().reconciliation.variance_tolerance_pct;
  const collected = totals(await collectedQuery(db, period));
  const paid = totals(await paidQuery(db, period));
  const recycler = totals(await recyclerQuery(db, period));

  const materials = [...new Set([...collected.keys(), ...recycler.keys()])].sort();
  return materials.map((material) => {
    const collectedMilli = collected.get(material)?.milli ?? 0n;
    const recyclerMilli = recycler.get(material)?.milli ?? 0n;
    const varianceMilli = collectedMilli - recyclerMilli;
    return {
      material,
      collectedKg: fromMilli(collectedMilli),
      paidKg: fromMilli(paid.get(material)?.milli ?? 0n),
      recyclerKg: fromMilli(recyclerMilli),
      varianceKg: fromMilli(varianceMilli),
      variancePct: percentOf(varianceMilli, collectedMilli),
      tolerancePct: tolerance.toFixed(3),
      status: statusFor(
        collectedMilli,
        recyclerMilli,
        recycler.get(material)?.count ?? 0,
        tolerance,
      ),
    };
  });
}

export type ReportView = ReconciliationRow & {
  readonly id: string;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly createdBy: string | null;
  readonly createdAt: Date;
};

/**
 * Persist one report per material (a new run is always new rows — nothing is updated) and
 * raise a `mass_balance_variance` flag for each `flagged` one; then check every session that
 * recorded events in the period for payout concentration.
 */
export async function runReconciliation(
  db: Database,
  period: ReconciliationPeriod,
  createdBy: string,
): Promise<ReportView[]> {
  const reports = await db.transaction(async (tx) => {
    const rows = await computeReconciliation(tx, period);
    const saved: ReportView[] = [];
    for (const row of rows) {
      const [report] = await tx
        .insert(reconciliationReports)
        .values({
          periodStart: period.from,
          periodEnd: period.to,
          material: row.material,
          collectedKg: row.collectedKg,
          paidKg: row.paidKg,
          recyclerKg: row.recyclerKg,
          varianceKg: row.varianceKg,
          variancePct: row.variancePct,
          tolerancePct: row.tolerancePct,
          status: row.status,
          createdBy,
        })
        .returning();
      if (!report) {
        throw new Error('runReconciliation: insert returned no row');
      }
      if (row.status === 'flagged') {
        await raiseFlag(tx, {
          type: 'mass_balance_variance',
          context: {
            reportId: report.id,
            material: row.material,
            periodStart: period.from.toISOString(),
            periodEnd: period.to.toISOString(),
            collectedKg: row.collectedKg,
            recyclerKg: row.recyclerKg,
            varianceKg: row.varianceKg,
            variancePct: row.variancePct,
            tolerancePct: row.tolerancePct,
          },
        });
      }
      saved.push({ ...row, ...pick(report) });
    }
    return saved;
  });

  const sessionRows = await db
    .selectDistinct({ sessionId: collectionEvents.sessionId })
    .from(collectionEvents)
    .where(
      and(
        gte(collectionEvents.recordedAt, period.from),
        lt(collectionEvents.recordedAt, period.to),
        inMaterial(collectionEvents.material, period.material),
      ),
    );
  for (const { sessionId } of sessionRows) {
    if (sessionId) {
      await detectPayoutConcentration(db, sessionId);
    }
  }
  return reports;
}

const pick = (r: typeof reconciliationReports.$inferSelect) => ({
  id: r.id,
  periodStart: r.periodStart,
  periodEnd: r.periodEnd,
  createdBy: r.createdBy,
  createdAt: r.createdAt,
});

export type ReportPage = { readonly reports: ReportView[]; readonly nextCursor: string | null };

/** Saved reports, newest first, keyset-paginated. */
export async function listReconciliationReports(
  db: Database,
  {
    material,
    cursor,
    limit = PAGE_DEFAULT,
  }: { material?: string | undefined; cursor?: string | undefined; limit?: number } = {},
): Promise<ReportPage> {
  const size = Math.min(Math.max(limit, 1), PAGE_MAX);
  const conditions: (SQL | undefined)[] = [inMaterial(reconciliationReports.material, material)];
  if (cursor) {
    const after = decodeCursor(cursor);
    conditions.push(
      sql`(${reconciliationReports.createdAt}, ${reconciliationReports.id}) < (${after.ts}::timestamptz, ${after.id}::uuid)`,
    );
  }
  const rows = await db
    .select({
      report: reconciliationReports,
      createdAtExact: sql<string>`${reconciliationReports.createdAt}::text`,
    })
    .from(reconciliationReports)
    .where(and(...conditions))
    .orderBy(desc(reconciliationReports.createdAt), desc(reconciliationReports.id))
    .limit(size + 1);

  const page = rows.slice(0, size);
  const last = page[page.length - 1];
  return {
    reports: page.map(({ report: r }) => ({
      material: r.material,
      collectedKg: r.collectedKg,
      paidKg: r.paidKg,
      recyclerKg: r.recyclerKg,
      varianceKg: r.varianceKg,
      variancePct: r.variancePct,
      tolerancePct: r.tolerancePct,
      status: r.status as ReconciliationStatus,
      ...pick(r),
    })),
    nextCursor:
      rows.length > size && last ? encodeCursor(last.createdAtExact, last.report.id) : null,
  };
}

/** The JSON shape of a row: kilograms and percentages as numbers (≤ 3 decimals, so exact). */
export function toRowView(row: ReconciliationRow) {
  return {
    material: row.material,
    collectedKg: Number(row.collectedKg),
    paidKg: Number(row.paidKg),
    recyclerKg: Number(row.recyclerKg),
    varianceKg: Number(row.varianceKg),
    variancePct: Number(row.variancePct),
    tolerancePct: Number(row.tolerancePct),
    status: row.status,
  };
}

export function toReportView(report: ReportView) {
  return {
    id: report.id,
    periodStart: report.periodStart,
    periodEnd: report.periodEnd,
    ...toRowView(report),
    createdBy: report.createdBy,
    createdAt: report.createdAt,
  };
}
