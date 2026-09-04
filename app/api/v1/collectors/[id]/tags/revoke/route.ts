// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `POST /api/v1/collectors/:id/tags/revoke` (§7.3, M1-4). Scope: `tag:revoke`
 * (admin only). Revocation is per `tag_id`, never global — other collectors
 * are unaffected (§7.3).
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse } from '@/lib/api/errors';
import { requireScope } from '@/lib/auth/session';
import { findCollectorById, revokeTag } from '@/lib/collectors';
import { getDb } from '@/lib/db/client';

const paramsSchema = z.object({ id: z.uuid() });
/** `tagId` defaults to the collector's current active tag when omitted. */
const bodySchema = z.object({ tagId: z.string().trim().min(1).optional() });

type RouteParams = { readonly params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    await requireScope('tag:revoke');

    const { id } = paramsSchema.parse(await params);
    const body: unknown = await request.json().catch(() => ({}));
    const { tagId: requestedTagId } = bodySchema.parse(body);

    const db = getDb();
    const tagId = requestedTagId ?? (await findCollectorById(db, id))?.nfcTagId;
    if (!tagId) {
      return NextResponse.json(
        { error: { code: 'not_found', message: `Collector ${id} has no active tag to revoke` } },
        { status: 404 },
      );
    }

    const revoked = await revokeTag(db, { tagId });
    if (!revoked) {
      return NextResponse.json(
        { error: { code: 'not_found', message: `Tag ${tagId} has no active mapping to revoke` } },
        { status: 404 },
      );
    }

    return NextResponse.json({ tag: revoked });
  } catch (error) {
    return errorResponse(error);
  }
}
