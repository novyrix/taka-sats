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
import {
  CollectorNotFoundError,
  ProvisioningDisabledError,
  TagAlreadyActiveError,
} from '@/lib/collectors';
import { ForbiddenError, UnauthorizedError } from '@/lib/auth/session';

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
  if (error instanceof CollectorNotFoundError) {
    return json(404, 'not_found', error.message);
  }
  if (error instanceof TagAlreadyActiveError) {
    return json(409, 'conflict', error.message);
  }
  if (error instanceof ProvisioningDisabledError) {
    return json(403, 'forbidden', error.message);
  }

  console.error('[api] unhandled error', error instanceof Error ? error.name : typeof error);
  return json(500, 'internal_error', 'Internal error');
}
