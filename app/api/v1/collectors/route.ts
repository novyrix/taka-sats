// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `/api/v1/collectors` (§7.1, M1-4 / M1-8).
 *  - `POST` enrol a collector — scope `collector:enrol`.
 *  - `GET ?q=<alias>` alias search (the G2 manual-lookup fallback) —
 *    scope `collector:read`. Returns a compact list.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse } from '@/lib/api/errors';
import { requireScope } from '@/lib/auth/session';
import {
  enrolCollector,
  enrolCollectorInputSchema,
  searchCollectorsByAlias,
} from '@/lib/collectors';
import { getDb } from '@/lib/db/client';

const searchSchema = z.object({
  q: z.string().trim().min(1).max(120),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await requireScope('collector:read');

    const { q, limit } = searchSchema.parse({
      q: request.nextUrl.searchParams.get('q'),
      limit: request.nextUrl.searchParams.get('limit') ?? undefined,
    });

    const collectors = await searchCollectorsByAlias(getDb(), q, limit);
    return NextResponse.json({ collectors });
  } catch (error) {
    return errorResponse(error);
  }
}

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
