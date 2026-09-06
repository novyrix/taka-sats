// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `/api/v1/rotations` (ROADMAP M2-8, FR-3.7, FR-6.1).
 *  - `GET` — every rotation with its supervisor's name.
 *  - `POST` — add a rotation.
 * Scope `session:configure` (admin only) for both.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { errorResponse } from '@/lib/api/errors';
import { requireScope } from '@/lib/auth/session';
import { getDb } from '@/lib/db/client';
import { createRotation, createRotationInputSchema, listRotations } from '@/lib/rotations';

export async function GET(): Promise<NextResponse> {
  try {
    await requireScope('session:configure');
    return NextResponse.json({ rotations: await listRotations(getDb()) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await requireScope('session:configure');
    const input = createRotationInputSchema.parse(await request.json().catch(() => ({})));
    const rotation = await createRotation(getDb(), input);
    return NextResponse.json({ rotation }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
