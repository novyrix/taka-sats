// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `POST /api/v1/treasury/topups/:id/signoff`: record the caller's approval of a funding proposal.
 * Scope `treasury:approve` (admin). No body. A steward other than the proposer, once each: the
 * proposer gets `403 self_approval`, a resend is `200` with `changed: false`, and a cancelled,
 * rejected or already-approved proposal is `409 invalid_state`. Approving moves no money.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse } from '@/lib/api/errors';
import { requireScope } from '@/lib/auth/session';
import { getDb } from '@/lib/db/client';
import { approveTopup, getTopupView } from '@/lib/treasury';
import { hotWallet } from '@/lib/treasury/provider';

const paramsSchema = z.object({ id: z.uuid() });

type RouteParams = { readonly params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const actor = await requireScope('treasury:approve');
    const { id } = paramsSchema.parse(await params);
    const db = getDb();
    const { topup, changed } = await approveTopup(db, hotWallet, {
      topupId: id,
      actor: { id: actor.id, role: actor.role },
    });
    return NextResponse.json({ topup: await getTopupView(db, topup.id), changed });
  } catch (error) {
    return errorResponse(error);
  }
}
