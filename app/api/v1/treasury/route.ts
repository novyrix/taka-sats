// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `GET /api/v1/treasury`: one payload for the treasury panel (FR-7.5): the hot-wallet float, the
 * cap and the room under it, the proposals still in flight, the payouts waiting for funds, and
 * the pool (a read-only balance is not configured, and the field says so). Scope `treasury:read`
 * (admin). A hot wallet that cannot be read does not fail the call: `hotWallet.error` says so.
 */

import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/api/errors';
import { requireScope } from '@/lib/auth/session';
import { getDb } from '@/lib/db/client';
import { getTreasuryOverview } from '@/lib/treasury';
import { hotWallet } from '@/lib/treasury/provider';

export async function GET(): Promise<NextResponse> {
  try {
    await requireScope('treasury:read');
    return NextResponse.json(await getTreasuryOverview(getDb(), hotWallet));
  } catch (error) {
    return errorResponse(error);
  }
}
