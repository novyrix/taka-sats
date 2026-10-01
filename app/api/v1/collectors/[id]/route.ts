// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `GET /api/v1/collectors/:id` (§7.1, M1-4).
 * Scope: `collector:read` (supervisor, hub_lead, admin).
 * Returns the collector and its live payout destination (or `null`). The wallet ADDRESS is
 * shown only to staff and to the supervisor who registered the collector (others get
 * `address: null`, plus the status and provider label).
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse } from '@/lib/api/errors';
import { requireScope } from '@/lib/auth/session';
import {
  canSeeAddress,
  CollectorNotFoundError,
  findCollectorById,
  getLiveDestination,
  toCollectorView,
  toDestinationView,
} from '@/lib/collectors';
import { getDb } from '@/lib/db/client';

const paramsSchema = z.object({ id: z.uuid() });

type RouteParams = { readonly params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const actor = await requireScope('collector:read');

    const { id } = paramsSchema.parse(await params);
    const db = getDb();
    const collector = await findCollectorById(db, id);
    if (!collector) {
      throw new CollectorNotFoundError(id);
    }

    const withAddress = canSeeAddress({ id: actor.id, role: actor.role }, collector);
    const destination = await getLiveDestination(db, id);
    return NextResponse.json({
      collector: toCollectorView(collector, { withAddress }),
      destination: destination ? toDestinationView(destination, { withAddress }) : null,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
