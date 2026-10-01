// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `GET /api/v1/payouts/:id` — one payout. Scope `payout:read`. A plain `supervisor` asking
 * for a payout of another supervisor's event gets 404, the same as for an unknown id.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse } from '@/lib/api/errors';
import { requireScope } from '@/lib/auth/session';
import { getDb } from '@/lib/db/client';
import { getPayoutView, PayoutNotFoundError } from '@/lib/payouts';

const paramsSchema = z.object({ id: z.uuid() });

type RouteParams = { readonly params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const actor = await requireScope('payout:read');
    const { id } = paramsSchema.parse(await params);

    const payout = await getPayoutView(
      getDb(),
      id,
      actor.role === 'supervisor' ? actor.id : undefined,
    );
    if (!payout) {
      throw new PayoutNotFoundError(`payout ${id}`);
    }
    return NextResponse.json({ payout });
  } catch (error) {
    return errorResponse(error);
  }
}
