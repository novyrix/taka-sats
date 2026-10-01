// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `POST /api/v1/anomalies/:id/review` — record a verdict on a flag (FR-3.6). Scope
 * `anomaly:review` (admin). Body `{ outcome: 'confirmed' | 'dismissed', note? }`.
 *
 * The first verdict is final for that reviewer; repeating the same outcome changes nothing
 * (`changed: false`). A DIFFERENT admin may overturn it — the superseded verdict is kept in
 * `context.history`. The same admin trying to flip their own verdict gets `409 review_final`.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse } from '@/lib/api/errors';
import { requireScope } from '@/lib/auth/session';
import { getDb } from '@/lib/db/client';
import { reviewAnomaly, reviewInputSchema } from '@/lib/fraud';

const paramsSchema = z.object({ id: z.uuid() });

type RouteParams = { readonly params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const actor = await requireScope('anomaly:review');
    const { id } = paramsSchema.parse(await params);
    const input = reviewInputSchema.parse(await request.json().catch(() => null));
    const { anomaly, changed } = await reviewAnomaly(getDb(), id, input, actor.id);
    return NextResponse.json({ anomaly, changed });
  } catch (error) {
    return errorResponse(error);
  }
}
