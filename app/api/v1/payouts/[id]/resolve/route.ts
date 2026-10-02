// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `POST /api/v1/payouts/:id/resolve`: record a person's decision on a payout stuck in `sending`
 * (outcome unknown). Scope `payout:resolve` (`admin` only). Body
 * `{ outcome: 'paid' | 'failed', reference?, note? }`; `reference` (the provider payment hash or
 * transaction id) proves a `paid` resolution. Idempotent: repeating the same resolution returns
 * `changed: false`; a conflicting one is `409 resolution_final`. The rules are in
 * `lib/payouts/resolve.ts`. A `failed` resolution does NOT re-queue the payout.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse } from '@/lib/api/errors';
import { requireScope } from '@/lib/auth/session';
import { getDb } from '@/lib/db/client';
import { getLightningProvider } from '@/lib/lightning';
import { getPayoutView, resolvePayout } from '@/lib/payouts';

const paramsSchema = z.object({ id: z.uuid() });
const bodySchema = z
  .object({
    outcome: z.enum(['paid', 'failed']),
    reference: z.string().trim().min(1).max(200).optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

type RouteParams = { readonly params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const actor = await requireScope('payout:resolve');
    const { id } = paramsSchema.parse(await params);
    const body = bodySchema.parse(await request.json().catch(() => null));

    const db = getDb();
    let provider: ReturnType<typeof getLightningProvider> | null = null;
    try {
      provider = getLightningProvider();
    } catch {
      // A misconfigured rail cannot veto; the resolution still needs a person and a reference.
      provider = null;
    }
    const result = await resolvePayout(db, provider, {
      payoutId: id,
      actor: { id: actor.id, role: actor.role },
      outcome: body.outcome,
      reference: body.reference,
      note: body.note,
    });
    return NextResponse.json({
      payout: await getPayoutView(db, id),
      changed: result.changed,
      providerState: result.providerState,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
