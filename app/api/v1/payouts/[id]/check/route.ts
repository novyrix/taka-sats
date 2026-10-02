// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `GET /api/v1/payouts/:id/check`: read only: ask the payment provider what it recorded for this
 * payout (by the stored payment hash, else by the payout id in the memo). Scope `payout:resolve`
 * (`admin` only). It changes nothing: resolving stays a person's decision
 * (`POST /payouts/:id/resolve`). `check.state` is `paid | failed | pending | not_found`;
 * `not_found` is not proof that nothing was sent. A provider that cannot look payments up answers
 * `supported: false`. 409 `invalid_state` for a payout that was never sent.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse } from '@/lib/api/errors';
import { requireScope } from '@/lib/auth/session';
import { getDb } from '@/lib/db/client';
import { getLightningProvider } from '@/lib/lightning';
import { checkPayout } from '@/lib/payouts';

const paramsSchema = z.object({ id: z.uuid() });

type RouteParams = { readonly params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const actor = await requireScope('payout:resolve');
    const { id } = paramsSchema.parse(await params);
    const result = await checkPayout(getDb(), getLightningProvider(), {
      payoutId: id,
      actor: { role: actor.role },
    });
    if (!result.supported) {
      return NextResponse.json({ check: { supported: false, reason: result.reason } });
    }
    const { lookup } = result;
    return NextResponse.json({
      check: {
        supported: true,
        state: lookup.state,
        paymentRef: lookup.paymentRef ?? null,
        proofVerified: lookup.proofVerified ?? null,
        feeSats: lookup.feeSats ?? null,
        matches: lookup.matches ?? null,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
