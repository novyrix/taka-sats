// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Central error → HTTP response mapping for `/api/v1` route handlers
 * (REQUIREMENTS §10.1: `{ error: { code, message, details? } }`, never a bare
 * string; HTTP status matches the class). One place to map a domain error to
 * a response so every route handler's `catch` block is one line.
 *
 * Not framework-free by design (`NextResponse`) — this is the route layer's
 * shared helper, not one of D-04's framework-free `lib/` subpackages.
 */

import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { ForbiddenError, UnauthorizedError } from '@/lib/auth/session';
import {
  CollectorNotAuthorizedError,
  CollectorNotFoundError,
  CollectorNotYoursError,
  DestinationInUseError,
  DestinationNotFoundError,
  DestinationReplaceForbiddenError,
  ProvisioningDisabledError,
  TagAlreadyActiveError,
  TagRevokedError,
} from '@/lib/collectors';
import { AnomalyNotFoundError, AnomalyReviewError } from '@/lib/fraud';
import { LedgerKeyError } from '@/lib/ledger/signing';
import {
  InvalidLightningAddressError,
  LightningEndpointUnreachableError,
  NotReceiveCapableError,
  SpendCredentialRejectedError,
  UnsafeLnurlTargetError,
} from '@/lib/lightning/errors';
import { ExchangeFeedError, StaleRateError } from '@/lib/money/rates';
import { CursorError } from '@/lib/pagination';
import {
  PayoutApprovalError,
  PayoutCursorError,
  PayoutNotFoundError,
  PayoutResolveError,
  PayoutStateError,
} from '@/lib/payouts';
import { RateError } from '@/lib/rates';
import { RotationError } from '@/lib/rotations';
import {
  TopupApprovalError,
  TopupCapError,
  TopupConflictError,
  TopupFloatUnavailableError,
  TopupInputError,
  TopupNotFoundError,
  TopupStateError,
} from '@/lib/treasury/errors';
import { NoActiveSessionError, SessionError } from '@/lib/sessions';
import { FakeProviderForbiddenError } from '@/lib/lightning';
import { StorageConfigError } from '@/lib/storage';

export type ApiErrorBody = {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: unknown;
  };
};

function json(
  status: number,
  code: string,
  message: string,
  details?: unknown,
): NextResponse<ApiErrorBody> {
  return NextResponse.json(
    { error: { code, message, ...(details !== undefined && { details }) } },
    { status },
  );
}

/**
 * Map a thrown error to an HTTP response. Falls back to a safe, generic 500
 * — the underlying error is logged with its type only, never its full
 * payload (Code Style Guide §9.6: no full domain object in a log line).
 */
export function errorResponse(error: unknown): NextResponse<ApiErrorBody> {
  if (error instanceof UnauthorizedError) {
    return json(401, 'unauthorized', error.message);
  }
  if (error instanceof ForbiddenError) {
    return json(403, 'forbidden', error.message);
  }
  if (error instanceof ZodError) {
    return json(400, 'invalid_request', 'Request validation failed', error.issues);
  }
  if (error instanceof CollectorNotFoundError || error instanceof DestinationNotFoundError) {
    return json(404, 'not_found', error.message);
  }
  if (error instanceof CollectorNotAuthorizedError) {
    return json(409, 'collector_not_authorized', error.message, { status: error.status });
  }
  if (error instanceof DestinationInUseError) {
    return json(409, 'destination_in_use', error.message);
  }
  if (error instanceof CollectorNotYoursError) {
    return json(403, 'not_your_collector', error.message);
  }
  if (error instanceof DestinationReplaceForbiddenError) {
    return json(403, 'destination_replace_forbidden', error.message);
  }
  if (error instanceof TagAlreadyActiveError) {
    return json(409, 'conflict', error.message);
  }
  if (error instanceof TagRevokedError) {
    return json(410, 'tag_revoked', error.message);
  }
  if (error instanceof ProvisioningDisabledError) {
    return json(403, 'forbidden', error.message);
  }
  // Most specific first: every one of these is also an InvalidLightningAddress/NotReceiveCapable.
  if (error instanceof SpendCredentialRejectedError) {
    return json(422, 'spend_credential_rejected', error.message);
  }
  if (error instanceof NotReceiveCapableError) {
    return json(422, 'not_receive_capable', error.message);
  }
  if (error instanceof UnsafeLnurlTargetError) {
    return json(422, 'unsafe_lnurl_target', error.message);
  }
  if (error instanceof LightningEndpointUnreachableError) {
    return json(502, 'lightning_endpoint_unreachable', error.message);
  }
  if (error instanceof InvalidLightningAddressError) {
    return json(422, 'invalid_lightning_address', error.message);
  }
  if (
    error instanceof RateError ||
    error instanceof SessionError ||
    error instanceof RotationError
  ) {
    return json(422, 'unprocessable', error.message);
  }
  if (error instanceof NoActiveSessionError) {
    return json(403, 'no_active_session', error.message);
  }
  if (error instanceof LedgerKeyError) {
    return json(503, 'ledger_key_invalid', error.message);
  }
  if (error instanceof FakeProviderForbiddenError) {
    // A deployment misconfiguration, not a bug: say so instead of an opaque 500.
    return json(503, 'provider_misconfigured', error.message);
  }
  if (error instanceof StorageConfigError) {
    return json(503, 'storage_unconfigured', error.message);
  }
  if (error instanceof StaleRateError) {
    return json(503, 'stale_exchange_rate', error.message);
  }
  if (error instanceof ExchangeFeedError) {
    return json(502, 'exchange_feed_error', error.message);
  }
  if (error instanceof PayoutNotFoundError) {
    return json(404, 'not_found', error.message);
  }
  if (error instanceof PayoutStateError) {
    return json(409, 'invalid_state', error.message, { status: error.status });
  }
  if (error instanceof PayoutResolveError) {
    switch (error.reason) {
      case 'not_permitted':
        return json(403, 'forbidden', error.message);
      case 'self_resolution':
        return json(403, 'self_resolution', error.message);
      case 'reference_required':
        return json(400, 'invalid_request', error.message);
      case 'nothing_to_check':
        return json(409, 'invalid_state', error.message);
      default:
        // not_resolvable | reference_in_use | reference_mismatch | provider_disagrees | resolution_final
        return json(409, error.reason, error.message);
    }
  }
  if (error instanceof PayoutApprovalError) {
    return error.reason === 'self_approval'
      ? json(403, 'self_approval', error.message)
      : json(403, 'forbidden', error.message);
  }
  if (error instanceof TopupNotFoundError) {
    return json(404, 'not_found', error.message);
  }
  if (error instanceof TopupStateError) {
    return json(409, 'invalid_state', error.message, { status: error.status });
  }
  if (error instanceof TopupApprovalError) {
    return error.reason === 'self_approval'
      ? json(403, 'self_approval', error.message)
      : json(403, 'forbidden', error.message);
  }
  if (error instanceof TopupInputError) {
    return json(400, 'invalid_request', error.message);
  }
  if (error instanceof TopupCapError) {
    return json(422, 'hot_wallet_cap_exceeded', error.message, {
      capSats: error.capSats,
      headroomSats: error.headroomSats,
    });
  }
  if (error instanceof TopupFloatUnavailableError) {
    // Same code as GET /treasury/float; the rail's own message is never passed on.
    return json(503, 'float_unavailable', error.message);
  }
  if (error instanceof TopupConflictError) {
    return json(409, 'conflict', error.message);
  }
  if (error instanceof PayoutCursorError || error instanceof CursorError) {
    return json(400, 'invalid_cursor', error.message);
  }
  if (error instanceof AnomalyNotFoundError) {
    return json(404, 'not_found', error.message);
  }
  if (error instanceof AnomalyReviewError) {
    return json(409, 'review_final', error.message);
  }

  console.error('[api] unhandled error', error instanceof Error ? error.name : typeof error);
  return json(500, 'internal_error', 'Internal error');
}
