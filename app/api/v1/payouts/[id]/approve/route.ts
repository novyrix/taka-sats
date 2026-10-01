// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `POST /api/v1/payouts/:id/approve` — release a payout held in `pending_approval`
 * (FR-3.2). Scope `payout:approve` (`hub_lead`, `admin`). The approver may not be the
 * supervisor who recorded the collection (403 `self_approval`). No body. Idempotent:
 * approving an already-approved payout returns 200 with `changed: false`.
 *
 * Approving does not pay anything itself — it queues the payout for the worker, which
 * re-checks everything (collector, destination, rate, float) before sending.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse } from '@/lib/api/errors';
import { requireScope } from '@/lib/auth/session';
import { getDb } from '@/lib/db/client';
import { enqueueProcessPayoutSafely } from '@/lib/jobs';
import { approvePayout, getPayoutView } from '@/lib/payouts';

const paramsSchema = z.object({ id: z.uuid() });

type RouteParams = { readonly params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const actor = await requireScope('payout:approve');
    const { id } = paramsSchema.parse(await params);

    const db = getDb();
    const { payout, changed } = await approvePayout(db, {
      payoutId: id,
      actor: { id: actor.id, role: actor.role },
    });
    if (changed) {
      await enqueueProcessPayoutSafely({ payoutId: payout.id });
    }
    return NextResponse.json({ payout: await getPayoutView(db, payout.id), changed });
  } catch (error) {
    return errorResponse(error);
  }
}
