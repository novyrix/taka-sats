// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `GET /api/v1/events` — collection events for review screens and session logs, newest
 * `recordedAt` first. Scope `collector:read`. A plain `supervisor` sees only events THEY
 * recorded; `hub_lead`/`admin` see all. Filters `sessionId`, `collectorId`, `material`,
 * `from` (inclusive), `to` (exclusive); `?cursor=&limit=` (≤ 100).
 *
 * GPS coordinates go only to `hub_lead`/`admin`; a supervisor sees `geo: { kind }`. Photos are
 * referenced by `photoPath` — never by the internal `photo_url`.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse } from '@/lib/api/errors';
import { requireScope } from '@/lib/auth/session';
import { listEvents } from '@/lib/collection-events/queries';
import { getDb } from '@/lib/db/client';
import { PAGE_DEFAULT, PAGE_MAX } from '@/lib/pagination';

const querySchema = z.object({
  sessionId: z.uuid().optional(),
  collectorId: z.uuid().optional(),
  material: z.string().trim().min(1).max(64).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  cursor: z.string().min(1).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(PAGE_MAX).default(PAGE_DEFAULT),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const actor = await requireScope('collector:read');
    const { cursor, limit, ...filter } = querySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams),
    );
    const isPlainSupervisor = actor.role === 'supervisor';
    const page = await listEvents(
      getDb(),
      { ...filter, ...(isPlainSupervisor && { recordedBy: actor.id }) },
      { cursor, limit, includeGeo: !isPlainSupervisor },
    );
    return NextResponse.json(page);
  } catch (error) {
    return errorResponse(error);
  }
}
