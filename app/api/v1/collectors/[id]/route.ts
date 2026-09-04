// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `GET /api/v1/collectors/:id` (§7.1, M1-4).
 * Scope: `collector:read` (supervisor, hub_lead, admin).
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse } from '@/lib/api/errors';
import { requireScope } from '@/lib/auth/session';
import { findCollectorById } from '@/lib/collectors';
import { getDb } from '@/lib/db/client';

const paramsSchema = z.object({ id: z.uuid() });

type RouteParams = { readonly params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    await requireScope('collector:read');

    const { id } = paramsSchema.parse(await params);
    const collector = await findCollectorById(getDb(), id);
    if (!collector) {
      return NextResponse.json(
        { error: { code: 'not_found', message: `Collector not found: ${id}` } },
        { status: 404 },
      );
    }

    return NextResponse.json({ collector });
  } catch (error) {
    return errorResponse(error);
  }
}
