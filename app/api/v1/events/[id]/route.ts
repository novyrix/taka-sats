// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `GET /api/v1/events/:id` - one collection event with its verification picture (the "how do we
 * know" view): collector authorization, session window, rate in force, photo, GPS against the
 * session boundary, anomaly flags, payout and ledger anchor. Scope `collector:read`. A plain
 * `supervisor` can open only events they recorded (anything else is a 404) and gets no
 * coordinates; `hub_lead`/`admin` see everything.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse } from '@/lib/api/errors';
import { requireScope } from '@/lib/auth/session';
import { getEventDetail } from '@/lib/collection-events/detail';
import { getDb } from '@/lib/db/client';

const paramsSchema = z.object({ id: z.uuid() });

type RouteParams = { readonly params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const actor = await requireScope('collector:read');
    const { id } = paramsSchema.parse(await params);
    const isPlainSupervisor = actor.role === 'supervisor';
    const event = await getEventDetail(getDb(), id, {
      recordedBy: isPlainSupervisor ? actor.id : undefined,
      includeGeo: !isPlainSupervisor,
    });
    return NextResponse.json({ event });
  } catch (error) {
    return errorResponse(error);
  }
}
