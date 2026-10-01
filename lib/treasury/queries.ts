// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Read side of the funding vote, for the API. The view is the allow-list of what leaves the
 * server: names and ids of stewards, amounts, the transfer reference (a public txid or an
 * equivalent), never a key, an address or a provider payload.
 */

import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { getSettings } from '@/lib/config';
import type { Database } from '@/lib/db/client';
import { payouts, supervisors, treasuryTopups, treasuryTopupSignoffs } from '@/lib/db/schema';
import { decodeCursor, encodeCursor } from '@/lib/pagination';
import {
  type FloatReader,
  OPEN_TOPUP_STATUSES,
  openTopupSats,
  type TopupRecord,
  type TopupStatus,
} from './topups';

export const TOPUP_PAGE_DEFAULT = 50;
export const TOPUP_PAGE_MAX = 100;

type Person = { readonly id: string; readonly name: string };

export type TopupView = {
  readonly id: string;
  readonly status: TopupStatus;
  readonly amountSats: number;
  readonly note: string | null;
  readonly proposedBy: Person;
  readonly createdAt: Date;
  /** Distinct approvers needed, never counting the proposer. */
  readonly approvalsRequired: number;
  readonly approvals: readonly { readonly by: Person; readonly at: Date }[];
  /** The hot-wallet float noted when the quorum was reached (or the transfer recorded). */
  readonly floatBaselineSats: number | null;
  readonly transfer: {
    readonly reference: string;
    readonly by: Person;
    readonly at: Date;
  } | null;
  /** The end of the vote: confirmed, rejected or cancelled. `by` is null when the worker confirmed. */
  readonly outcome: {
    readonly at: Date;
    readonly by: Person | null;
    readonly reason: string | null;
  } | null;
};

export type TopupPage = { readonly topups: TopupView[]; readonly nextCursor: string | null };

async function people(db: Database, ids: readonly string[]): Promise<Map<string, Person>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({ id: supervisors.id, name: supervisors.name })
    .from(supervisors)
    .where(inArray(supervisors.id, unique));
  return new Map(rows.map((row) => [row.id, row]));
}

/** Turn stored rows into views (names and approvals resolved with two extra queries, not N). */
async function hydrate(db: Database, rows: readonly TopupRecord[]): Promise<TopupView[]> {
  if (rows.length === 0) {
    return [];
  }
  const signoffs = await db
    .select({
      topupId: treasuryTopupSignoffs.topupId,
      supervisorId: treasuryTopupSignoffs.supervisorId,
      approvedAt: treasuryTopupSignoffs.approvedAt,
    })
    .from(treasuryTopupSignoffs)
    .where(
      inArray(
        treasuryTopupSignoffs.topupId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(treasuryTopupSignoffs.approvedAt);

  const names = await people(
    db,
    [
      ...rows.flatMap((row) => [row.proposedBy, row.transferredBy, row.outcomeBy]),
      ...signoffs.map((signoff) => signoff.supervisorId),
    ].filter((id): id is string => id !== null),
  );
  const person = (id: string): Person => names.get(id) ?? { id, name: '' };

  return rows.map((row) => ({
    id: row.id,
    status: row.status as TopupStatus,
    amountSats: row.amountSats,
    note: row.note,
    proposedBy: person(row.proposedBy),
    createdAt: row.createdAt,
    approvalsRequired: row.approvalsRequired,
    approvals: signoffs
      .filter((signoff) => signoff.topupId === row.id)
      .map((signoff) => ({ by: person(signoff.supervisorId), at: signoff.approvedAt })),
    floatBaselineSats: row.floatBaselineSats,
    transfer:
      row.transferReference !== null && row.transferredBy !== null && row.transferredAt !== null
        ? {
            reference: row.transferReference,
            by: person(row.transferredBy),
            at: row.transferredAt,
          }
        : null,
    outcome:
      row.outcomeAt !== null
        ? {
            at: row.outcomeAt,
            by: row.outcomeBy ? person(row.outcomeBy) : null,
            reason: row.outcomeReason,
          }
        : null,
  }));
}

export async function getTopupView(db: Database, topupId: string): Promise<TopupView | null> {
  const [row] = await db.select().from(treasuryTopups).where(eq(treasuryTopups.id, topupId));
  if (!row) {
    return null;
  }
  const [view] = await hydrate(db, [row]);
  return view ?? null;
}

/** Newest first, keyset-paginated; `status` narrows the list. `limit` is clamped to {@link TOPUP_PAGE_MAX}. */
export async function listTopups(
  db: Database,
  filter: { readonly status?: TopupStatus | undefined } = {},
  { cursor, limit = TOPUP_PAGE_DEFAULT }: { cursor?: string | undefined; limit?: number } = {},
): Promise<TopupPage> {
  const size = Math.min(Math.max(limit, 1), TOPUP_PAGE_MAX);
  const conditions = [];
  if (filter.status) {
    conditions.push(eq(treasuryTopups.status, filter.status));
  }
  if (cursor) {
    const after = decodeCursor(cursor);
    conditions.push(
      sql`(${treasuryTopups.createdAt}, ${treasuryTopups.id}) < (${after.ts}::timestamptz, ${after.id}::uuid)`,
    );
  }
  const rows = await db
    .select({ row: treasuryTopups, createdAtExact: sql<string>`${treasuryTopups.createdAt}::text` })
    .from(treasuryTopups)
    .where(and(...conditions))
    .orderBy(desc(treasuryTopups.createdAt), desc(treasuryTopups.id))
    .limit(size + 1);

  const page = rows.slice(0, size);
  const last = page[page.length - 1];
  return {
    topups: await hydrate(
      db,
      page.map((entry) => entry.row),
    ),
    nextCursor: rows.length > size && last ? encodeCursor(last.createdAtExact, last.row.id) : null,
  };
}

export type TreasuryOverview = {
  /** The hot wallet, read from the Lightning rail. `error` is set (and the numbers null) when it cannot be. */
  readonly hotWallet: {
    readonly available: number | null;
    readonly asOf: Date | null;
    readonly lowBalance: boolean | null;
    readonly error: 'float_unavailable' | null;
  };
  /** The ceiling and the room left under it (float + funding in flight). Both null when no cap is set. */
  readonly cap: { readonly sats: number | null; readonly headroomSats: number | null };
  readonly approvalsRequired: number;
  /** Sats in proposals still on their way: they count against the cap. */
  readonly inFlightSats: number;
  /** Proposals not yet confirmed, rejected or cancelled, newest first. */
  readonly pendingTopups: readonly TopupView[];
  /** Payouts waiting for the hot wallet to be refilled. */
  readonly pendingPayouts: { readonly count: number; readonly totalSats: number };
  /** The multisig pool. A read-only balance view is not built: the field says so rather than showing zero. */
  readonly pool: { readonly configured: false; readonly balanceSats: null };
};

/** One payload for the treasury panel (FR-7.5). A rail that cannot be read does not fail it. */
export async function getTreasuryOverview(
  db: Database,
  provider: FloatReader,
): Promise<TreasuryOverview> {
  const { payouts: payoutSettings, treasury } = getSettings();

  let hotWallet: TreasuryOverview['hotWallet'];
  try {
    const balance = await provider.getFloatBalance();
    hotWallet = {
      available: balance.available,
      asOf: balance.asOf,
      lowBalance: balance.available < payoutSettings.float_low_balance_alert_sats,
      error: null,
    };
  } catch {
    hotWallet = { available: null, asOf: null, lowBalance: null, error: 'float_unavailable' };
  }

  const inFlightSats = await openTopupSats(db);
  const openRows = await db
    .select()
    .from(treasuryTopups)
    .where(inArray(treasuryTopups.status, [...OPEN_TOPUP_STATUSES]))
    .orderBy(desc(treasuryTopups.createdAt), desc(treasuryTopups.id))
    .limit(TOPUP_PAGE_MAX);

  const [waiting] = await db
    .select({
      count: sql<number>`count(*)::int`,
      total: sql<string>`coalesce(sum(${payouts.amountSats}), 0)::text`,
    })
    .from(payouts)
    .where(eq(payouts.status, 'pending_float'));

  const capSats = treasury.hot_wallet_cap_sats > 0 ? treasury.hot_wallet_cap_sats : null;
  return {
    hotWallet,
    cap: {
      sats: capSats,
      headroomSats:
        capSats !== null && hotWallet.available !== null
          ? Math.max(0, capSats - hotWallet.available - inFlightSats)
          : null,
    },
    approvalsRequired: treasury.topup_approvals_required,
    inFlightSats,
    pendingTopups: await hydrate(db, openRows),
    pendingPayouts: { count: waiting?.count ?? 0, totalSats: Number(waiting?.total ?? 0) },
    pool: { configured: false, balanceSats: null },
  };
}
