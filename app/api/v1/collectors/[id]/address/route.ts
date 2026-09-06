// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `POST /api/v1/collectors/:id/address` — attach a bring-your-own receive
 * address (§7.1 Path A, M1-5). Scope: `collector:enrol`.
 *
 * The raw scanned/submitted code is resolved and validated receive-capable
 * by the active `LightningProvider` before it is stored — a withdraw
 * (`LNURLw`) code is rejected here with 422, not merely in the UI
 * (ADR-0001, M1-10).
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse } from '@/lib/api/errors';
import { requireScope } from '@/lib/auth/session';
import { attachByoAddress } from '@/lib/collectors';
import { getDb } from '@/lib/db/client';
import { getLightningProvider } from '@/lib/lightning';

const paramsSchema = z.object({ id: z.uuid() });
const bodySchema = z.object({ rawCode: z.string().trim().min(1) });

type RouteParams = { readonly params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    await requireScope('collector:enrol');

    const { id } = paramsSchema.parse(await params);
    const { rawCode } = bodySchema.parse(await request.json().catch(() => ({})));

    const collector = await attachByoAddress(getDb(), getLightningProvider(), {
      collectorId: id,
      rawCode,
    });
    return NextResponse.json({ collector });
  } catch (error) {
    return errorResponse(error);
  }
}
