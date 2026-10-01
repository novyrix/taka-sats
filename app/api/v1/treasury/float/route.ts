// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `GET /api/v1/treasury/float` — the operating-float balance on the active Lightning rail,
 * and whether it is below `payouts.float_low_balance_alert_sats` (FR-7.2). Scope
 * `treasury:topup:initiate` (admin). 503 `float_unavailable` if the rail cannot be read.
 */

import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/api/errors';
import { requireScope } from '@/lib/auth/session';
import { getSettings } from '@/lib/config';
import { getLightningProvider } from '@/lib/lightning';

export async function GET(): Promise<NextResponse> {
  try {
    await requireScope('treasury:topup:initiate');

    let balance;
    try {
      balance = await getLightningProvider().getFloatBalance();
    } catch (error) {
      console.error(
        '[api] float balance unavailable',
        error instanceof Error ? error.name : typeof error,
      );
      return NextResponse.json(
        { error: { code: 'float_unavailable', message: 'The Lightning float could not be read' } },
        { status: 503 },
      );
    }
    return NextResponse.json({
      available: balance.available,
      asOf: balance.asOf,
      lowBalance: balance.available < getSettings().payouts.float_low_balance_alert_sats,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
