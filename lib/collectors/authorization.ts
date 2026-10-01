// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The collector authorization gate (D-25, ADR-0017). A collector is `pending`
 * (registered, not vetted), `active` (= authorized: may be weighed, tagged and
 * paid) or `revoked`. Every decision is written in ONE transaction as a
 * `collector_authorizations` row anchored by a `collector_authorization`
 * ledger entry, so who authorized whom is tamper-evident and queryable.
 *
 * Idempotent: deciding a state the collector is already in changes nothing and
 * writes nothing. The route requires `collector:authorize`.
 */

import { eq } from 'drizzle-orm';
import type { Database, Tx } from '@/lib/db/client';
import { collectorAuthorizations, collectors } from '@/lib/db/schema';
import { appendEntryTx, payloadHash } from '@/lib/ledger';
import { CollectorNotFoundError } from './errors';
import type { AuthorizationDecisionInput, CollectorActor, CollectorRecord } from './types';

export type AuthorizationOutcome = {
  readonly collector: CollectorRecord;
  /** False when the collector was already in the requested state (nothing was written). */
  readonly changed: boolean;
};

type RecordedDecision = {
  readonly collectorId: string;
  readonly decision: 'authorized' | 'revoked';
  readonly actorId: string;
  readonly reason?: string | undefined;
  readonly decidedAt: Date;
};

/**
 * Append the ledger anchor + the audit row for one decision, inside the caller's
 * transaction. Also used by enrolment when staff register a collector pre-authorized.
 */
export async function recordAuthorizationDecision(tx: Tx, input: RecordedDecision): Promise<void> {
  const hash = await payloadHash({
    type: 'collector_authorization',
    collectorId: input.collectorId,
    decision: input.decision,
    decidedBy: input.actorId,
    reason: input.reason ?? null,
    decidedAt: input.decidedAt.toISOString(),
  });
  const entry = await appendEntryTx(tx, {
    entryType: 'collector_authorization',
    payloadHash: hash,
  });
  await tx.insert(collectorAuthorizations).values({
    collectorId: input.collectorId,
    decision: input.decision,
    decidedBy: input.actorId,
    reason: input.reason ?? null,
    ledgerEntryId: entry.id,
    decidedAt: input.decidedAt,
  });
}

export async function decideCollectorAuthorization(
  db: Database,
  input: {
    readonly collectorId: string;
    readonly decision: AuthorizationDecisionInput;
    readonly reason?: string | undefined;
    readonly actor: CollectorActor;
  },
): Promise<AuthorizationOutcome> {
  const authorize = input.decision === 'authorize';
  const target = authorize ? 'active' : 'revoked';

  return db.transaction(async (tx) => {
    // NO KEY UPDATE, not UPDATE: ingest takes the ledger lock and then a KEY SHARE lock on the
    // collector (its foreign key). A plain UPDATE lock here — followed by the ledger lock inside
    // recordAuthorizationDecision — would deadlock against it; NO KEY UPDATE does not conflict
    // with KEY SHARE, so the two always order collector → ledger or not at all.
    const [collector] = await tx
      .select()
      .from(collectors)
      .where(eq(collectors.id, input.collectorId))
      .for('no key update');
    if (!collector) {
      throw new CollectorNotFoundError(input.collectorId);
    }
    if (collector.status === target) {
      return { collector, changed: false };
    }

    const decidedAt = new Date();
    await recordAuthorizationDecision(tx, {
      collectorId: collector.id,
      decision: authorize ? 'authorized' : 'revoked',
      actorId: input.actor.id,
      reason: input.reason,
      decidedAt,
    });

    const [updated] = await tx
      .update(collectors)
      .set(
        authorize
          ? { status: 'active', authorizedBy: input.actor.id, authorizedAt: decidedAt }
          : { status: 'revoked' },
      )
      .where(eq(collectors.id, collector.id))
      .returning();
    if (!updated) {
      throw new Error('decideCollectorAuthorization: update returned no row');
    }
    return { collector: updated, changed: true };
  });
}
