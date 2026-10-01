// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Resolving a payout whose outcome the provider never confirmed (it sits in `sending`).
 *
 * The engine never retries such a payout: it may already have gone out, and a retry would fetch a
 * fresh invoice and pay again. A person decides, here, from the provider's own records:
 *
 *   paid    a payment reference is recorded, the payout becomes `paid` and a `payout` ledger entry
 *           is appended (exactly what a normal settlement writes, plus the resolution row);
 *   failed  the payout becomes `failed` (nothing was sent) and a `correction` entry is appended.
 *           It is NOT re-queued: staff use the ordinary retry, which is a separate, visible act.
 *
 * Rules (each has a test): admin only; only a `sending` payout that is stale or already flagged;
 * the resolver is not the person who recorded the weigh or approved the payout (configurable for a
 * one-admin deployment); a `paid` resolution needs a reference that no other payout holds; the
 * provider's own lookup, when it can answer, may veto a resolution that contradicts it; one
 * resolution per payout attempt, so repeating the same request changes nothing and a conflicting
 * one is refused. The flag is closed in the same transaction. `checkPayout` is read only.
 *
 * Framework-free apart from Drizzle (D-04); server only.
 */

import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { type Role, roleHasScope } from '@/lib/auth/permissions';
import { getSettings } from '@/lib/config';
import type { Database } from '@/lib/db/client';
import { anomalyFlags, collectionEvents, payoutResolutions, payouts } from '@/lib/db/schema';
import { isUniqueViolation } from '@/lib/db/pg-errors';
import { appendEntryTx, payloadHash } from '@/lib/ledger';
import type { LightningProvider, PaymentLookup } from '@/lib/lightning/LightningProvider';
import { PayoutNotFoundError, PayoutResolveError, PayoutStateError } from './errors';
import { type PayoutRecord, staleCutoff } from './process';

type Lookup = Pick<LightningProvider, 'kind' | 'lookupPayment'>;

export type PayoutCheck =
  | { readonly supported: false; readonly reason: 'provider_cannot_look_up' | 'wrong_provider' }
  | { readonly supported: true; readonly lookup: PaymentLookup };

export type ResolvePayoutInput = {
  readonly payoutId: string;
  readonly actor: { readonly id: string; readonly role: Role };
  readonly outcome: 'paid' | 'failed';
  /** Provider payment hash or transaction id. Required for `paid` unless the payout already holds one. */
  readonly reference?: string | undefined;
  readonly note?: string | undefined;
};

export type ResolvePayoutResult = {
  readonly payout: PayoutRecord;
  /** False when this exact resolution had already been recorded. */
  readonly changed: boolean;
  readonly providerState: ProviderState;
};

type ProviderState = 'paid' | 'failed' | 'pending' | 'not_found' | 'unsupported' | 'error';

const REFERENCE_PATTERN = /^[\w.:-]{6,200}$/;

async function requirePayout(db: Database, payoutId: string): Promise<PayoutRecord> {
  const [row] = await db.select().from(payouts).where(eq(payouts.id, payoutId));
  if (!row) {
    throw new PayoutNotFoundError(`payout ${payoutId}`);
  }
  return row;
}

/** Ask the provider about this payout. Never throws: a failed lookup is just "no evidence". */
async function lookup(
  provider: Lookup | null,
  payout: PayoutRecord,
): Promise<{ state: ProviderState; found?: PaymentLookup }> {
  if (!provider?.lookupPayment) {
    return { state: 'unsupported' };
  }
  try {
    const found = await provider.lookupPayment({
      ...(payout.providerPaymentRef ? { paymentRef: payout.providerPaymentRef } : {}),
      idempotencyKey: payout.id,
    });
    return { state: found.state, found };
  } catch {
    return { state: 'error' };
  }
}

/**
 * Read only: what does the provider say about this payout? Evidence for the person resolving it;
 * it changes nothing. Admin only (`payout:resolve`).
 */
export async function checkPayout(
  db: Database,
  provider: Lookup | null,
  input: { readonly payoutId: string; readonly actor: { readonly role: Role } },
): Promise<PayoutCheck & { readonly payout: PayoutRecord }> {
  if (!roleHasScope(input.actor.role, 'payout:resolve')) {
    throw new PayoutResolveError('not_permitted', 'This role cannot check or resolve payouts');
  }
  const payout = await requirePayout(db, input.payoutId);
  if (!payout.attemptedAt && !payout.providerPaymentRef) {
    throw new PayoutResolveError('nothing_to_check', 'This payout was never sent to a provider');
  }
  if (!provider?.lookupPayment) {
    return { payout, supported: false, reason: 'provider_cannot_look_up' };
  }
  if (payout.provider && payout.provider !== provider.kind) {
    // The payout went out through another rail than the one configured now: asking this one is meaningless.
    return { payout, supported: false, reason: 'wrong_provider' };
  }
  // A lookup that fails here is an error to show the admin, unlike inside resolvePayout.
  const found = await provider.lookupPayment({
    ...(payout.providerPaymentRef ? { paymentRef: payout.providerPaymentRef } : {}),
    idempotencyKey: payout.id,
  });
  return { payout, supported: true, lookup: found };
}

/**
 * Record a person's decision on a stuck payout. See the module comment for the rules.
 *
 * @throws {PayoutResolveError} a rule refused it (the `reason` says which).
 * @throws {PayoutStateError} the payout is not `sending` (and was not already resolved this way).
 */
export async function resolvePayout(
  db: Database,
  provider: Lookup | null,
  input: ResolvePayoutInput,
  now: Date = new Date(),
): Promise<ResolvePayoutResult> {
  const { actor, outcome } = input;
  if (!roleHasScope(actor.role, 'payout:resolve')) {
    throw new PayoutResolveError('not_permitted', 'This role cannot resolve payouts');
  }
  const payout = await requirePayout(db, input.payoutId);

  // Idempotency: one resolution per attempt.
  const [existing] = await db
    .select()
    .from(payoutResolutions)
    .where(
      and(
        eq(payoutResolutions.payoutId, payout.id),
        eq(payoutResolutions.attempt, payout.attempts),
      ),
    );
  if (existing) {
    const sameReference =
      outcome !== 'paid' ||
      input.reference === undefined ||
      input.reference.trim() === existing.reference;
    if (existing.outcome === outcome && sameReference) {
      return { payout, changed: false, providerState: existing.providerState as ProviderState };
    }
    throw new PayoutResolveError(
      'resolution_final',
      `This payout was already resolved as ${existing.outcome}; a recorded resolution is not changed`,
    );
  }

  if (payout.status !== 'sending') {
    throw new PayoutStateError(payout.status, 'resolve');
  }

  // Only a payout that is genuinely stuck: stale, or already flagged for a human.
  const stale = payout.attemptedAt !== null && payout.attemptedAt < staleCutoff(now);
  const [flag] = await db
    .select({ id: anomalyFlags.id })
    .from(anomalyFlags)
    .where(
      and(
        eq(anomalyFlags.flagType, 'payout_uncertain'),
        isNull(anomalyFlags.reviewedAt),
        sql`${anomalyFlags.context}->>'payoutId' = ${payout.id}`,
      ),
    );
  if (!stale && !flag) {
    throw new PayoutResolveError(
      'not_resolvable',
      'The payout is still being sent: wait until it is flagged or the stale time has passed',
    );
  }

  // Separation of duties: not the person who recorded the weigh, not the approver.
  const [event] = await db
    .select({ recorder: collectionEvents.supervisorId })
    .from(collectionEvents)
    .where(eq(collectionEvents.id, payout.collectionEventId));
  if (
    getSettings().payouts.resolution_requires_distinct_actor &&
    (event?.recorder === actor.id || payout.approvedBy === actor.id)
  ) {
    throw new PayoutResolveError(
      'self_resolution',
      'The person who recorded the weigh or approved the payout cannot resolve it',
    );
  }

  // The reference that proves a `paid` resolution.
  let reference: string | null = null;
  if (outcome === 'paid') {
    reference = (input.reference ?? payout.providerPaymentRef ?? '').trim() || null;
    if (!reference) {
      throw new PayoutResolveError(
        'reference_required',
        'A paid resolution needs the provider payment reference (payment hash or transaction id)',
      );
    }
    if (!REFERENCE_PATTERN.test(reference)) {
      throw new PayoutResolveError(
        'reference_required',
        'The reference must be 6 to 200 letters, digits or . : _ - characters',
      );
    }
    if (payout.providerPaymentRef && payout.providerPaymentRef !== reference) {
      throw new PayoutResolveError(
        'reference_mismatch',
        'The payout was sent with a different payment reference than the one given',
      );
    }
    const [used] = await db
      .select({ id: payouts.id })
      .from(payouts)
      .where(and(eq(payouts.providerPaymentRef, reference), ne(payouts.id, payout.id)))
      .limit(1);
    if (used) {
      throw new PayoutResolveError(
        'reference_in_use',
        'Another payout already holds that payment reference',
      );
    }
  }

  // The provider's own records may veto a decision that contradicts them.
  const { state: providerState, found } = await lookup(
    provider && (!payout.provider || payout.provider === provider.kind) ? provider : null,
    payout,
  );
  if (outcome === 'failed' && (providerState === 'paid' || providerState === 'pending')) {
    // A "paid" the provider shows for a hash another payout already holds is a duplicate invoice,
    // not evidence about THIS payout.
    let evidence = true;
    if (providerState === 'paid' && found?.paymentRef) {
      const [other] = await db
        .select({ id: payouts.id })
        .from(payouts)
        .where(and(eq(payouts.providerPaymentRef, found.paymentRef), ne(payouts.id, payout.id)))
        .limit(1);
      evidence = !other;
    }
    if (evidence) {
      throw new PayoutResolveError(
        'provider_disagrees',
        `The provider reports this payment as ${providerState}, so it cannot be resolved as failed`,
      );
    }
  }
  if (outcome === 'paid' && providerState === 'failed') {
    throw new PayoutResolveError(
      'provider_disagrees',
      'The provider reports this payment as failed, so it cannot be resolved as paid',
    );
  }

  const note = input.note?.trim() ? input.note.trim().slice(0, 500) : null;

  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${payout.id}, 1))`);
      const [current] = await tx.select().from(payouts).where(eq(payouts.id, payout.id));
      if (!current || current.status !== 'sending' || current.attempts !== payout.attempts) {
        // Lost a race with another resolution or a settlement: report what is stored now.
        throw new PayoutStateError(current?.status ?? 'unknown', 'resolve');
      }

      const settledAt = now;
      const entry =
        outcome === 'paid'
          ? await appendEntryTx(tx, {
              entryType: 'payout',
              payloadHash: await payloadHash({
                payoutId: payout.id,
                collectionEventId: payout.collectionEventId,
                amountSats: payout.amountSats,
                amountFiatMinor: payout.amountFiatMinor,
                exchangeSnapshotId: payout.exchangeSnapshotId,
                provider: payout.provider,
                paymentRef: reference,
                settledAt: settledAt.toISOString(),
                resolution: 'manual',
                resolvedBy: actor.id,
              }),
            })
          : await appendEntryTx(tx, {
              entryType: 'correction',
              payloadHash: await payloadHash({
                kind: 'payout_resolution',
                payoutId: payout.id,
                collectionEventId: payout.collectionEventId,
                outcome: 'failed',
                attempt: payout.attempts,
                resolvedBy: actor.id,
              }),
            });

      await tx.insert(payoutResolutions).values({
        payoutId: payout.id,
        attempt: payout.attempts,
        outcome,
        reference,
        note,
        providerState,
        resolvedBy: actor.id,
        resolvedAt: now,
        ledgerEntryId: entry.id,
      });

      const [updated] = await tx
        .update(payouts)
        .set(
          outcome === 'paid'
            ? {
                status: 'paid',
                providerPaymentRef: reference,
                settledAt,
                ledgerEntryId: entry.id,
                lastError: null,
              }
            : { status: 'failed', lastError: 'resolved_failed' },
        )
        .where(and(eq(payouts.id, payout.id), eq(payouts.status, 'sending')))
        .returning();
      if (!updated) {
        throw new PayoutStateError('unknown', 'resolve');
      }

      // Close the flag in the same transaction: the uncertainty is over.
      await tx
        .update(anomalyFlags)
        .set({
          reviewedBy: actor.id,
          reviewedAt: now,
          reviewOutcome: 'confirmed',
          reviewNote: `resolved as ${outcome}`,
        })
        .where(
          and(
            eq(anomalyFlags.flagType, 'payout_uncertain'),
            isNull(anomalyFlags.reviewedAt),
            sql`${anomalyFlags.context}->>'payoutId' = ${payout.id}`,
          ),
        );

      console.info(
        '[payouts]',
        JSON.stringify({ payoutId: payout.id, resolved: outcome, providerState }),
      );
      return { payout: updated, changed: true, providerState };
    });
  } catch (error) {
    // A concurrent identical request may have won: answer with its result instead of an error.
    const [raced] = await db
      .select()
      .from(payoutResolutions)
      .where(
        and(
          eq(payoutResolutions.payoutId, payout.id),
          eq(payoutResolutions.attempt, payout.attempts),
        ),
      );
    if (raced && raced.outcome === outcome) {
      return {
        payout: await requirePayout(db, payout.id),
        changed: false,
        providerState: raced.providerState as ProviderState,
      };
    }
    if (raced) {
      throw new PayoutResolveError(
        'resolution_final',
        `This payout was already resolved as ${raced.outcome}; a recorded resolution is not changed`,
      );
    }
    if (isUniqueViolation(error)) {
      // Two payouts raced to claim one payment reference; the database let only one win.
      throw new PayoutResolveError(
        'reference_in_use',
        'Another payout already holds that payment reference',
      );
    }
    throw error;
  }
}
