// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `DELETE /api/v1/rotations/:id` — remove a rotation. Scope
 * `session:configure` (admin only). Removing a rotation does not touch
 * sessions already created from it.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse } from '@/lib/api/errors';
import { requireScope } from '@/lib/auth/session';
import { getDb } from '@/lib/db/client';
import { deleteRotation } from '@/lib/rotations';

const paramsSchema = z.object({ id: z.uuid() });
type RouteParams = { readonly params: Promise<{ id: string }> };

export async function DELETE(
  _request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    await requireScope('session:configure');
    const { id } = paramsSchema.parse(await params);

    const deleted = await deleteRotation(getDb(), id);
    if (!deleted) {
      return NextResponse.json(
        { error: { code: 'not_found', message: `Rotation not found: ${id}` } },
        { status: 404 },
      );
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
