// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Read side of payouts, for the API. The view type is the allow-list of what leaves the
 * server: it carries the collector's alias and public code, never their Lightning address
 * or any provider payload (REQUIREMENTS §12.6, ADR-0018).
 */

import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import type { Database } from '@/lib/db/client';
import { anomalyFlags, collectionEvents, collectors, payouts } from '@/lib/db/schema';
import { PayoutCursorError } from './errors';
import { PAYOUT_STATUSES, type PayoutStatus } from './process';

export type PayoutView = {
  readonly id: string;
  readonly status: PayoutStatus;
  readonly amountSats: number | null;
  readonly amountFiatMinor: number | null;
  readonly fiatCurrency: string;
  readonly collectionEventId: string;
  readonly collectorId: string;
  readonly collectorAlias: string;
  readonly collectorPublicCode: string;
  readonly provider: string | null;
  readonly providerPaymentRef: string | null;
  readonly approvedBy: string | null;
  readonly approvedAt: Date | null;
  readonly lastError: string | null;
  readonly attempts: number;
  readonly createdAt: Date;
  readonly settledAt: Date | null;
  /** Unreviewed anomaly flags on the payout's event — what an approver should look at first. */
  readonly openFlags: number;
};

export type PayoutFilter = {
  readonly status?: PayoutStatus | undefined;
  readonly collectorId?: string | undefined;
  readonly sessionId?: string | undefined;
  readonly eventId?: string | undefined;
  /** Only payouts of events this supervisor recorded — a plain supervisor's whole view. */
  readonly recordedBy?: string | undefined;
};

export const PAYOUT_PAGE_DEFAULT = 50;
export const PAYOUT_PAGE_MAX = 100;

export type PayoutPage = { readonly payouts: PayoutView[]; readonly nextCursor: string | null };

const view = {
  id: payouts.id,
  status: payouts.status,
  amountSats: payouts.amountSats,
  amountFiatMinor: payouts.amountFiatMinor,
  fiatCurrency: payouts.fiatCurrency,
  collectionEventId: payouts.collectionEventId,
  collectorId: payouts.collectorId,
  collectorAlias: collectors.alias,
  collectorPublicCode: collectors.publicCode,
  provider: payouts.provider,
  providerPaymentRef: payouts.providerPaymentRef,
  approvedBy: payouts.approvedBy,
  approvedAt: payouts.approvedAt,
  lastError: payouts.lastError,
  attempts: payouts.attempts,
  createdAt: payouts.createdAt,
  settledAt: payouts.settledAt,
  openFlags: sql<number>`(select count(*)::int from ${anomalyFlags} where ${anomalyFlags.collectionEventId} = ${payouts.collectionEventId} and ${anomalyFlags.reviewOutcome} is null)`,
} as const;

function where(filter: PayoutFilter): SQL[] {
  const conditions: SQL[] = [];
  if (filter.status) {
    conditions.push(eq(payouts.status, filter.status));
  }
  if (filter.collectorId) {
    conditions.push(eq(payouts.collectorId, filter.collectorId));
  }
  if (filter.sessionId) {
    conditions.push(eq(collectionEvents.sessionId, filter.sessionId));
  }
  if (filter.eventId) {
    conditions.push(eq(payouts.collectionEventId, filter.eventId));
  }
  if (filter.recordedBy) {
    conditions.push(eq(collectionEvents.supervisorId, filter.recordedBy));
  }
  return conditions;
}

/** A cursor is the exact (created_at, id) of the last row, with the timestamp as Postgres prints it (µs precision). */
function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify([createdAt, id])).toString('base64url');
}

function decodeCursor(cursor: string): { createdAt: string; id: string } {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      Array.isArray(parsed) &&
      typeof parsed[0] === 'string' &&
      typeof parsed[1] === 'string' &&
      !Number.isNaN(Date.parse(parsed[0])) &&
      /^[0-9a-f-]{36}$/i.test(parsed[1])
    ) {
      return { createdAt: parsed[0], id: parsed[1] };
    }
  } catch {
    // fall through
  }
  throw new PayoutCursorError();
}

/** Newest first, keyset-paginated. `limit` is clamped to {@link PAYOUT_PAGE_MAX}. */
export async function listPayouts(
  db: Database,
  filter: PayoutFilter = {},
  { cursor, limit = PAYOUT_PAGE_DEFAULT }: { cursor?: string; limit?: number } = {},
): Promise<PayoutPage> {
  const size = Math.min(Math.max(limit, 1), PAYOUT_PAGE_MAX);
  const conditions = where(filter);
  if (cursor) {
    const after = decodeCursor(cursor);
    conditions.push(
      sql`(${payouts.createdAt}, ${payouts.id}) < (${after.createdAt}::timestamptz, ${after.id}::uuid)`,
    );
  }
  const rows = await db
    .select({ ...view, createdAtExact: sql<string>`${payouts.createdAt}::text` })
    .from(payouts)
    .innerJoin(collectors, eq(collectors.id, payouts.collectorId))
    .innerJoin(collectionEvents, eq(collectionEvents.id, payouts.collectionEventId))
    .where(and(...conditions))
    .orderBy(desc(payouts.createdAt), desc(payouts.id))
    .limit(size + 1);

  const page = rows.slice(0, size);
  const last = page[page.length - 1];
  return {
    payouts: page.map(({ createdAtExact: _exact, ...row }) => row as PayoutView),
    nextCursor: rows.length > size && last ? encodeCursor(last.createdAtExact, last.id) : null,
  };
}

/** One payout, or null — also null when `recordedBy` is set and the payout is someone else's. */
export async function getPayoutView(
  db: Database,
  payoutId: string,
  recordedBy?: string,
): Promise<PayoutView | null> {
  const [row] = await db
    .select(view)
    .from(payouts)
    .innerJoin(collectors, eq(collectors.id, payouts.collectorId))
    .innerJoin(collectionEvents, eq(collectionEvents.id, payouts.collectionEventId))
    .where(
      and(
        eq(payouts.id, payoutId),
        ...(recordedBy ? [eq(collectionEvents.supervisorId, recordedBy)] : []),
      ),
    );
  return (row as PayoutView | undefined) ?? null;
}

export type PayoutSummary = {
  readonly byStatus: readonly {
    readonly status: PayoutStatus;
    readonly count: number;
    readonly totalSats: number;
  }[];
  readonly total: { readonly count: number; readonly totalSats: number };
};

/** Count and sats per status (every status listed, zero-filled). `totalSats` sums priced payouts only. */
export async function payoutSummary(db: Database, recordedBy?: string): Promise<PayoutSummary> {
  const rows = await db
    .select({
      status: payouts.status,
      count: sql<number>`count(*)::int`,
      totalSats: sql<string>`coalesce(sum(${payouts.amountSats}), 0)::text`,
    })
    .from(payouts)
    .innerJoin(collectionEvents, eq(collectionEvents.id, payouts.collectionEventId))
    .where(recordedBy ? eq(collectionEvents.supervisorId, recordedBy) : undefined)
    .groupBy(payouts.status);

  const byStatus = PAYOUT_STATUSES.map((status) => {
    const row = rows.find((r) => r.status === status);
    return { status, count: row?.count ?? 0, totalSats: Number(row?.totalSats ?? 0) };
  });
  return {
    byStatus,
    total: {
      count: byStatus.reduce((n, r) => n + r.count, 0),
      totalSats: byStatus.reduce((n, r) => n + r.totalSats, 0),
    },
  };
}
