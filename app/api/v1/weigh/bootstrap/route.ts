// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `GET /api/v1/weigh/bootstrap` (ROADMAP M3-3/M3-4). One call the PWA makes
 * while still online to prime everything the offline weigh flow needs:
 *
 *   - the caller's active assigned session (M2-7 — 403 `no_active_session`
 *     otherwise),
 *   - the current material rates,
 *   - the latest BTC→fiat snapshot (for the indicative figure; may be null),
 *   - every active collector (capped) to cache for offline lookup.
 *
 * Scope `collection:record` (supervisor / hub_lead / admin).
 */

import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/api/errors';
import { requireScope } from '@/lib/auth/session';
import { listActiveCollectors } from '@/lib/collectors';
import { getSettings } from '@/lib/config';
import { getDb } from '@/lib/db/client';
import { latestSnapshot } from '@/lib/money/rates';
import { currentRates } from '@/lib/rates';
import { currentSessionForSupervisor, NoActiveSessionError } from '@/lib/sessions';

export async function GET(): Promise<NextResponse> {
  try {
    const actor = await requireScope('collection:record');
    const db = getDb();

    const session = await currentSessionForSupervisor(db, actor.id);
    if (!session) {
      throw new NoActiveSessionError();
    }

    const quote = getSettings().programme.fiat_currency;
    const [rates, snapshot, collectors] = await Promise.all([
      currentRates(db),
      latestSnapshot(db, 'BTC', quote),
      listActiveCollectors(db),
    ]);

    return NextResponse.json({
      session: {
        sessionId: session.id,
        location: session.location,
        scheduledStart: session.scheduledStart.toISOString(),
        scheduledEnd: session.scheduledEnd.toISOString(),
      },
      rates: rates.map((r) => ({
        rateId: r.id,
        material: r.material,
        rateFiatMinor: r.rateFiatMinor,
        fiatCurrency: r.fiatCurrency,
      })),
      exchangeRate: snapshot ? Number(snapshot.rate) : null,
      collectors: collectors.map((c) => ({
        id: c.id,
        alias: c.alias,
        publicCode: c.publicCode,
        nfcTagId: c.nfcTagId,
        status: c.status,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
