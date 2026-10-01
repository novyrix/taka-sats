// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `POST /api/v1/payouts/:id/retry` — put a `failed` payout back in the queue (staff
 * action). Scope `payout:approve` (`hub_lead`, `admin`). No body. 409 `invalid_state` for
 * any status other than `failed`; a payout already `queued` returns 200 `changed: false`.
 * Check with the provider that the failed attempt did not settle before retrying.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse } from '@/lib/api/errors';
import { requireScope } from '@/lib/auth/session';
import { getDb } from '@/lib/db/client';
import { enqueueProcessPayoutSafely } from '@/lib/jobs';
import { getPayoutView, retryPayout } from '@/lib/payouts';

const paramsSchema = z.object({ id: z.uuid() });

type RouteParams = { readonly params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    await requireScope('payout:approve');
    const { id } = paramsSchema.parse(await params);

    const db = getDb();
    const { payout, changed } = await retryPayout(db, id);
    if (changed) {
      await enqueueProcessPayoutSafely({ payoutId: payout.id });
    }
    return NextResponse.json({ payout: await getPayoutView(db, payout.id), changed });
  } catch (error) {
    return errorResponse(error);
  }
}
