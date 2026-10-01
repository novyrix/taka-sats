// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `POST /api/v1/collectors/:id/destinations/:destinationId/revoke` — revoke a
 * payout destination (D-26). Scope: `collector:authorize` (hub_lead, admin).
 * Idempotent; the collector then has no live destination until a new one is attached.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse } from '@/lib/api/errors';
import { requireScope } from '@/lib/auth/session';
import { revokeDestination, toDestinationView } from '@/lib/collectors';
import { getDb } from '@/lib/db/client';

const paramsSchema = z.object({ id: z.uuid(), destinationId: z.uuid() });

type RouteParams = { readonly params: Promise<{ id: string; destinationId: string }> };

export async function POST(_request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const actor = await requireScope('collector:authorize');

    const { id, destinationId } = paramsSchema.parse(await params);
    const destination = await revokeDestination(getDb(), {
      collectorId: id,
      destinationId,
      actor: { id: actor.id, role: actor.role },
    });
    return NextResponse.json({ destination: toDestinationView(destination) });
  } catch (error) {
    return errorResponse(error);
  }
}
