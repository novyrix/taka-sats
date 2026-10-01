// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `GET /api/v1/payouts/summary` — payout count and sats total per status, every status
 * listed (zero-filled). Scope `payout:read`; a plain `supervisor` sees only the payouts of
 * events they recorded.
 */

import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/api/errors';
import { requireScope } from '@/lib/auth/session';
import { getDb } from '@/lib/db/client';
import { payoutSummary } from '@/lib/payouts';

export async function GET(): Promise<NextResponse> {
  try {
    const actor = await requireScope('payout:read');
    const summary = await payoutSummary(
      getDb(),
      actor.role === 'supervisor' ? actor.id : undefined,
    );
    return NextResponse.json(summary);
  } catch (error) {
    return errorResponse(error);
  }
}
