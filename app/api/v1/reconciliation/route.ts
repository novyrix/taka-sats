// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `GET /api/v1/reconciliation?from=&to=&material=` — collected vs paid vs recycler-accepted
 * kilograms per material for `[from, to)`, computed on the fly (nothing is written). Scope
 * `report:generate:all` (admin). `POST /reconciliation/runs` persists a report.
 *
 * ```json
 * { "period": { "from": "…", "to": "…", "material": null },
 *   "rows": [ { "material": "PET", "collectedKg": 100, "paidKg": 96.5, "recyclerKg": 97.2,
 *               "varianceKg": 2.8, "variancePct": 2.8, "tolerancePct": 5,
 *               "status": "within_tolerance" } ] }
 * ```
 */

import { type NextRequest, NextResponse } from 'next/server';
import { errorResponse } from '@/lib/api/errors';
import { requireScope } from '@/lib/auth/session';
import { getDb } from '@/lib/db/client';
import { computeReconciliation, reconciliationPeriodSchema, toRowView } from '@/lib/fraud';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await requireScope('report:generate:all');
    const period = reconciliationPeriodSchema.parse(
      Object.fromEntries(request.nextUrl.searchParams),
    );
    const rows = await computeReconciliation(getDb(), period);
    return NextResponse.json({
      period: {
        from: period.from,
        to: period.to,
        material: period.material ?? null,
      },
      rows: rows.map(toRowView),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
