// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `GET /api/v1/anomalies` — the anomaly review queue (FR-3.6). Scope `anomaly:review` (admin).
 * Filters `status=open|confirmed|dismissed|all` (default `open`), `type`, `eventId`; newest
 * first with `?cursor=&limit=` (≤ 100). Each item names its collector and supervisor and
 * carries the detector's `context`. A flag never blocked anything — it is a note for a human.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse } from '@/lib/api/errors';
import { requireScope } from '@/lib/auth/session';
import { getDb } from '@/lib/db/client';
import { ANOMALY_TYPES } from '@/lib/db/schema';
import { ANOMALY_STATUSES, listAnomalies } from '@/lib/fraud';
import { PAGE_DEFAULT, PAGE_MAX } from '@/lib/pagination';

const querySchema = z.object({
  status: z.enum(ANOMALY_STATUSES).default('open'),
  type: z.enum(ANOMALY_TYPES).optional(),
  eventId: z.uuid().optional(),
  cursor: z.string().min(1).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(PAGE_MAX).default(PAGE_DEFAULT),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await requireScope('anomaly:review');
    const { cursor, limit, ...filter } = querySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams),
    );
    return NextResponse.json(await listAnomalies(getDb(), filter, { cursor, limit }));
  } catch (error) {
    return errorResponse(error);
  }
}
