// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A collector's payout destination (D-26, ADR-0018). The scanned code is
 * normalised, then resolved receive-capable by the active `LightningProvider`
 * BEFORE anything is written — a withdraw code, a spend link (a wallet card's
 * Pay QR) or an unsafe target is rejected there, and the payload is never stored.
 *
 * A collector has at most one *live* destination (`pending_validation` |
 * `verified`); replacing a verified one needs `collector:authorize` and revokes
 * the old one in the same transaction. An address can be live for only one
 * collector at a time. A wallet that is merely unreachable right now stores the
 * destination `pending_validation`; the worker re-checks it later. A payout only
 * ever uses a `verified` destination, resolved server-side.
 */

import { and, desc, eq, inArray } from 'drizzle-orm';
import { roleHasScope } from '@/lib/auth/permissions';
import { getSettings } from '@/lib/config';
import type { Database, Queryable } from '@/lib/db/client';
import { isUniqueViolation } from '@/lib/db/pg-errors';
import { collectorPaymentDestinations, collectors } from '@/lib/db/schema';
import {
  InvalidLightningAddressError,
  LightningEndpointUnreachableError,
  NotReceiveCapableError,
  SpendCredentialRejectedError,
  UnsafeLnurlTargetError,
} from '@/lib/lightning/errors';
import type { LightningProvider } from '@/lib/lightning/LightningProvider';
import { decodeLnurlBech32, isLightningAddress, isLnurlBech32 } from '@/lib/lightning/lnurl';
import {
  CollectorNotAuthorizedError,
  CollectorNotFoundError,
  CollectorNotYoursError,
  DestinationInUseError,
  DestinationNotFoundError,
  DestinationReplaceForbiddenError,
} from './errors';
import {
  type AttachDestinationInput,
  attachDestinationInputSchema,
  type CollectorActor,
  type CollectorRecord,
  type DestinationRecord,
} from './types';

const LIVE = ['pending_validation', 'verified'] as const;

type DestinationType = DestinationRecord['type'];

/**
 * One wallet, one string. The same wallet can be written as a Lightning Address, as the
 * LUD-16 `https://host/.well-known/lnurlp/<name>` URL, or as the bech32 `lnurl1…` of that URL;
 * all three collapse to `<name>@<host>` so the one-wallet-per-collector rule (a unique live
 * address) cannot be dodged by changing the spelling. Other LNURL-pay URLs are kept as their
 * normalised `https` URL (lower-cased host, no default port, no trailing slash).
 */
function canonicalFromUrl(url: string): { type: DestinationType; address: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new InvalidLightningAddressError('Unrecognised payment code');
  }
  // A query string or fragment can be varied endlessly without changing which wallet answers,
  // which would defeat the one-wallet-per-collector rule — so such URLs are not accepted.
  // (Wallets that matter publish a plain Lightning Address.)
  if (parsed.search || parsed.hash) {
    throw new InvalidLightningAddressError(
      'LNURL codes with a query string are not supported — use the wallet’s Lightning Address',
    );
  }
  const path = parsed.pathname.replace(/\/+$/, '');
  const wellKnown = /^\/\.well-known\/lnurlp\/([^/]+)$/.exec(path);
  if (wellKnown?.[1] && parsed.protocol === 'https:' && parsed.port === '') {
    let user: string | undefined;
    try {
      user = decodeURIComponent(wellKnown[1]).toLowerCase();
    } catch {
      user = undefined;
    }
    const address = user ? `${user}@${parsed.hostname}` : '';
    if (isLightningAddress(address)) {
      return { type: 'lightning_address', address };
    }
  }
  return { type: 'lnurl_pay', address: `${parsed.origin}${path}` };
}

/** Syntactic normalisation only — the provider decides whether the code is actually safe to accept. */
export function normalizeDestination(raw: string): { type: DestinationType; address: string } {
  const code = raw.trim().replace(/^lightning:/i, '');
  if (isLightningAddress(code)) {
    return { type: 'lightning_address', address: code.toLowerCase() };
  }
  if (isLnurlBech32(code)) {
    return canonicalFromUrl(decodeLnurlBech32(code));
  }
  if (/^https:\/\//i.test(code)) {
    return canonicalFromUrl(code);
  }
  throw new InvalidLightningAddressError(
    'Unrecognised payment code — expected a Lightning Address or an LNURL-pay code',
  );
}

/** A display label for the wallet provider behind an address, from `lightning.provider_hints`. */
export function providerHintFor(
  address: string,
  hints: Readonly<Record<string, string>> = getSettings().lightning.provider_hints,
): string | null {
  const at = address.lastIndexOf('@');
  if (at < 0) {
    return null;
  }
  const domain = address.slice(at + 1).toLowerCase();
  for (const [host, label] of Object.entries(hints)) {
    const h = host.toLowerCase();
    if (domain === h || domain.endsWith(`.${h}`)) {
      return label;
    }
  }
  return null;
}

/** The short machine code stored when validation fails definitively (never a payload). */
export function validationErrorCode(error: unknown): string {
  if (error instanceof SpendCredentialRejectedError) {
    return 'spend_credential_rejected';
  }
  if (error instanceof NotReceiveCapableError) {
    return 'not_receive_capable';
  }
  if (error instanceof UnsafeLnurlTargetError) {
    return 'unsafe_target';
  }
  return 'invalid_lightning_address';
}

export type AttachDestinationResult = {
  readonly destination: DestinationRecord;
  readonly collector: CollectorRecord;
  /** True when the wallet could not be reached; the worker will re-check it. */
  readonly needsValidation: boolean;
};

export async function getLiveDestination(
  db: Database,
  collectorId: string,
): Promise<DestinationRecord | null> {
  const [row] = await db
    .select()
    .from(collectorPaymentDestinations)
    .where(
      and(
        eq(collectorPaymentDestinations.collectorId, collectorId),
        inArray(collectorPaymentDestinations.status, [...LIVE]),
      ),
    );
  return row ?? null;
}

/** Every destination a collector has had, newest first — the audit trail. */
export async function listDestinations(
  db: Database,
  collectorId: string,
): Promise<DestinationRecord[]> {
  return db
    .select()
    .from(collectorPaymentDestinations)
    .where(eq(collectorPaymentDestinations.collectorId, collectorId))
    .orderBy(desc(collectorPaymentDestinations.createdAt));
}

/**
 * Who may write a collector's destination (D-26). Staff (`collector:authorize`) always may. A
 * supervisor may only for a collector THEY registered, and only until authorization: once the
 * collector is `active` the wallet is what staff vouched for, so a supervisor can neither swap
 * it nor — if it was missing or unverified — slip one in afterwards.
 */
function assertMayWrite(
  collector: Pick<CollectorRecord, 'registeredBy' | 'status'>,
  live: Pick<DestinationRecord, 'status'> | null,
  actor: CollectorActor,
  isStaff: boolean,
): void {
  if (isStaff) {
    return;
  }
  if (collector.registeredBy !== actor.id) {
    throw new CollectorNotYoursError();
  }
  if (live && (live.status === 'verified' || collector.status === 'active')) {
    throw new DestinationReplaceForbiddenError();
  }
}

/**
 * Attach (or replace) a collector's payout destination.
 * @throws {CollectorNotFoundError}
 * @throws {CollectorNotAuthorizedError} the collector is revoked.
 * @throws {DestinationReplaceForbiddenError} replacing a verified destination without `collector:authorize`.
 * @throws {DestinationInUseError} the address is live for another collector.
 * @throws the provider's `InvalidLightningAddressError` / `NotReceiveCapableError` /
 *   `SpendCredentialRejectedError` / `UnsafeLnurlTargetError` — nothing is written.
 */
export async function attachDestination(
  db: Database,
  provider: Pick<LightningProvider, 'resolveReceiveAddress'>,
  input: AttachDestinationInput,
  actor: CollectorActor,
): Promise<AttachDestinationResult> {
  const parsed = attachDestinationInputSchema.parse(input);
  const { type, address } = normalizeDestination(parsed.rawCode);
  const canReplace = roleHasScope(actor.role, 'collector:authorize');

  // Cheap checks first — before any network call.
  const [collector] = await db
    .select()
    .from(collectors)
    .where(eq(collectors.id, parsed.collectorId));
  if (!collector) {
    throw new CollectorNotFoundError(parsed.collectorId);
  }
  if (collector.status === 'revoked') {
    throw new CollectorNotAuthorizedError(collector.id, collector.status);
  }
  const live = await getLiveDestination(db, collector.id);
  if (live?.address === address && (canReplace || collector.registeredBy === actor.id)) {
    return { destination: live, collector, needsValidation: live.status === 'pending_validation' };
  }
  assertMayWrite(collector, live, actor, canReplace);

  // Resolve against the wallet provider. Only "unreachable" is tolerated.
  let status: 'verified' | 'pending_validation' = 'verified';
  try {
    await provider.resolveReceiveAddress(address);
  } catch (error) {
    if (!(error instanceof LightningEndpointUnreachableError)) {
      throw error;
    }
    status = 'pending_validation';
  }

  try {
    return await db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(collectors)
        .where(eq(collectors.id, collector.id))
        .for('no key update');
      if (!locked || locked.status === 'revoked') {
        throw new CollectorNotAuthorizedError(collector.id, locked?.status ?? 'missing');
      }

      const [current] = await tx
        .select()
        .from(collectorPaymentDestinations)
        .where(
          and(
            eq(collectorPaymentDestinations.collectorId, collector.id),
            inArray(collectorPaymentDestinations.status, [...LIVE]),
          ),
        );
      assertMayWrite(locked, current ?? null, actor, canReplace);
      if (current?.address === address) {
        return {
          destination: current,
          collector: locked,
          needsValidation: current.status === 'pending_validation',
        };
      }

      const now = new Date();
      if (current) {
        await tx
          .update(collectorPaymentDestinations)
          .set({ status: 'revoked', revokedAt: now, revokedBy: actor.id })
          .where(eq(collectorPaymentDestinations.id, current.id));
      }

      const [destination] = await tx
        .insert(collectorPaymentDestinations)
        .values({
          collectorId: collector.id,
          type,
          address,
          providerHint: providerHintFor(address),
          status,
          verifiedAt: status === 'verified' ? now : null,
          createdBy: actor.id,
        })
        .returning();
      // The denormalised copy of the live destination (same pattern as `nfc_tag_id`).
      const [updated] = await tx
        .update(collectors)
        .set({
          addressSource: 'byo',
          lightningAddress: type === 'lightning_address' ? address : null,
          lnurlPayRaw: address,
        })
        .where(eq(collectors.id, collector.id))
        .returning();
      if (!destination || !updated) {
        throw new Error('attachDestination: write returned no row');
      }
      return { destination, collector: updated, needsValidation: status === 'pending_validation' };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new DestinationInUseError();
    }
    throw error;
  }
}

/** Revoke a destination (idempotent). Staff-only at the route (`collector:authorize`). */
export async function revokeDestination(
  db: Database,
  input: {
    readonly collectorId: string;
    readonly destinationId: string;
    readonly actor: CollectorActor;
  },
): Promise<DestinationRecord> {
  return db.transaction(async (tx) => {
    const [destination] = await tx
      .select()
      .from(collectorPaymentDestinations)
      .where(
        and(
          eq(collectorPaymentDestinations.id, input.destinationId),
          eq(collectorPaymentDestinations.collectorId, input.collectorId),
        ),
      );
    if (!destination) {
      throw new DestinationNotFoundError(input.destinationId);
    }
    if (destination.status === 'revoked') {
      return destination;
    }

    const [revoked] = await tx
      .update(collectorPaymentDestinations)
      .set({ status: 'revoked', revokedAt: new Date(), revokedBy: input.actor.id })
      .where(eq(collectorPaymentDestinations.id, destination.id))
      .returning();
    await clearDenormalisedAddress(tx, destination);
    return revoked ?? destination;
  });
}

async function clearDenormalisedAddress(
  tx: Queryable,
  destination: DestinationRecord,
): Promise<void> {
  await tx
    .update(collectors)
    .set({ lightningAddress: null, lnurlPayRaw: null })
    .where(
      and(
        eq(collectors.id, destination.collectorId),
        eq(collectors.lnurlPayRaw, destination.address),
      ),
    );
}

/**
 * The worker's re-check of a `pending_validation` destination. Resolves it:
 * `verified` on success, `invalid` (with a machine code) on a definitive failure.
 * An unreachable wallet rethrows so pg-boss retries. A no-op for any other state.
 */
export async function completeDestinationValidation(
  db: Database,
  provider: Pick<LightningProvider, 'resolveReceiveAddress'>,
  destinationId: string,
): Promise<DestinationRecord['status'] | null> {
  const [destination] = await db
    .select()
    .from(collectorPaymentDestinations)
    .where(eq(collectorPaymentDestinations.id, destinationId));
  if (!destination) {
    return null;
  }
  if (destination.status !== 'pending_validation') {
    return destination.status;
  }

  try {
    await provider.resolveReceiveAddress(destination.address);
  } catch (error) {
    if (error instanceof LightningEndpointUnreachableError) {
      throw error;
    }
    await db.transaction(async (tx) => {
      await tx
        .update(collectorPaymentDestinations)
        .set({ status: 'invalid', validationError: validationErrorCode(error) })
        .where(
          and(
            eq(collectorPaymentDestinations.id, destination.id),
            eq(collectorPaymentDestinations.status, 'pending_validation'),
          ),
        );
      await clearDenormalisedAddress(tx, destination);
    });
    return 'invalid';
  }

  await db
    .update(collectorPaymentDestinations)
    .set({ status: 'verified', verifiedAt: new Date(), validationError: null })
    .where(
      and(
        eq(collectorPaymentDestinations.id, destination.id),
        eq(collectorPaymentDestinations.status, 'pending_validation'),
      ),
    );
  return 'verified';
}
