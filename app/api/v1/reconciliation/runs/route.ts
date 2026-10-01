// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `POST /api/v1/reconciliation/runs` — persist a reconciliation report (one row per material)
 * for `[from, to)`, and raise a `mass_balance_variance` anomaly flag for every material over
 * the tolerance. Scope `reconciliation:write` (admin). Body `{ from, to, material? }`.
 * Reports are never updated — each run is new rows. Returns `201 { reports }`.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { errorResponse } from '@/lib/api/errors';
import { requireScope } from '@/lib/auth/session';
import { getDb } from '@/lib/db/client';
import { reconciliationPeriodSchema, runReconciliation, toReportView } from '@/lib/fraud';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const actor = await requireScope('reconciliation:write');
    const period = reconciliationPeriodSchema.parse(await request.json().catch(() => null));
    const reports = await runReconciliation(getDb(), period, actor.id);
    return NextResponse.json({ reports: reports.map(toReportView) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
