// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `GET /api/v1/reconciliation/reports` — saved reconciliation reports, newest first. Scope
 * `report:generate:all` (admin). `?material=&cursor=&limit=` (≤ 100).
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse } from '@/lib/api/errors';
import { requireScope } from '@/lib/auth/session';
import { getDb } from '@/lib/db/client';
import { listReconciliationReports, toReportView } from '@/lib/fraud';
import { PAGE_DEFAULT, PAGE_MAX } from '@/lib/pagination';

const querySchema = z.object({
  material: z.string().trim().min(1).max(64).optional(),
  cursor: z.string().min(1).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(PAGE_MAX).default(PAGE_DEFAULT),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await requireScope('report:generate:all');
    const { material, cursor, limit } = querySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams),
    );
    const page = await listReconciliationReports(getDb(), { material, cursor, limit });
    return NextResponse.json({
      reports: page.reports.map(toReportView),
      nextCursor: page.nextCursor,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
