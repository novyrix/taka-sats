// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `GET /api/v1/tags/:tagId` — resolve a tapped NFC tag to its collector
 * (§7.1, ROADMAP M1-8). Scope: `collector:read`.
 *
 *  - 200 `{ collector, tag }` — an active mapping exists and the collector is authorized.
 *  - 409 `collector_not_authorized` — the tag maps to a collector who is not `active` (D-25).
 *  - 410 `tag_revoked` — the tag was issued and later revoked (§7.3, M1-9:
 *        the PWA and API reject a revoked tap).
 *  - 404 `not_found` — the tag has never been issued.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse } from '@/lib/api/errors';
import { requireScope } from '@/lib/auth/session';
import {
  canSeeAddress,
  CollectorNotAuthorizedError,
  findActiveTagMapping,
  isTagRevoked,
  recordRevokedTapAttempt,
  TagRevokedError,
  toCollectorView,
} from '@/lib/collectors';
import { getDb } from '@/lib/db/client';

const paramsSchema = z.object({ tagId: z.string().trim().min(1) });

type RouteParams = { readonly params: Promise<{ tagId: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const actor = await requireScope('collector:read');

    const { tagId } = paramsSchema.parse(await params);
    const db = getDb();

    const mapping = await findActiveTagMapping(db, tagId);
    if (mapping) {
      if (mapping.collector.status !== 'active') {
        throw new CollectorNotAuthorizedError(mapping.collector.id, mapping.collector.status);
      }
      const withAddress = canSeeAddress({ id: actor.id, role: actor.role }, mapping.collector);
      return NextResponse.json({
        collector: toCollectorView(mapping.collector, { withAddress }),
        tag: mapping.tag,
      });
    }

    if (await isTagRevoked(db, tagId)) {
      await recordRevokedTapAttempt(db, tagId);
      throw new TagRevokedError(tagId);
    }
    return NextResponse.json(
      { error: { code: 'not_found', message: `No collector is mapped to tag ${tagId}` } },
      { status: 404 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
