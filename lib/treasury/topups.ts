// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The funding vote (ADR-0020, docs/TREASURY.md): stewards agree to refill the capped hot
 * wallet from the multisig pool. Taka Sats RECORDS the vote and never moves pool funds:
 *
 *   propose ─► approve (distinct stewards, never the proposer) ─► the transfer is signed in
 *   the pool's own wallet ─► a steward records its txid ─► the hot-wallet float rises ─► confirmed
 *
 * Rules this module enforces:
 *  - The proposer cannot approve or reject their own proposal (code AND a database trigger);
 *    an approver counts once (UNIQUE topup+approver); approvals are immutable rows.
 *  - Every state change appends a `treasury_topup` entry to the ledger chain, atomically with
 *    the row change.
 *  - A proposal that would take the hot wallet above `treasury.hot_wallet_cap_sats` (float +
 *    funding already in flight + this amount) is refused. If the float cannot be read the
 *    proposal is refused too: nothing is guessed.
 *  - A transfer reference (txid) can back only one proposal.
 *  - Arrival is judged from the rail's own balance, never from what a person claims.
 *
 * Concurrency: every change to an existing proposal runs under a row lock (`FOR UPDATE`),
 * taken BEFORE the ledger lock; proposals serialise on an advisory lock so the cap cannot
 * be beaten by two simultaneous proposals. Framework-free apart from Drizzle (D-04); server only.
 */

import { randomUUID } from 'node:crypto';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { roleHasScope, type Role, type Scope } from '@/lib/auth/permissions';
import { getSettings } from '@/lib/config';
import type { Database, Tx } from '@/lib/db/client';
import { isUniqueViolation } from '@/lib/db/pg-errors';
import { payouts, treasuryTopups, treasuryTopupSignoffs } from '@/lib/db/schema';
import { appendEntryTx, payloadHash } from '@/lib/ledger';
import type { LightningProvider } from '@/lib/lightning/LightningProvider';
import type { Canonicalizable } from '@/lib/sync/contentHash';
import {
  TopupApprovalError,
  TopupCapError,
  TopupConflictError,
  TopupFloatUnavailableError,
  TopupInputError,
  TopupNotFoundError,
  TopupStateError,
} from './errors';

export const TOPUP_STATUSES = [
  'proposed',
  'approved',
  'transferred',
  'confirmed',
  'rejected',
  'cancelled',
] as const;
export type TopupStatus = (typeof TOPUP_STATUSES)[number];

/** Proposals whose sats may still land in the hot wallet: they count against the cap. */
export const OPEN_TOPUP_STATUSES = [
  'proposed',
  'approved',
  'transferred',
] as const satisfies readonly TopupStatus[];

export type TopupRecord = typeof treasuryTopups.$inferSelect;
export type FloatReader = Pick<LightningProvider, 'getFloatBalance'>;
export type Steward = { readonly id: string; readonly role: Role };

/** Serialises proposals, so the cap check and the insert cannot interleave. */
const TOPUP_LOCK_KEY = 8_264_072;

const MAX_REFERENCE_LENGTH = 200;

type TopupEvent =
  'proposed' | 'approved' | 'transfer_recorded' | 'confirmed' | 'rejected' | 'cancelled';

function requireScope(actor: Steward, scope: Scope): void {
  if (!roleHasScope(actor.role, scope)) {
    throw new TopupApprovalError('not_permitted');
  }
}

function requireAmount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new TopupInputError('A top-up amount must be a positive whole number of sats');
  }
  return value;
}

function cleanNote(note: string | null | undefined): string | null {
  const trimmed = note?.trim();
  return trimmed ? trimmed : null;
}

/** A txid or other pool-wallet reference: printable, no spaces, stored lower-case. */
export function normaliseTransferReference(reference: string): string {
  const trimmed = reference.trim().toLowerCase();
  if (
    trimmed.length === 0 ||
    trimmed.length > MAX_REFERENCE_LENGTH ||
    !/^[\x21-\x7e]+$/.test(trimmed)
  ) {
    throw new TopupInputError(
      `A transfer reference is 1 to ${MAX_REFERENCE_LENGTH} printable characters without spaces`,
    );
  }
  return trimmed;
}

/** The hot-wallet balance. Any failure becomes one opaque error: the rail's message is never passed on. */
async function readFloat(provider: FloatReader): Promise<number> {
  try {
    return (await provider.getFloatBalance()).available;
  } catch {
    throw new TopupFloatUnavailableError();
  }
}

async function tryReadFloat(provider: FloatReader): Promise<number | null> {
  try {
    return await readFloat(provider);
  } catch {
    return null;
  }
}

/** Sats in proposals that may still land in the hot wallet. */
export async function openTopupSats(db: Database | Tx): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${treasuryTopups.amountSats}), 0)::text` })
    .from(treasuryTopups)
    .where(inArray(treasuryTopups.status, [...OPEN_TOPUP_STATUSES]));
  return Number(row?.total ?? 0);
}

/** Append the `treasury_topup` ledger entry for one state change, inside the caller's transaction. */
async function anchor(
  tx: Tx,
  event: TopupEvent,
  fields: Readonly<Record<string, Canonicalizable | undefined>>,
) {
  return appendEntryTx(tx, {
    entryType: 'treasury_topup',
    payloadHash: await payloadHash({ type: 'treasury_topup', event, ...fields }),
  });
}

async function requireTopup(db: Database, topupId: string): Promise<TopupRecord> {
  const [row] = await db.select().from(treasuryTopups).where(eq(treasuryTopups.id, topupId));
  if (!row) {
    throw new TopupNotFoundError(`funding proposal ${topupId}`);
  }
  return row;
}

/** The row, locked for the rest of the transaction. */
async function lockTopup(tx: Tx, topupId: string): Promise<TopupRecord> {
  const [row] = await tx
    .select()
    .from(treasuryTopups)
    .where(eq(treasuryTopups.id, topupId))
    .for('update');
  if (!row) {
    throw new TopupNotFoundError(`funding proposal ${topupId}`);
  }
  return row;
}

export type TopupOutcome = { readonly topup: TopupRecord; readonly changed: boolean };

/**
 * Propose refilling the hot wallet with `amountSats` from the pool. Idempotent by the optional
 * client `id`: a resend of the same proposal returns the stored one, a resend with different
 * content is a conflict.
 *
 * @throws {TopupApprovalError} the role cannot propose.
 * @throws {TopupInputError} the amount is not a positive whole number of sats.
 * @throws {TopupFloatUnavailableError} a cap is set and the float cannot be read.
 * @throws {TopupCapError} the proposal would exceed the cap.
 * @throws {TopupConflictError} `id` is already used by a different proposal.
 */
export async function proposeTopup(
  db: Database,
  provider: FloatReader,
  input: {
    readonly id?: string | undefined;
    readonly amountSats: number;
    readonly note?: string | null | undefined;
    readonly actor: Steward;
  },
): Promise<TopupOutcome> {
  requireScope(input.actor, 'treasury:propose');
  const amount = requireAmount(input.amountSats);
  const note = cleanNote(input.note);
  const { hot_wallet_cap_sats: cap, topup_approvals_required: approvalsRequired } =
    getSettings().treasury;

  /** The stored proposal for a resent id, if it is the same proposal. */
  const resent = async (client: Database | Tx): Promise<TopupRecord | null> => {
    if (!input.id) {
      return null;
    }
    const [existing] = await client
      .select()
      .from(treasuryTopups)
      .where(eq(treasuryTopups.id, input.id));
    if (!existing) {
      return null;
    }
    if (existing.proposedBy !== input.actor.id || existing.amountSats !== amount) {
      throw new TopupConflictError('That id is already used by a different proposal');
    }
    return existing;
  };

  const earlier = await resent(db);
  if (earlier) {
    return { topup: earlier, changed: false };
  }

  // The rail is read OUTSIDE the transaction: no row or ledger lock is held across a network call.
  const floatSats = cap > 0 ? await readFloat(provider) : 0;

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${TOPUP_LOCK_KEY})`);
    const raced = await resent(tx);
    if (raced) {
      return { topup: raced, changed: false };
    }

    if (cap > 0) {
      const headroom = Math.max(0, cap - floatSats - (await openTopupSats(tx)));
      if (amount > headroom) {
        throw new TopupCapError(cap, headroom);
      }
    }

    const id = input.id ?? randomUUID();
    const entry = await anchor(tx, 'proposed', {
      topupId: id,
      amountSats: amount,
      proposedBy: input.actor.id,
      approvalsRequired,
      note,
      at: new Date().toISOString(),
    });
    const [created] = await tx
      .insert(treasuryTopups)
      .values({
        id,
        ledgerEntryId: entry.id,
        amountSats: amount,
        note,
        proposedBy: input.actor.id,
        approvalsRequired,
      })
      .returning();
    if (!created) {
      throw new Error('proposeTopup: insert returned no row');
    }
    return { topup: created, changed: true };
  });
}

/**
 * Record one steward's approval. The proposer cannot approve; an approver counts once (a resend is
 * a no-op); nobody can approve a proposal that is cancelled, rejected or already past its vote. The
 * approval that completes the quorum moves the proposal to `approved` and notes the hot-wallet float
 * at that moment, the baseline arrival is later judged against (best effort: if the rail cannot be
 * read now, the baseline is taken when the transfer is recorded).
 *
 * @throws {TopupApprovalError} `not_permitted` (role) or `self_approval` (the proposer).
 * @throws {TopupStateError} the proposal is not open for approval.
 */
export async function approveTopup(
  db: Database,
  provider: FloatReader,
  input: { readonly topupId: string; readonly actor: Steward },
): Promise<TopupOutcome> {
  const { topupId, actor } = input;
  requireScope(actor, 'treasury:approve');

  // If this approval might complete the quorum, read the float first (network, outside any lock).
  let baseline: { sats: number; at: Date } | null = null;
  const [preview] = await db.select().from(treasuryTopups).where(eq(treasuryTopups.id, topupId));
  if (preview?.status === 'proposed' && preview.proposedBy !== actor.id) {
    const [count] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(treasuryTopupSignoffs)
      .where(eq(treasuryTopupSignoffs.topupId, topupId));
    if ((count?.n ?? 0) + 1 >= preview.approvalsRequired) {
      const sats = await tryReadFloat(provider);
      baseline = sats === null ? null : { sats, at: new Date() };
    }
  }

  return db.transaction(async (tx) => {
    const topup = await lockTopup(tx, topupId);
    if (topup.proposedBy === actor.id) {
      throw new TopupApprovalError('self_approval');
    }
    if (topup.status === 'rejected' || topup.status === 'cancelled') {
      throw new TopupStateError(topup.status, 'approve');
    }
    const [already] = await tx
      .select({ id: treasuryTopupSignoffs.id })
      .from(treasuryTopupSignoffs)
      .where(
        and(
          eq(treasuryTopupSignoffs.topupId, topup.id),
          eq(treasuryTopupSignoffs.supervisorId, actor.id),
        ),
      );
    if (already) {
      return { topup, changed: false };
    }
    if (topup.status !== 'proposed') {
      throw new TopupStateError(topup.status, 'approve');
    }

    const [count] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(treasuryTopupSignoffs)
      .where(eq(treasuryTopupSignoffs.topupId, topup.id));
    const approvals = (count?.n ?? 0) + 1;
    const quorum = approvals >= topup.approvalsRequired;
    const at = new Date();

    const entry = await anchor(tx, 'approved', {
      topupId: topup.id,
      approver: actor.id,
      approvals,
      approvalsRequired: topup.approvalsRequired,
      quorumReached: quorum,
      at: at.toISOString(),
    });
    await tx.insert(treasuryTopupSignoffs).values({
      topupId: topup.id,
      supervisorId: actor.id,
      ledgerEntryId: entry.id,
      approvedAt: at,
    });
    if (!quorum) {
      return { topup, changed: true };
    }
    const [approved] = await tx
      .update(treasuryTopups)
      .set({
        status: 'approved',
        floatBaselineSats: baseline?.sats ?? null,
        floatBaselineAt: baseline?.at ?? null,
      })
      .where(and(eq(treasuryTopups.id, topup.id), eq(treasuryTopups.status, 'proposed')))
      .returning();
    if (!approved) {
      throw new TopupStateError(topup.status, 'approve');
    }
    return { topup: approved, changed: true };
  });
}

/**
 * Record the pool transfer's txid or reference, after the stewards signed it in the pool's own
 * wallet. Idempotent for the same reference; a different reference on a transferred proposal, or
 * one already used by another proposal, is a conflict. Needs a float baseline: if quorum could not
 * read one, it is read now (and the call fails with `TopupFloatUnavailableError` if it cannot be).
 *
 * @throws {TopupStateError} the proposal is not `approved`.
 */
export async function recordTopupTransfer(
  db: Database,
  provider: FloatReader,
  input: { readonly topupId: string; readonly reference: string; readonly actor: Steward },
): Promise<TopupOutcome> {
  const { topupId, actor } = input;
  requireScope(actor, 'treasury:propose');
  const reference = normaliseTransferReference(input.reference);

  const preview = await requireTopup(db, topupId);
  let baseline: { sats: number; at: Date } | null = null;
  if (preview.status === 'approved' && preview.floatBaselineSats === null) {
    baseline = { sats: await readFloat(provider), at: new Date() };
  }

  try {
    return await db.transaction(async (tx) => {
      const topup = await lockTopup(tx, topupId);
      if (topup.status === 'transferred' || topup.status === 'confirmed') {
        if (topup.transferReference === reference) {
          return { topup, changed: false };
        }
        throw new TopupConflictError('A different transfer reference is already recorded');
      }
      if (topup.status !== 'approved') {
        throw new TopupStateError(topup.status, 'record a transfer for');
      }
      const at = new Date();
      const entry = await anchor(tx, 'transfer_recorded', {
        topupId: topup.id,
        amountSats: topup.amountSats,
        reference,
        recordedBy: actor.id,
        at: at.toISOString(),
      });
      const [transferred] = await tx
        .update(treasuryTopups)
        .set({
          status: 'transferred',
          transferReference: reference,
          transferredBy: actor.id,
          transferredAt: at,
          transferLedgerEntryId: entry.id,
          ...(topup.floatBaselineSats === null && baseline
            ? { floatBaselineSats: baseline.sats, floatBaselineAt: baseline.at }
            : {}),
        })
        .where(and(eq(treasuryTopups.id, topup.id), eq(treasuryTopups.status, 'approved')))
        .returning();
      if (!transferred) {
        throw new TopupStateError(topup.status, 'record a transfer for');
      }
      return { topup: transferred, changed: true };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new TopupConflictError('That transfer reference is already recorded on a proposal');
    }
    throw error;
  }
}

export type ConfirmOutcome = TopupOutcome & {
  /** True when the rail's balance shows the funds landed (also true if it was confirmed earlier). */
  readonly arrived: boolean;
};

/**
 * Check whether a `transferred` proposal's funds reached the hot wallet and, if so, confirm it.
 * Evidence: the float now, plus what payouts have spent since the baseline, is at least the
 * baseline plus the amount. A person's say-so is never enough. Called by a steward
 * (`actor`) or by the worker (`actor: null`). `arrived: false` is not an error: try again later.
 *
 * @throws {TopupFloatUnavailableError} the balance could not be read.
 * @throws {TopupStateError} the proposal has not been transferred (or was closed another way).
 */
export async function confirmTopup(
  db: Database,
  provider: FloatReader,
  input: { readonly topupId: string; readonly actor: Steward | null },
): Promise<ConfirmOutcome> {
  const { topupId, actor } = input;
  if (actor) {
    requireScope(actor, 'treasury:approve');
  }
  const topup = await requireTopup(db, topupId);
  if (topup.status === 'confirmed') {
    return { topup, changed: false, arrived: true };
  }
  if (topup.status !== 'transferred') {
    throw new TopupStateError(topup.status, 'confirm');
  }
  if (topup.floatBaselineSats === null || topup.floatBaselineAt === null) {
    // Cannot happen through the API (recording a transfer requires a baseline); never guess.
    throw new TopupStateError(topup.status, 'confirm without a float baseline');
  }

  const available = await readFloat(provider);
  const [spent] = await db
    .select({ total: sql<string>`coalesce(sum(${payouts.amountSats}), 0)::text` })
    .from(payouts)
    .where(
      and(
        inArray(payouts.status, ['sending', 'paid']),
        gte(payouts.attemptedAt, topup.floatBaselineAt),
      ),
    );
  const spentSinceBaseline = Number(spent?.total ?? 0);
  if (available + spentSinceBaseline < topup.floatBaselineSats + topup.amountSats) {
    return { topup, changed: false, arrived: false };
  }

  return db.transaction(async (tx) => {
    const locked = await lockTopup(tx, topupId);
    if (locked.status === 'confirmed') {
      return { topup: locked, changed: false, arrived: true };
    }
    if (locked.status !== 'transferred') {
      throw new TopupStateError(locked.status, 'confirm');
    }
    const at = new Date();
    const entry = await anchor(tx, 'confirmed', {
      topupId: locked.id,
      amountSats: locked.amountSats,
      reference: locked.transferReference,
      floatSats: available,
      floatBaselineSats: topup.floatBaselineSats,
      spentSinceBaselineSats: spentSinceBaseline,
      confirmedBy: actor?.id ?? null,
      at: at.toISOString(),
    });
    const [confirmed] = await tx
      .update(treasuryTopups)
      .set({
        status: 'confirmed',
        outcomeAt: at,
        outcomeBy: actor?.id ?? null,
        outcomeLedgerEntryId: entry.id,
      })
      .where(and(eq(treasuryTopups.id, locked.id), eq(treasuryTopups.status, 'transferred')))
      .returning();
    if (!confirmed) {
      throw new TopupStateError(locked.status, 'confirm');
    }
    return { topup: confirmed, changed: true, arrived: true };
  });
}

/** Statuses a vote can still be stopped from: nothing has moved in the pool wallet that Taka Sats knows of. */
const STOPPABLE = ['proposed', 'approved'] as const;

async function closeTopup(
  db: Database,
  input: {
    readonly topupId: string;
    readonly actor: Steward;
    readonly reason?: string | null | undefined;
    readonly to: 'cancelled' | 'rejected';
  },
): Promise<TopupOutcome> {
  const { topupId, actor, to } = input;
  const reason = cleanNote(input.reason);
  const verb = to === 'cancelled' ? 'cancel' : 'reject';
  return db.transaction(async (tx) => {
    const topup = await lockTopup(tx, topupId);
    if (to === 'cancelled' && topup.proposedBy !== actor.id) {
      throw new TopupApprovalError('not_proposer');
    }
    if (to === 'rejected' && topup.proposedBy === actor.id) {
      throw new TopupApprovalError('self_approval');
    }
    if (topup.status === to) {
      return { topup, changed: false };
    }
    if (!(STOPPABLE as readonly string[]).includes(topup.status)) {
      throw new TopupStateError(topup.status, verb);
    }
    const at = new Date();
    const entry = await anchor(tx, to, {
      topupId: topup.id,
      amountSats: topup.amountSats,
      by: actor.id,
      reason,
      at: at.toISOString(),
    });
    const [closed] = await tx
      .update(treasuryTopups)
      .set({
        status: to,
        outcomeAt: at,
        outcomeBy: actor.id,
        outcomeReason: reason,
        outcomeLedgerEntryId: entry.id,
      })
      .where(and(eq(treasuryTopups.id, topup.id), inArray(treasuryTopups.status, [...STOPPABLE])))
      .returning();
    if (!closed) {
      throw new TopupStateError(topup.status, verb);
    }
    return { topup: closed, changed: true };
  });
}

/**
 * The proposer withdraws their own proposal (before any transfer is recorded). Idempotent.
 * @throws {TopupApprovalError} `not_proposer`: only the proposer cancels; others reject.
 */
export async function cancelTopup(
  db: Database,
  input: {
    readonly topupId: string;
    readonly actor: Steward;
    readonly reason?: string | null | undefined;
  },
): Promise<TopupOutcome> {
  requireScope(input.actor, 'treasury:propose');
  return closeTopup(db, { ...input, to: 'cancelled' });
}

/**
 * A steward other than the proposer refuses a proposal (a single veto: it only ever stops money
 * from moving, and a new proposal can follow). Idempotent.
 * @throws {TopupApprovalError} `self_approval`: the proposer cancels instead.
 */
export async function rejectTopup(
  db: Database,
  input: {
    readonly topupId: string;
    readonly actor: Steward;
    readonly reason?: string | null | undefined;
  },
): Promise<TopupOutcome> {
  requireScope(input.actor, 'treasury:approve');
  return closeTopup(db, { ...input, to: 'rejected' });
}

/** Ids of proposals whose funds have been transferred and not yet seen to arrive. */
export async function transferredTopupIds(db: Database): Promise<string[]> {
  const rows = await db
    .select({ id: treasuryTopups.id })
    .from(treasuryTopups)
    .where(eq(treasuryTopups.status, 'transferred'));
  return rows.map((row) => row.id);
}

/**
 * The worker's pass: confirm every transferred proposal whose funds are visible on the rail.
 * A balance that cannot be read, or one proposal failing, never stops the others. Returns how
 * many were confirmed this time.
 */
export async function confirmArrivedTopups(db: Database, provider: FloatReader): Promise<number> {
  let confirmed = 0;
  for (const topupId of await transferredTopupIds(db)) {
    try {
      const outcome = await confirmTopup(db, provider, { topupId, actor: null });
      if (outcome.changed) {
        confirmed += 1;
      }
    } catch (error) {
      console.error(
        '[treasury] could not check a top-up',
        error instanceof Error ? error.name : typeof error,
      );
    }
  }
  return confirmed;
}
