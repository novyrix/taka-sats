// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `GET /api/v1/payouts` — list payouts, newest first (REQUIREMENTS §9, §10.4).
 * Scope `payout:read`. A plain `supervisor` sees only payouts of events THEY recorded;
 * `hub_lead`/`admin` see all. Filters: `status`, `collectorId`, `sessionId`, `eventId`.
 * Cursor pagination: pass the previous response's `nextCursor`; `limit` 1–100 (default 50).
 *
 * There is deliberately no way to create or execute a payout here, and no response field
 * carries a Lightning address — the destination is server-side only (§12.3).
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse } from '@/lib/api/errors';
import { requireScope } from '@/lib/auth/session';
import { getDb } from '@/lib/db/client';
import { listPayouts, PAYOUT_PAGE_DEFAULT, PAYOUT_PAGE_MAX, PAYOUT_STATUSES } from '@/lib/payouts';

const querySchema = z.object({
  status: z.enum(PAYOUT_STATUSES).optional(),
  collectorId: z.uuid().optional(),
  sessionId: z.uuid().optional(),
  eventId: z.uuid().optional(),
  cursor: z.string().min(1).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(PAYOUT_PAGE_MAX).default(PAYOUT_PAGE_DEFAULT),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const actor = await requireScope('payout:read');
    const query = querySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    const { cursor, limit, ...filter } = query;

    const page = await listPayouts(
      getDb(),
      { ...filter, ...(actor.role === 'supervisor' && { recordedBy: actor.id }) },
      { limit, ...(cursor && { cursor }) },
    );
    return NextResponse.json(page);
  } catch (error) {
    return errorResponse(error);
  }
}
