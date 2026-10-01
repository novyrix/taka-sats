// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `POST /api/v1/treasury/topups/:id/reject`: a steward other than the proposer refuses a
 * proposal (a single veto: it only ever stops money from moving). Scope `treasury:approve`
 * (admin). Optional body `{ reason }`. Only before a transfer is recorded; idempotent. The proposer
 * gets `403 self_approval` (they cancel instead).
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse } from '@/lib/api/errors';
import { requireScope } from '@/lib/auth/session';
import { getDb } from '@/lib/db/client';
import { getTopupView, rejectTopup } from '@/lib/treasury';

const paramsSchema = z.object({ id: z.uuid() });
const bodySchema = z.object({ reason: z.string().trim().max(500).optional() }).strict();

type RouteParams = { readonly params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const actor = await requireScope('treasury:approve');
    const { id } = paramsSchema.parse(await params);
    const body = bodySchema.parse(await request.json().catch(() => ({})));
    const db = getDb();
    const { topup, changed } = await rejectTopup(db, {
      topupId: id,
      reason: body.reason,
      actor: { id: actor.id, role: actor.role },
    });
    return NextResponse.json({ topup: await getTopupView(db, topup.id), changed });
  } catch (error) {
    return errorResponse(error);
  }
}
