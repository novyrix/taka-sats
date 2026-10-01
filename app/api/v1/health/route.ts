// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `GET /api/v1/health` — liveness + a database round trip, for the load balancer,
 * the Compose healthcheck and `scripts/pilot-smoke.ts`. Public; reveals nothing
 * beyond up/down. Always answers (200 healthy, 503 if the database is unreachable).
 */

import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  try {
    await getDb().execute(sql`select 1`);
    return NextResponse.json({ ok: true, database: 'up' });
  } catch {
    return NextResponse.json({ ok: false, database: 'down' }, { status: 503 });
  }
}
