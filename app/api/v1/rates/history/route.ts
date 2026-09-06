// SPDX-License-Identifier: AGPL-3.0-only

/** `GET /api/v1/rates/history` — full versioned rate history (§8.3). Scope `rates:read`. */

import { type NextRequest, NextResponse } from 'next/server';
import { errorResponse } from '@/lib/api/errors';
import { requireScope } from '@/lib/auth/session';
import { getDb } from '@/lib/db/client';
import { rateHistory } from '@/lib/rates';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await requireScope('rates:read');
    const material = request.nextUrl.searchParams.get('material') ?? undefined;
    return NextResponse.json({ rates: await rateHistory(getDb(), material) });
  } catch (error) {
    return errorResponse(error);
  }
}
