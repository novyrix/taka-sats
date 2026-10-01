// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The payout engine (REQUIREMENTS §10.4, ROADMAP M5). One payout row per collection
 * event; {@link processPayout} walks it through a fixed sequence of checks and either
 * parks it (with a reason) or sends it:
 *
 *   collector active → verified destination → fresh rate + price → approval → float → send
 *
 * Rules this module enforces (Code Style Guide §9, REQUIREMENTS §12):
 *  - The destination is resolved HERE from the collector's verified payment destination.
 *    No function in this module takes an address or destination argument.
 *  - The amount comes only from `computePayoutDetail`, priced with the rate that was
 *    active when the event was recorded (D-14), against a fresh exchange snapshot (D-18).
 *  - Nothing is sent twice. Every transition is a conditional UPDATE (so two concurrent
 *    callers cannot both claim a payout), the claim happens BEFORE the provider call, and
 *    a payout whose outcome is unknown stays `sending` and is flagged `payout_uncertain`
 *    for a human — it is never re-sent automatically.
 *  - `paid` and its `payout` ledger entry are written in one transaction.
 *  - Logs carry an explicit allow-list of fields — never an address, key or amount (§12.6).
 *
 * Framework-free apart from Drizzle (D-04); server only.
 */

import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { roleHasScope, type Role } from '@/lib/auth/permissions';
import { getLiveDestination } from '@/lib/collectors';
import { getSettings } from '@/lib/config';
import type { Database, Queryable } from '@/lib/db/client';
import {
  anomalyFlags,
  collectionEvents,
  collectors,
  materialRates,
  payouts,
} from '@/lib/db/schema';
import { appendEntryTx, payloadHash } from '@/lib/ledger';
import {
  InvalidLightningAddressError,
  LightningEndpointUnreachableError,
  NotReceiveCapableError,
  PaymentFailedError,
} from '@/lib/lightning/errors';
import type { LightningProvider, PayResult } from '@/lib/lightning/LightningProvider';
import {
  computePayoutDetail,
  fiatMinorPerBtcFromMajor,
  MoneyError,
  type PayoutAmounts,
} from '@/lib/money';
import { requireFreshRate, StaleRateError } from '@/lib/money/rates';
import { PayoutApprovalError, PayoutNotFoundError, PayoutStateError } from './errors';

export type PayoutRecord = typeof payouts.$inferSelect;

export const PAYOUT_STATUSES = [
  'awaiting_rate',
  'awaiting_destination',
  'pending_approval',
  'pending_float',
  'queued',
  'sending',
  'paid',
  'failed',
] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

/** The states {@link processPayout} may start from. `sending`, `paid` and `failed` are never re-run. */
const EVALUABLE = [
  'awaiting_rate',
  'awaiting_destination',
  'pending_approval',
  'pending_float',
  'queued',
] as const satisfies readonly PayoutStatus[];

/** What the sweeper re-enqueues — everything evaluable except an un-approved `pending_approval`. */
const SWEEPABLE = ['awaiting_rate', 'pending_float', 'queued'] as const;

type PayoutPatch = Partial<typeof payouts.$inferInsert>;

function logOutcome(payout: PayoutRecord): void {
  console.info(
    '[payouts]',
    JSON.stringify({
      payoutId: payout.id,
      status: payout.status,
      attempts: payout.attempts,
      lastError: payout.lastError,
      provider: payout.provider,
    }),
  );
}

async function requirePayout(db: Database, payoutId: string): Promise<PayoutRecord> {
  const [row] = await db.select().from(payouts).where(eq(payouts.id, payoutId));
  if (!row) {
    throw new PayoutNotFoundError(`payout ${payoutId}`);
  }
  return row;
}

/**
 * Create the payout for a collection event, or return the one that already exists
 * (`collection_event_id` is UNIQUE — resending a sync or re-running a trigger is safe).
 * It starts in `awaiting_rate`; {@link processPayout} moves it on.
 */
export async function createPayoutForEvent(
  db: Queryable,
  collectionEventId: string,
): Promise<PayoutRecord> {
  const [event] = await db
    .select({ collectorId: collectionEvents.collectorId, fiatCurrency: materialRates.fiatCurrency })
    .from(collectionEvents)
    .innerJoin(materialRates, eq(materialRates.id, collectionEvents.rateId))
    .where(eq(collectionEvents.id, collectionEventId));
  if (!event) {
    throw new PayoutNotFoundError(`collection event ${collectionEventId}`);
  }

  const [created] = await db
    .insert(payouts)
    .values({
      collectionEventId,
      collectorId: event.collectorId,
      fiatCurrency: event.fiatCurrency,
    })
    .onConflictDoNothing({ target: payouts.collectionEventId })
    .returning();
  if (created) {
    return created;
  }
  const [existing] = await db
    .select()
    .from(payouts)
    .where(eq(payouts.collectionEventId, collectionEventId));
  if (!existing) {
    throw new PayoutNotFoundError(`payout for event ${collectionEventId}`);
  }
  return existing;
}

/** Approval is needed above the threshold, and (if configured) for a destination never paid before. */
async function needsApproval(
  db: Database,
  amountSats: number,
  destinationId: string,
): Promise<boolean> {
  const { second_signoff_threshold_sats, require_approval_first_payout } = getSettings().payouts;
  if (amountSats > second_signoff_threshold_sats) {
    return true;
  }
  if (!require_approval_first_payout) {
    return false;
  }
  const [paid] = await db
    .select({ id: payouts.id })
    .from(payouts)
    .where(and(eq(payouts.destinationId, destinationId), eq(payouts.status, 'paid')))
    .limit(1);
  return !paid;
}

/**
 * Record a `payout_uncertain` flag for an admin, once per payout. The outcome of the
 * provider call is unknown (it may have succeeded), so the payout is left as it is and
 * is never re-sent. Returns true when a new flag was written.
 */
async function flagUncertain(
  db: Database,
  payout: PayoutRecord,
  reason: 'stale_sending' | 'outcome_unknown' | 'bookkeeping_failed',
): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${payout.id}, 0))`);
    const [existing] = await tx
      .select({ id: anomalyFlags.id })
      .from(anomalyFlags)
      .where(
        and(
          eq(anomalyFlags.flagType, 'payout_uncertain'),
          sql`${anomalyFlags.context}->>'payoutId' = ${payout.id}`,
        ),
      );
    if (existing) {
      return false;
    }
    await tx.insert(anomalyFlags).values({
      collectionEventId: payout.collectionEventId,
      flagType: 'payout_uncertain',
      context: { payoutId: payout.id, reason },
    });
    return true;
  });
}

/** The `attempted_at` before which a `sending` payout counts as stuck. */
function staleCutoff(now: Date): Date {
  return new Date(now.getTime() - getSettings().payouts.sending_stale_minutes * 60_000);
}

/** Flag every payout stuck in `sending` longer than `payouts.sending_stale_minutes`. Returns how many were newly flagged. */
export async function flagStaleSendingPayouts(db: Database, now = new Date()): Promise<number> {
  const cutoff = staleCutoff(now);
  const stale = await db
    .select()
    .from(payouts)
    .where(and(eq(payouts.status, 'sending'), lt(payouts.attemptedAt, cutoff)));
  let flagged = 0;
  for (const payout of stale) {
    if (await flagUncertain(db, payout, 'stale_sending')) {
      flagged += 1;
    }
  }
  return flagged;
}

/** How a provider error maps to the payout: definitely not sent (fail / retry later) or unknown. */
function classifyPayError(
  error: unknown,
): { kind: 'failed' | 'retry'; code: string } | { kind: 'unknown' } {
  if (error instanceof PaymentFailedError) {
    return { kind: 'failed', code: 'payment_failed' };
  }
  // These are thrown while resolving the destination — before any money moves.
  if (error instanceof LightningEndpointUnreachableError) {
    return { kind: 'retry', code: 'destination_unreachable' };
  }
  if (error instanceof InvalidLightningAddressError || error instanceof NotReceiveCapableError) {
    return { kind: 'failed', code: 'destination_rejected' };
  }
  return { kind: 'unknown' };
}

/**
 * Move a payout as far as it can go right now. Idempotent and safe to call concurrently
 * or repeatedly (job retries, the sweeper): see the module comment for the guarantees.
 *
 * @param provider the active rail; only `getFloatBalance` and `pay` are used.
 * @param now injectable clock (staleness checks, `attempted_at`).
 */
export async function processPayout(
  db: Database,
  provider: Pick<LightningProvider, 'kind' | 'pay' | 'getFloatBalance'>,
  payoutId: string,
  now: Date = new Date(),
): Promise<PayoutRecord> {
  const before = await requirePayout(db, payoutId);
  const after = await evaluate(db, provider, before, now);
  if (after.status !== before.status || after.lastError !== before.lastError) {
    logOutcome(after);
  }
  return after;
}

async function evaluate(
  db: Database,
  provider: Pick<LightningProvider, 'kind' | 'pay' | 'getFloatBalance'>,
  payout: PayoutRecord,
  now: Date,
): Promise<PayoutRecord> {
  if (payout.status === 'sending') {
    // A crash may have left it mid-send. Never re-send — just make sure a human is told.
    if (payout.attemptedAt && payout.attemptedAt < staleCutoff(now)) {
      await flagUncertain(db, payout, 'stale_sending');
    }
    return payout;
  }
  if (!(EVALUABLE as readonly string[]).includes(payout.status)) {
    return payout;
  }

  /** Apply a transition — only while the payout is still evaluable (loses cleanly to a concurrent caller). */
  const move = async (patch: PayoutPatch): Promise<PayoutRecord> => {
    const [row] = await db
      .update(payouts)
      .set(patch)
      .where(and(eq(payouts.id, payout.id), inArray(payouts.status, [...EVALUABLE])))
      .returning();
    return row ?? requirePayout(db, payout.id);
  };

  // (a) Only an authorized collector is ever paid (D-25).
  const [collector] = await db
    .select({ status: collectors.status })
    .from(collectors)
    .where(eq(collectors.id, payout.collectorId));
  if (collector?.status !== 'active') {
    return move({ status: 'failed', lastError: 'collector_not_authorized' });
  }

  // (b) The destination is resolved server-side from the collector's own record — never supplied.
  const destination = await getLiveDestination(db, payout.collectorId);
  if (destination?.status !== 'verified') {
    return move({
      status: 'awaiting_destination',
      lastError: destination ? 'destination_not_verified' : 'no_destination',
    });
  }

  // (c) Price it: the rate that applied to the event (not today's), at a fresh BTC price.
  const [event] = await db
    .select({
      recorder: collectionEvents.supervisorId,
      weightKg: collectionEvents.weightKg,
      rateFiatMinor: materialRates.rateFiatMinor,
    })
    .from(collectionEvents)
    .innerJoin(materialRates, eq(materialRates.id, collectionEvents.rateId))
    .where(eq(collectionEvents.id, payout.collectionEventId));
  if (!event) {
    throw new PayoutNotFoundError(`collection event ${payout.collectionEventId}`);
  }
  let snapshot: Awaited<ReturnType<typeof requireFreshRate>>;
  try {
    snapshot = await requireFreshRate(db, 'BTC', payout.fiatCurrency, now);
  } catch (error) {
    if (error instanceof StaleRateError) {
      return move({ status: 'awaiting_rate', lastError: 'stale_exchange_rate' });
    }
    throw error;
  }
  let amounts: PayoutAmounts;
  try {
    amounts = computePayoutDetail({
      weightKg: Number(event.weightKg),
      rateFiatMinorPerKg: event.rateFiatMinor,
      exchange: {
        id: snapshot.id,
        fiatMinorPerBtc: fiatMinorPerBtcFromMajor(snapshot.rate),
        capturedAt: snapshot.fetchedAt,
      },
      rateStalenessTtlSeconds: getSettings().money.rate_staleness_ttl_seconds,
      now,
    });
  } catch (error) {
    if (error instanceof MoneyError) {
      return move({ status: 'failed', lastError: 'amount_not_payable' });
    }
    throw error;
  }
  const priced = {
    amountSats: amounts.sats,
    amountFiatMinor: amounts.fiatMinor,
    exchangeSnapshotId: snapshot.id,
    destinationId: destination.id,
  };

  // (d) Approval. An approval is bound to the destination it was given for: if the
  // destination has since changed, it no longer counts and a new approval is needed.
  const approvedForThis = payout.approvedBy !== null && payout.destinationId === destination.id;
  if (!approvedForThis && (await needsApproval(db, amounts.sats, destination.id))) {
    return move({
      status: 'pending_approval',
      ...priced,
      approvedBy: null,
      approvedAt: null,
      lastError: null,
    });
  }

  // (e) Float — a payout is never attempted against a balance that cannot cover it (FR-7.4).
  let available: number;
  try {
    available = (await provider.getFloatBalance()).available;
  } catch {
    return move({ status: 'pending_float', ...priced, lastError: 'float_unavailable' });
  }
  if (available < amounts.sats) {
    return move({ status: 'pending_float', ...priced, lastError: 'insufficient_float' });
  }

  // (f) Claim, THEN send. The conditional UPDATE is the lock: only one caller gets the row.
  const [claimed] = await db
    .update(payouts)
    .set({
      status: 'sending',
      ...priced,
      provider: provider.kind,
      attemptedAt: now,
      attempts: sql`${payouts.attempts} + 1`,
      lastError: null,
    })
    .where(and(eq(payouts.id, payout.id), inArray(payouts.status, [...EVALUABLE])))
    .returning();
  if (!claimed) {
    return requirePayout(db, payout.id);
  }

  let result: PayResult;
  try {
    result = await provider.pay({ lnurlOrAddress: destination.address }, amounts.sats, payout.id);
  } catch (error) {
    const outcome = classifyPayError(error);
    if (outcome.kind === 'unknown') {
      // The payment may have gone through. Leave it `sending`; a human decides.
      await flagUncertain(db, claimed, 'outcome_unknown');
      const [row] = await db
        .update(payouts)
        .set({ lastError: 'outcome_unknown' })
        .where(eq(payouts.id, claimed.id))
        .returning();
      return row ?? claimed;
    }
    const [row] = await db
      .update(payouts)
      .set({
        status: outcome.kind === 'retry' ? 'queued' : 'failed',
        lastError: outcome.code,
      })
      .where(and(eq(payouts.id, claimed.id), eq(payouts.status, 'sending')))
      .returning();
    return row ?? claimed;
  }

  // Paid. Record it and chain it atomically; if bookkeeping fails the money is already
  // gone, so flag it for a human rather than ever sending again.
  try {
    return await db.transaction(async (tx) => {
      const entry = await appendEntryTx(tx, {
        entryType: 'payout',
        payloadHash: await payloadHash({
          payoutId: claimed.id,
          collectionEventId: claimed.collectionEventId,
          amountSats: amounts.sats,
          amountFiatMinor: amounts.fiatMinor,
          exchangeSnapshotId: snapshot.id,
          provider: provider.kind,
          paymentRef: result.paymentRef,
          settledAt: result.settledAt.toISOString(),
        }),
      });
      const [paid] = await tx
        .update(payouts)
        .set({
          status: 'paid',
          providerPaymentRef: result.paymentRef,
          settledAt: result.settledAt,
          ledgerEntryId: entry.id,
          lastError: null,
        })
        .where(and(eq(payouts.id, claimed.id), eq(payouts.status, 'sending')))
        .returning();
      if (!paid) {
        throw new PayoutStateError('unknown', 'settle');
      }
      return paid;
    });
  } catch (error) {
    await flagUncertain(db, claimed, 'bookkeeping_failed');
    throw error;
  }
}

/**
 * Approve a payout held in `pending_approval` (FR-3.2). The approver must hold
 * `payout:approve` and must NOT be the supervisor who recorded the collection.
 * Idempotent: an already-approved payout is returned unchanged. The caller enqueues
 * processing afterwards.
 *
 * @throws {PayoutApprovalError} role cannot approve, or approver recorded the event.
 * @throws {PayoutStateError} the payout is not awaiting approval.
 */
export async function approvePayout(
  db: Database,
  input: {
    readonly payoutId: string;
    readonly actor: { readonly id: string; readonly role: Role };
  },
): Promise<{ readonly payout: PayoutRecord; readonly changed: boolean }> {
  const { payoutId, actor } = input;
  if (!roleHasScope(actor.role, 'payout:approve')) {
    throw new PayoutApprovalError('not_permitted');
  }
  const payout = await requirePayout(db, payoutId);

  const [event] = await db
    .select({ recorder: collectionEvents.supervisorId })
    .from(collectionEvents)
    .where(eq(collectionEvents.id, payout.collectionEventId));
  if (event?.recorder === actor.id) {
    throw new PayoutApprovalError('self_approval');
  }

  if (payout.approvedBy !== null) {
    return { payout, changed: false };
  }
  if (payout.status !== 'pending_approval') {
    throw new PayoutStateError(payout.status, 'approve');
  }
  const [approved] = await db
    .update(payouts)
    .set({ approvedBy: actor.id, approvedAt: new Date(), status: 'queued', lastError: null })
    .where(
      and(
        eq(payouts.id, payout.id),
        eq(payouts.status, 'pending_approval'),
        isNull(payouts.approvedBy),
      ),
    )
    .returning();
  if (approved) {
    return { payout: approved, changed: true };
  }
  // Lost a race with another approval — report what is stored now.
  const current = await requirePayout(db, payout.id);
  if (current.approvedBy !== null) {
    return { payout: current, changed: false };
  }
  throw new PayoutStateError(current.status, 'approve');
}

/**
 * Put a `failed` payout back in the queue for another attempt (staff action). A payout
 * already `queued` is returned unchanged. Note the provider call reuses the payout id as
 * its idempotency key; confirm with the provider that the failed attempt did not settle.
 *
 * @throws {PayoutStateError} the payout is in any other status.
 */
export async function retryPayout(
  db: Database,
  payoutId: string,
): Promise<{ readonly payout: PayoutRecord; readonly changed: boolean }> {
  const payout = await requirePayout(db, payoutId);
  if (payout.status === 'queued') {
    return { payout, changed: false };
  }
  if (payout.status !== 'failed') {
    throw new PayoutStateError(payout.status, 'retry');
  }
  const [queued] = await db
    .update(payouts)
    .set({ status: 'queued', lastError: null })
    .where(and(eq(payouts.id, payout.id), eq(payouts.status, 'failed')))
    .returning();
  if (queued) {
    return { payout: queued, changed: true };
  }
  const current = await requirePayout(db, payout.id);
  if (current.status === 'queued') {
    return { payout: current, changed: false };
  }
  throw new PayoutStateError(current.status, 'retry');
}

/**
 * Ids the sweeper should re-enqueue: payouts parked on something that may have changed
 * since (a rate, float, a pending retry) — plus `awaiting_destination` ones whose
 * collector now has a verified destination. An un-approved `pending_approval` payout is
 * left for a human.
 */
export async function sweepablePayoutIds(db: Database): Promise<string[]> {
  const parked = await db
    .select({ id: payouts.id })
    .from(payouts)
    .where(inArray(payouts.status, [...SWEEPABLE]));
  const resolvable = await db
    .select({ id: payouts.id })
    .from(payouts)
    .where(
      and(
        eq(payouts.status, 'awaiting_destination'),
        sql`exists (select 1 from collector_payment_destinations d where d.collector_id = ${payouts.collectorId} and d.status = 'verified')`,
      ),
    );
  return [...parked, ...resolvable].map((row) => row.id);
}

/** Payouts waiting on a destination for one collector — enqueued when it becomes verified. */
export async function payoutIdsAwaitingDestination(
  db: Database,
  collectorId: string,
): Promise<string[]> {
  const rows = await db
    .select({ id: payouts.id })
    .from(payouts)
    .where(and(eq(payouts.collectorId, collectorId), eq(payouts.status, 'awaiting_destination')));
  return rows.map((row) => row.id);
}
