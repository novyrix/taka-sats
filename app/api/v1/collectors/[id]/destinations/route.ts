// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `/api/v1/collectors/:id/destinations` — a collector's payout destination (D-26, ADR-0018).
 *
 *  - `POST { rawCode }` — attach (or replace) the destination from a scanned/typed
 *    Receive QR, Lightning Address or LNURL-pay code. Scope `collector:enrol`.
 *    Replacing a *verified* destination additionally needs `collector:authorize`.
 *    201 `{ destination, collector }`; 202 when the wallet host was unreachable and
 *    the destination is `pending_validation` (the worker re-checks it). 422 for a
 *    withdraw code, a spend link (a card's Pay QR), or an unsafe target.
 *  - `GET` — the destination history, newest first. Scope `collector:read`.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse } from '@/lib/api/errors';
import { requireScope } from '@/lib/auth/session';
import {
  attachDestination,
  canSeeAddress,
  CollectorNotFoundError,
  CollectorNotYoursError,
  findCollectorById,
  listDestinations,
  toCollectorView,
  toDestinationView,
} from '@/lib/collectors';
import { getDb } from '@/lib/db/client';
import {
  enqueuePayoutsAwaitingDestination,
  enqueueProcessPayout,
  enqueueValidateCollectorDestination,
} from '@/lib/jobs';
import { getLightningProvider } from '@/lib/lightning';
import { requireActiveSession } from '@/lib/sessions';

const paramsSchema = z.object({ id: z.uuid() });
const bodySchema = z.object({ rawCode: z.string().trim().min(1).max(2000) });

type RouteParams = { readonly params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const actor = await requireScope('collector:enrol');

    // Like registering a collector, a plain supervisor writes a wallet only inside an active
    // assigned session (M2-7); hub_lead/admin are not shift-bound.
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
    return NextResponse.json(
      { destination: toDestinationView(destination), collector: toCollectorView(collector) },
      { status: needsValidation ? 202 : 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(_request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const actor = await requireScope('collector:read');

    const { id } = paramsSchema.parse(await params);
    const db = getDb();
    const collector = await findCollectorById(db, id);
    if (!collector) {
      throw new CollectorNotFoundError(id);
    }
    // The wallet history (every address ever used) is for staff and the registering supervisor.
    if (!canSeeAddress({ id: actor.id, role: actor.role }, collector)) {
      throw new CollectorNotYoursError();
    }
    const destinations = await listDestinations(db, id);
    return NextResponse.json({ destinations: destinations.map((d) => toDestinationView(d)) });
  } catch (error) {
    return errorResponse(error);
  }
}
