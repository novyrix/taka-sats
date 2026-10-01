// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `POST /api/v1/collectors/:id/address` — attach a bring-your-own receive address
 * (§7.1 Path A, M1-5). Scope: `collector:enrol`.
 *
 * @deprecated A compatibility alias for `POST /collectors/:id/destinations`
 * (D-26), kept so the current enrol screen keeps working. Same behaviour, same
 * rejections (a withdraw code or a card's Pay QR is a 422 and is never stored);
 * the response keeps the `{ collector }` shape the screen reads and adds `destination`.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse } from '@/lib/api/errors';
import { requireScope } from '@/lib/auth/session';
import { attachDestination, toCollectorView, toDestinationView } from '@/lib/collectors';
import { getDb } from '@/lib/db/client';
import {
  enqueuePayoutsAwaitingDestination,
  enqueueProcessPayout,
  enqueueValidateCollectorDestination,
} from '@/lib/jobs';
import { getLightningProvider } from '@/lib/lightning';
import { requireActiveSession } from '@/lib/sessions';

const paramsSchema = z.object({ id: z.uuid() });
const bodySchema = z.object({ rawCode: z.string().trim().min(1) });

type RouteParams = { readonly params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const actor = await requireScope('collector:enrol');

    await requireActiveSession(getDb(), actor);

    const { id } = paramsSchema.parse(await params);
    const { rawCode } = bodySchema.parse(await request.json().catch(() => ({})));

    const { destination, collector, needsValidation } = await attachDestination(
      getDb(),
      getLightningProvider(),
      { collectorId: id, rawCode },
      { id: actor.id, role: actor.role },
    );
    if (needsValidation) {
      await enqueueValidateCollectorDestination({ destinationId: destination.id });
    } else if (destination.status === 'verified') {
      // Payouts that were waiting on a destination can now proceed.
      await enqueuePayoutsAwaitingDestination(getDb(), collector.id, enqueueProcessPayout);
    }
    return NextResponse.json({
      collector: toCollectorView(collector),
      destination: toDestinationView(destination),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
