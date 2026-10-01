// SPDX-License-Identifier: AGPL-3.0-only

import { timingSafeEqual } from 'node:crypto';
import { type NextRequest, NextResponse } from 'next/server';
import {
  enqueueCreateLedgerCheckpoint,
  enqueueRefreshExchangeRate,
  enqueueSweepPayouts,
} from '@/lib/jobs';

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get('authorization');

  if (!secret || !authorization) {
    return false;
  }

  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(authorization);

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * Vercel Cron bridge (D-10): a scheduled `GET` here enqueues the periodic
 * jobs onto pg-boss, which the worker drains. On the self-hosted path the
 * worker schedules these itself, so this route is Vercel-only.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const enqueued: string[] = [];
  try {
    await enqueueRefreshExchangeRate();
    enqueued.push('refresh-exchange-rate');
    await enqueueCreateLedgerCheckpoint();
    enqueued.push('create-ledger-checkpoint');
    await enqueueSweepPayouts();
    enqueued.push('sweep-payouts');
  } catch (error) {
    console.error('[cron] enqueue failed', error instanceof Error ? error.name : typeof error);
    return NextResponse.json({ error: 'enqueue_failed' }, { status: 502 });
  }

  return NextResponse.json({ status: 'accepted', enqueued });
}
