// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `/api/v1/rates` (§8.3, ROADMAP M2-5).
 *  - `GET` current material rates — scope `rates:read` (staff).
 *  - `POST` a new rate version — scope `session:configure` (admin only).
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse } from '@/lib/api/errors';
import { requireScope } from '@/lib/auth/session';
import { getDb } from '@/lib/db/client';
import { currentRates, setMaterialRate } from '@/lib/rates';

const bodySchema = z.object({
  material: z.string().trim().min(1).max(80),
  rateFiatMinor: z.number().int().nonnegative(),
  effectiveFrom: z.coerce.date().optional(),
});

export async function GET(): Promise<NextResponse> {
  try {
    await requireScope('rates:read');
    return NextResponse.json({ rates: await currentRates(getDb()) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await requireScope('session:configure');
    const { material, rateFiatMinor, effectiveFrom } = bodySchema.parse(
      await request.json().catch(() => ({})),
    );
    const rate = await setMaterialRate(getDb(), {
      material,
      rateFiatMinor,
      ...(effectiveFrom ? { effectiveFrom } : {}),
    });
    return NextResponse.json({ rate }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
