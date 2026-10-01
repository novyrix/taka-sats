// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `POST /api/v1/treasury/topups/:id/transfer`: record the pool transfer's txid or reference, after
 * the stewards signed it in the pool's own wallet. Scope `treasury:propose` (admin). Body
 * `{ reference }`. Only an `approved` proposal; the same reference again is `200` with
 * `changed: false`; a reference already used by another proposal is `409 conflict`. Taka Sats
 * moves nothing: this only records what the stewards did elsewhere.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse } from '@/lib/api/errors';
import { requireScope } from '@/lib/auth/session';
import { getDb } from '@/lib/db/client';
import { getTopupView, normaliseTransferReference, recordTopupTransfer } from '@/lib/treasury';
import { hotWallet } from '@/lib/treasury/provider';

const paramsSchema = z.object({ id: z.uuid() });
// The shape is checked here too, so a malformed reference is a 400 before any database access.
const bodySchema = z
  .object({
    reference: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .refine((value) => {
        try {
          normaliseTransferReference(value);
          return true;
        } catch {
          return false;
        }
      }, 'A transfer reference is printable characters without spaces'),
  })
  .strict();

type RouteParams = { readonly params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const actor = await requireScope('treasury:propose');
    const { id } = paramsSchema.parse(await params);
    const { reference } = bodySchema.parse(await request.json().catch(() => null));
    const db = getDb();
    const { topup, changed } = await recordTopupTransfer(db, hotWallet, {
      topupId: id,
      reference,
      actor: { id: actor.id, role: actor.role },
    });
    return NextResponse.json({ topup: await getTopupView(db, topup.id), changed });
  } catch (error) {
    return errorResponse(error);
  }
}
