// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `POST /api/v1/collectors` — enrol a collector (§7.1, M1-4).
 * Scope: `collector:enrol` (supervisor, hub_lead, admin).
 */

import { type NextRequest, NextResponse } from 'next/server';
import { requireScope } from '@/lib/auth/session';
import { enrolCollector, enrolCollectorInputSchema } from '@/lib/collectors';
import { getDb } from '@/lib/db/client';
import { errorResponse } from '@/lib/api/errors';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await requireScope('collector:enrol');

    const body: unknown = await request.json().catch(() => ({}));
    const input = enrolCollectorInputSchema.parse(body);

    const collector = await enrolCollector(getDb(), input);
    return NextResponse.json({ collector }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
