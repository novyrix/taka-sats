// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `GET /api/v1/ledger/verify` — recompute the chain server-side and report the
 * first broken link, if any (REQUIREMENTS §11.2). Scope
 * `ledger:read` (admin). Always 200: a tampered ledger is a *result*
 * (`ok: false`), not a request error. `?mode=windowed` starts from the latest
 * checkpoint instead of genesis. Checkpoint signatures are checked against the
 * configured `LEDGER_SIGNING_KEY`'s public key when one is set.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse } from '@/lib/api/errors';
import { requireScope } from '@/lib/auth/session';
import { getDb } from '@/lib/db/client';
import { verifyLedger } from '@/lib/ledger/checkpoints';
import { configuredPublicKey } from '@/lib/ledger/signing';

const querySchema = z.object({ mode: z.enum(['full', 'windowed']).default('full') });

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await requireScope('ledger:read');
    const { mode } = querySchema.parse({
      mode: request.nextUrl.searchParams.get('mode') ?? undefined,
    });
    return NextResponse.json(
      await verifyLedger(getDb(), { mode, publicKey: configuredPublicKey() }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
