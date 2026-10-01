// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `POST /api/v1/treasury/topups/:id/confirm`: check whether a recorded transfer has reached the
 * hot wallet and, if the rail's balance shows it, confirm the proposal. Scope `treasury:approve`
 * (admin). No body. `200 { topup, changed, arrived }`: `arrived: false` is not an error, the funds
 * have not shown up yet. The worker runs the same check on a schedule. `503 float_unavailable`
 * when the balance cannot be read. Confirming wakes the payouts that were waiting for funds.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse } from '@/lib/api/errors';
import { requireScope } from '@/lib/auth/session';
import { getDb } from '@/lib/db/client';
import { enqueueSweepPayoutsSafely } from '@/lib/jobs';
import { confirmTopup, getTopupView } from '@/lib/treasury';
import { hotWallet } from '@/lib/treasury/provider';

const paramsSchema = z.object({ id: z.uuid() });

type RouteParams = { readonly params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const actor = await requireScope('treasury:approve');
    const { id } = paramsSchema.parse(await params);
    const db = getDb();
    const { topup, changed, arrived } = await confirmTopup(db, hotWallet, {
      topupId: id,
      actor: { id: actor.id, role: actor.role },
    });
    if (changed) {
      await enqueueSweepPayoutsSafely();
    }
    return NextResponse.json({ topup: await getTopupView(db, topup.id), changed, arrived });
  } catch (error) {
    return errorResponse(error);
  }
}
