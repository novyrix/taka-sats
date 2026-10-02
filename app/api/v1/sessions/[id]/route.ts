// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `/api/v1/sessions/:id`.
 *  - `GET` one session (with its assigned supervisor ids). A staff member
 *    may only read a session they are assigned to; admin reads any.
 *  - `PATCH` — scope `session:configure` (admin only).
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse } from '@/lib/api/errors';
import { ForbiddenError, getActor, requireScope, UnauthorizedError } from '@/lib/auth/session';
import { getDb } from '@/lib/db/client';
import { getSession, patchSession, patchSessionInputSchema } from '@/lib/sessions';

const paramsSchema = z.object({ id: z.uuid() });
type RouteParams = { readonly params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const actor = await getActor();
    if (!actor) {
      throw new UnauthorizedError();
    }
    const { id } = paramsSchema.parse(await params);

    const session = await getSession(getDb(), id);
    if (!session) {
      return NextResponse.json(
        { error: { code: 'not_found', message: `Session not found: ${id}` } },
        { status: 404 },
      );
    }

    const visible =
      actor.role === 'admin' ||
      (actor.kind === 'partner'
        ? session.sponsorPartnerId === actor.id
        : session.supervisorIds.includes(actor.id));
    if (!visible) {
      throw new ForbiddenError('session:read');
    }

    return NextResponse.json({ session });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    await requireScope('session:configure');
    const { id } = paramsSchema.parse(await params);
    const patch = patchSessionInputSchema.parse(await request.json().catch(() => ({})));

    const session = await patchSession(getDb(), id, patch);
    if (!session) {
      return NextResponse.json(
        { error: { code: 'not_found', message: `Session not found: ${id}` } },
        { status: 404 },
      );
    }
    return NextResponse.json({ session });
  } catch (error) {
    return errorResponse(error);
  }
}
