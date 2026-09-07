// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `POST /api/v1/sync/events` (FR-4.2, REQUIREMENTS §10.3, ROADMAP M4-3). The
 * PWA's outbox drains here. Body: `{ events: SyncEventInput[] }`, each carrying
 * its client UUID + `content_hash`. Idempotent per `id`; one result per event,
 * in submitted order; a rejected event is `needs_attention` + reason, never a
 * silent drop.
 *
 * Scope `collection:record`. A plain `supervisor` may only sync events
 * attributed to themselves; `hub_lead`/`admin` may sync on behalf of a
 * supervisor (device recovery).
 */

import { NextResponse, type NextRequest } from 'next/server';
import { errorResponse } from '@/lib/api/errors';
import { requireScope } from '@/lib/auth/session';
import {
  ingestCollectionEvent,
  type SyncResult,
  syncEventsBodySchema,
} from '@/lib/collection-events';
import { getDb } from '@/lib/db/client';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const actor = await requireScope('collection:record');
    const { events } = syncEventsBodySchema.parse(await request.json().catch(() => ({})));
    const db = getDb();

    const results: SyncResult[] = [];
    for (const event of events) {
      if (actor.role === 'supervisor' && event.supervisorId !== actor.id) {
        results.push({
          id: event.id,
          status: 'needs_attention',
          reason: 'a supervisor may only sync their own events',
        });
        continue;
      }
      results.push(await ingestCollectionEvent(db, event));
    }

    return NextResponse.json({ results });
  } catch (error) {
    return errorResponse(error);
  }
}
