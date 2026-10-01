// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Register a collector (§7.1, FR-1.2, US-1.1). One required field: `alias`. No
 * ID, phone, DOB, address, or literacy step — the earn-first principle.
 *
 * The collector gets a server-allocated `public_code` (D-24) and passes through
 * the authorization gate (D-25): a supervisor's registration is `pending` until a
 * `hub_lead`/`admin` authorizes it; staff with `collector:authorize` register
 * straight to `active`, which is itself an auditable, ledger-anchored decision.
 * `collectors.authorization_required = false` removes the gate.
 */

import { eq, sql } from 'drizzle-orm';
import { roleHasScope } from '@/lib/auth/permissions';
import { getSettings } from '@/lib/config';
import type { Database, Tx } from '@/lib/db/client';
import { collectors } from '@/lib/db/schema';
import { recordAuthorizationDecision } from './authorization';
import { ProvisioningDisabledError } from './errors';
import { formatPublicCode } from './reference';
import {
  type CollectorActor,
  type CollectorRecord,
  type EnrolCollectorInput,
  enrolCollectorInputSchema,
} from './types';

/** The next value of the sequence behind every `public_code`. Gaps are harmless. */
async function nextCodeSeq(tx: Tx): Promise<number> {
  const rows = await tx.execute(sql`select nextval('collector_public_code_seq') as seq`);
  const seq = Number((rows[0] as { seq?: string | number } | undefined)?.seq);
  if (!Number.isSafeInteger(seq)) {
    throw new Error('enrolCollector: could not allocate a public code');
  }
  return seq;
}

/**
 * Create a `collectors` row. `addressSource` defaults to
 * `custody.default_address_source`; requesting `'provisioned'` while
 * `custody.provisioning_enabled` is false is rejected (gate G1).
 *
 * The payout destination is attached in a later step — {@link
 * import('./destinations').attachDestination} for BYO, or the M1-6 provisioning
 * job for `provisioned`. A collector with no destination yet can still be weighed
 * once authorized; payout simply waits (FR-7.4).
 *
 * Resending the same client `id` returns the original row unchanged.
 */
export async function enrolCollector(
  db: Database,
  input: EnrolCollectorInput,
  actor: CollectorActor,
): Promise<CollectorRecord> {
  const parsed = enrolCollectorInputSchema.parse(input);
  const settings = getSettings();
  const addressSource = parsed.addressSource ?? settings.custody.default_address_source;

  if (addressSource === 'provisioned' && !settings.custody.provisioning_enabled) {
    throw new ProvisioningDisabledError();
  }

  const findExisting = async (): Promise<CollectorRecord | null> => {
    if (!parsed.id) {
      return null;
    }
    const [row] = await db.select().from(collectors).where(eq(collectors.id, parsed.id));
    return row ?? null;
  };

  const prior = await findExisting();
  if (prior) {
    return prior;
  }

  const gated = settings.collectors.authorization_required;
  const authorizedByStaff = gated && roleHasScope(actor.role, 'collector:authorize');
  const active = !gated || authorizedByStaff;
  const siteCode = parsed.siteCode ?? (settings.collectors.default_site_code || undefined);

  const created = await db.transaction(async (tx) => {
    const now = new Date();
    const publicCode = formatPublicCode({
      prefix: settings.collectors.code_prefix,
      siteCode,
      seq: await nextCodeSeq(tx),
    });

    const [inserted] = await tx
      .insert(collectors)
      .values({
        ...(parsed.id ? { id: parsed.id } : {}),
        alias: parsed.alias,
        addressSource,
        enrolledAt: now,
        publicCode,
        status: active ? 'active' : 'pending',
        registeredBy: actor.id,
        ...(authorizedByStaff ? { authorizedBy: actor.id, authorizedAt: now } : {}),
      })
      .onConflictDoNothing({ target: collectors.id })
      .returning();

    if (inserted && authorizedByStaff) {
      await recordAuthorizationDecision(tx, {
        collectorId: inserted.id,
        decision: 'authorized',
        actorId: actor.id,
        decidedAt: now,
      });
    }
    return inserted ?? null;
  });
  if (created) {
    return created;
  }

  // A concurrent resend with the same client `id` won the insert — return its row.
  const raced = await findExisting();
  if (raced) {
    return raced;
  }
  throw new Error('enrolCollector: insert returned no row and no existing row was found');
}
