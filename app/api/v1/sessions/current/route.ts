// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `/api/v1/sessions/current` (FR-6.1). The session the caller
 * may act in **right now** — assigned, `status='active'`, `now` within the
 * window — or `{ session: null }`. The PWA polls this to gate weigh/enrol.
 * Staff only; a `partner` does not "act" and gets 403.
 */

import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/api/errors';
import { ForbiddenError, getActor, UnauthorizedError } from '@/lib/auth/session';
import { getDb } from '@/lib/db/client';
import { currentSessionForSupervisor } from '@/lib/sessions';

export async function GET(): Promise<NextResponse> {
  try {
    const actor = await getActor();
    if (!actor) {
      throw new UnauthorizedError();
    }
    if (actor.kind === 'partner') {
      throw new ForbiddenError('session:read');
    }
    const session = await currentSessionForSupervisor(getDb(), actor.id);
    return NextResponse.json({ session });
  } catch (error) {
    return errorResponse(error);
  }
}
