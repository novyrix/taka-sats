// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `/api/v1/collectors` (§7.1, M1-4 / M1-8, D-24 / D-25).
 *  - `POST` register a collector — scope `collector:enrol`. A supervisor's
 *    registration is `pending` until staff authorize it; `hub_lead`/`admin`
 *    register straight to `active`.
 *  - `GET ?q=<alias or code>` search — scope `collector:read`. Defaults to
 *    authorized (`active`) collectors and then requires `q`. `?status=pending`
 *    is a supervisor's own registrations, or the whole queue for staff holding
 *    `collector:authorize`, who may also list `revoked`/`all` and see each
 *    collector's destination for review.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse } from '@/lib/api/errors';
import { roleHasScope } from '@/lib/auth/permissions';
import { ForbiddenError, requireScope } from '@/lib/auth/session';
import {
  enrolCollector,
  enrolCollectorInputSchema,
  liveDestinationsFor,
  searchCollectors,
  toCollectorView,
  toDestinationView,
} from '@/lib/collectors';
import { getDb } from '@/lib/db/client';
import { enqueueProvisionCollectorWallet } from '@/lib/jobs';
import { requireActiveSession } from '@/lib/sessions';

const searchSchema = z.object({
  q: z.string().trim().min(1).max(120).optional(),
  status: z.enum(['active', 'pending', 'revoked', 'all']).default('active'),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const actor = await requireScope('collector:read');

    const params = request.nextUrl.searchParams;
    const { q, status, limit } = searchSchema.parse({
      q: params.get('q') ?? undefined,
      status: params.get('status') ?? undefined,
      limit: params.get('limit') ?? undefined,
    });
    if (status === 'active' && !q) {
      throw new z.ZodError([
        { code: 'custom', path: ['q'], message: 'q is required when listing active collectors' },
      ]);
    }

    const isStaff = roleHasScope(actor.role, 'collector:authorize');
    if (!isStaff && status !== 'active' && status !== 'pending') {
      throw new ForbiddenError('collector:authorize');
    }

    const db = getDb();
    const found = await searchCollectors(db, {
      q,
      status,
      limit,
      // A supervisor sees only their own pending registrations, never the whole queue.
      ...(!isStaff && status === 'pending' ? { registeredBy: actor.id } : {}),
    });

    if (!isStaff) {
      return NextResponse.json({ collectors: found });
    }
    const destinations = await liveDestinationsFor(
      db,
      found.map((c) => c.id),
    );
    return NextResponse.json({
      collectors: found.map((c) => {
        const destination = destinations.get(c.id);
        return { ...c, destination: destination ? toDestinationView(destination) : null };
      }),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const actor = await requireScope('collector:enrol');

    const db = getDb();
    // M2-7: a plain `supervisor` may only enrol while they have an active
    // assigned session; `hub_lead`/`admin` are not shift-bound.
    await requireActiveSession(db, actor);

    const body: unknown = await request.json().catch(() => ({}));
    const input = enrolCollectorInputSchema.parse(body);

    const collector = await enrolCollector(db, input, { id: actor.id, role: actor.role });

    // Path B: enqueue the LNbits provisioning job (M1-6). The worker drains
    // it; enrolment does not block on LNbits. Inert on the default (BYO) path.
    if (collector.addressSource === 'provisioned') {
      await enqueueProvisionCollectorWallet({ collectorId: collector.id });
    }

    return NextResponse.json({ collector: toCollectorView(collector) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
