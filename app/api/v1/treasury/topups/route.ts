// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `/api/v1/treasury/topups`: the funding vote's proposals (ADR-0020).
 *
 * `GET`  scope `treasury:read`: newest first; `status`, `cursor`, `limit` (1-100, default 50).
 * `POST` scope `treasury:propose`: body `{ id?, amountSats, note? }` proposes refilling the hot wallet
 *        from the pool. `id` is an optional client UUID that makes a resend idempotent. `201` when
 *        created, `200` for a resend. Refused with `422 hot_wallet_cap_exceeded` above the cap and
 *        `503 float_unavailable` when a cap is set and the balance cannot be read.
 *
 * Proposing moves nothing: the transfer is signed outside Taka Sats, in the pool's own wallet.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse } from '@/lib/api/errors';
import { requireScope } from '@/lib/auth/session';
import { getDb } from '@/lib/db/client';
import {
  getTopupView,
  listTopups,
  proposeTopup,
  TOPUP_PAGE_DEFAULT,
  TOPUP_PAGE_MAX,
  TOPUP_STATUSES,
} from '@/lib/treasury';
import { hotWallet } from '@/lib/treasury/provider';

const querySchema = z.object({
  status: z.enum(TOPUP_STATUSES).optional(),
  cursor: z.string().min(1).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(TOPUP_PAGE_MAX).default(TOPUP_PAGE_DEFAULT),
});

const bodySchema = z
  .object({
    id: z.uuid().optional(),
    amountSats: z.number().int().positive(),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await requireScope('treasury:read');
    const { status, cursor, limit } = querySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams),
    );
    return NextResponse.json(
      await listTopups(getDb(), { status }, { limit, ...(cursor && { cursor }) }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const actor = await requireScope('treasury:propose');
    const body = bodySchema.parse(await request.json().catch(() => null));
    const db = getDb();
    const { topup, changed } = await proposeTopup(db, hotWallet, {
      id: body.id,
      amountSats: body.amountSats,
      note: body.note,
      actor: { id: actor.id, role: actor.role },
    });
    return NextResponse.json(
      { topup: await getTopupView(db, topup.id), changed },
      { status: changed ? 201 : 200 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
