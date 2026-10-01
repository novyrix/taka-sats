// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `GET /api/v1/ledger/checkpoints` — the signed anchors, newest first
 * (REQUIREMENTS §11.2, ROADMAP M4-8). Scope `ledger:read` (admin). `publicKey`
 * is the Ed25519 key (base64) the server signs with — pin it out of band; it is
 * `null` when no `LEDGER_SIGNING_KEY` is configured. Keyset-paginated on
 * `through_seq` (`cursor` = the last `throughSeq` seen).
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse } from '@/lib/api/errors';
import { requireScope } from '@/lib/auth/session';
import { getDb } from '@/lib/db/client';
import { LEDGER_PAGE_DEFAULT } from '@/lib/ledger';
import { pageCheckpoints } from '@/lib/ledger/checkpoints';
import { configuredPublicKey } from '@/lib/ledger/signing';

const querySchema = z.object({
  cursor: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().positive().default(LEDGER_PAGE_DEFAULT),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await requireScope('ledger:read');
    const params = request.nextUrl.searchParams;
    const { cursor, limit } = querySchema.parse({
      cursor: params.get('cursor') ?? undefined,
      limit: params.get('limit') ?? undefined,
    });
    const page = await pageCheckpoints(getDb(), {
      limit,
      ...(cursor !== undefined && { cursor }),
    });
    return NextResponse.json({
      checkpoints: page.checkpoints,
      nextCursor: page.nextCursor,
      publicKey: configuredPublicKey(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
