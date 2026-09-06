// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `/api/v1/sessions` (FR-8.1, FR-6.1, ROADMAP M2-5).
 *  - `GET` — scoped list: admin → all, staff → own, partner → sponsored.
 *  - `POST` — create a session — scope `session:configure` (admin only).
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse } from '@/lib/api/errors';
import { getActor, requireScope, UnauthorizedError } from '@/lib/auth/session';
import { getDb } from '@/lib/db/client';
import { createSession, createSessionInputSchema, listSessions } from '@/lib/sessions';

const listQuerySchema = z.object({
  status: z.enum(['scheduled', 'active', 'closed']).optional(),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const actor = await getActor();
    if (!actor) {
      throw new UnauthorizedError();
    }
    const { status } = listQuerySchema.parse({
      status: request.nextUrl.searchParams.get('status') ?? undefined,
    });
    const db = getDb();
    const base = status ? { status } : {};

    if (actor.role === 'admin') {
      return NextResponse.json({ sessions: await listSessions(db, base) });
    }
    if (actor.kind === 'partner') {
      return NextResponse.json({
        sessions: await listSessions(db, { ...base, sponsorPartnerId: actor.id }),
      });
    }
    // supervisor / hub_lead — only sessions they're assigned to.
    return NextResponse.json({
      sessions: await listSessions(db, { ...base, assignedSupervisorId: actor.id }),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await requireScope('session:configure');
    const input = createSessionInputSchema.parse(await request.json().catch(() => ({})));
    const session = await createSession(getDb(), input);
    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
