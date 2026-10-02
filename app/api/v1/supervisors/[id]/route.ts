// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `PATCH /api/v1/supervisors/:id`: deactivate or reactivate a staff account (a lost phone, someone
 * leaving). Scope `session:configure` (admin only). Body `{ active: boolean }`. Takes effect on the
 * account's very next request. `403 self_change` for your own account, `409 last_admin` when it is
 * the only active admin, `404 not_found`. Idempotent (`changed: false`).
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse } from '@/lib/api/errors';
import { requireScope } from '@/lib/auth/session';
import { getDb } from '@/lib/db/client';
import { setSupervisorActive } from '@/lib/supervisors';

const paramsSchema = z.object({ id: z.uuid() });
const bodySchema = z.object({ active: z.boolean() }).strict();

type RouteParams = { readonly params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const actor = await requireScope('session:configure');
    const { id } = paramsSchema.parse(await params);
    const { active } = bodySchema.parse(await request.json().catch(() => null));
    const result = await setSupervisorActive(getDb(), { id, active, actorId: actor.id });
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
