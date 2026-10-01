// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `POST /api/v1/collectors/:id/authorization` — authorize or revoke a collector
 * (D-25, ADR-0017). Scope: `collector:authorize` (hub_lead, admin).
 *
 * Body `{ decision: 'authorize' | 'revoke', reason? }`. Idempotent: deciding a
 * state the collector is already in returns 200 with `changed: false` and writes
 * nothing; a real change writes a ledger-anchored audit row.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse } from '@/lib/api/errors';
import { requireScope } from '@/lib/auth/session';
import {
  authorizationDecisionSchema,
  decideCollectorAuthorization,
  toCollectorView,
} from '@/lib/collectors';
import { getDb } from '@/lib/db/client';

const paramsSchema = z.object({ id: z.uuid() });
const bodySchema = z.object({
  decision: authorizationDecisionSchema,
  reason: z.string().trim().min(1).max(500).optional(),
});

type RouteParams = { readonly params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const actor = await requireScope('collector:authorize');

    const { id } = paramsSchema.parse(await params);
    const { decision, reason } = bodySchema.parse(await request.json().catch(() => ({})));

    const { collector, changed } = await decideCollectorAuthorization(getDb(), {
      collectorId: id,
      decision,
      reason,
      actor: { id: actor.id, role: actor.role },
    });
    return NextResponse.json({ collector: toCollectorView(collector), changed });
  } catch (error) {
    return errorResponse(error);
  }
}
