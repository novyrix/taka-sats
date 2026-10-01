// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `GET /api/v1/treasury/topups/:id`: one proposal with its approvals, transfer and outcome.
 * Scope `treasury:read` (admin).
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse } from '@/lib/api/errors';
import { requireScope } from '@/lib/auth/session';
import { getDb } from '@/lib/db/client';
import { getTopupView, TopupNotFoundError } from '@/lib/treasury';

const paramsSchema = z.object({ id: z.uuid() });

type RouteParams = { readonly params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    await requireScope('treasury:read');
    const { id } = paramsSchema.parse(await params);
    const topup = await getTopupView(getDb(), id);
    if (!topup) {
      throw new TopupNotFoundError(`funding proposal ${id}`);
    }
    return NextResponse.json({ topup });
  } catch (error) {
    return errorResponse(error);
  }
}
