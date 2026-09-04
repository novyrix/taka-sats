// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `POST /api/v1/collectors/:id/tags` — reissue a tag (§7.2, M1-4).
 * Scope: `collector:enrol` (supervisor, hub_lead, admin — "create/reissue").
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse } from '@/lib/api/errors';
import { requireScope } from '@/lib/auth/session';
import { reissueTag } from '@/lib/collectors';
import { getDb } from '@/lib/db/client';

const paramsSchema = z.object({ id: z.uuid() });
const bodySchema = z.object({ newTagId: z.string().trim().min(1) });

type RouteParams = { readonly params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    await requireScope('collector:enrol');

    const { id } = paramsSchema.parse(await params);
    const body: unknown = await request.json().catch(() => ({}));
    const { newTagId } = bodySchema.parse(body);

    const tag = await reissueTag(getDb(), { collectorId: id, newTagId });
    return NextResponse.json({ tag }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
