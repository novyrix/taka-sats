// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `GET /api/v1/ledger` — stream the global hash chain (REQUIREMENTS §10, §11,
 * ROADMAP M4-8). Scope `ledger:read` (admin). Rows carry only ids, hashes and
 * timestamps — never collector data. Keyset-paginated on `seq`:
 *  - `order=asc` (default) → `seq > cursor`; `order=desc` → `seq < cursor`
 *  - `limit` is clamped to `LEDGER_PAGE_MAX`
 *  - `nextCursor` is the `cursor` for the next page, `null` on the last
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse } from '@/lib/api/errors';
import { requireScope } from '@/lib/auth/session';
import { getDb } from '@/lib/db/client';
import { LEDGER_PAGE_DEFAULT, pageEntries } from '@/lib/ledger';

const querySchema = z.object({
  cursor: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().positive().default(LEDGER_PAGE_DEFAULT),
  order: z.enum(['asc', 'desc']).default('asc'),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await requireScope('ledger:read');
    const params = request.nextUrl.searchParams;
    const { cursor, limit, order } = querySchema.parse({
      cursor: params.get('cursor') ?? undefined,
      limit: params.get('limit') ?? undefined,
      order: params.get('order') ?? undefined,
    });
    const page = await pageEntries(getDb(), {
      limit,
      order,
      ...(cursor !== undefined && { cursor }),
    });
    return NextResponse.json({ entries: page.entries, nextCursor: page.nextCursor, order });
  } catch (error) {
    return errorResponse(error);
  }
}
