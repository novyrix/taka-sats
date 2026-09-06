// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `/api/v1/supervisors` (ROADMAP M2-6).
 *  - `GET` — the staff roster for the admin session/rotation pickers.
 *    Scope `session:configure` (admin only); active staff by default,
 *    `?includeInactive=1` for all, `?role=supervisor&role=hub_lead` to filter.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse } from '@/lib/api/errors';
import { ROLES } from '@/lib/auth/permissions';
import { requireScope } from '@/lib/auth/session';
import { getDb } from '@/lib/db/client';
import { listSupervisors } from '@/lib/supervisors';

const querySchema = z.object({
  includeInactive: z
    .enum(['1', 'true'])
    .optional()
    .transform((v) => v !== undefined),
  role: z.array(z.enum(ROLES)).optional(),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await requireScope('session:configure');

    const params = request.nextUrl.searchParams;
    const { includeInactive, role } = querySchema.parse({
      includeInactive: params.get('includeInactive') ?? undefined,
      role: params.getAll('role').length > 0 ? params.getAll('role') : undefined,
    });

    const supervisors = await listSupervisors(getDb(), {
      activeOnly: !includeInactive,
      ...(role ? { roles: role } : {}),
    });
    return NextResponse.json({ supervisors });
  } catch (error) {
    return errorResponse(error);
  }
}
