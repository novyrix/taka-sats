// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `GET /api/v1/stats/summary` — the PUBLIC programme summary. No session. Aggregate-only: no
 * alias, no per-person figure, no GPS, no wallet. Precision follows
 * `transparency.amount_disclosure` (`exact` | `bucketed` | `omitted`) and `weight_bucket_kg`.
 * Cacheable for a minute.
 */

import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/api/errors';
import { getDb } from '@/lib/db/client';
import { publicSummary } from '@/lib/stats';

/** Reads the database — never prerendered at build time. */
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  try {
    const summary = await publicSummary(getDb());
    return NextResponse.json(summary, { headers: { 'Cache-Control': 'public, max-age=60' } });
  } catch (error) {
    return errorResponse(error);
  }
}
