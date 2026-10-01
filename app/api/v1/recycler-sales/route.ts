// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Recycler sales (FR-3.5, ADR-0006) — what a buyer accepted from the programme, the
 * counter-figure reconciliation compares collections against.
 *
 * `POST` (scope `reconciliation:write`, admin) — body `{ id?, material, grossKg, tareKg?,
 * buyer, soldAt, pricePerKgFiatMinor?, totalFiatMinor?, receiptSha256? }`. The net weight is
 * computed here (gross − tare); `tareKg > grossKg` is a 400. Anchored on the ledger in the
 * same transaction. Idempotent on the optional client `id`: a resend returns the original sale.
 * `GET` (scope `report:generate:all`, admin) — newest `soldAt` first; `?cursor=&limit=` (≤ 100).
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse } from '@/lib/api/errors';
import { requireScope } from '@/lib/auth/session';
import { getDb } from '@/lib/db/client';
import { listRecyclerSales, recordRecyclerSale, recyclerSaleInputSchema } from '@/lib/fraud';
import { PAGE_DEFAULT, PAGE_MAX } from '@/lib/pagination';

const querySchema = z.object({
  cursor: z.string().min(1).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(PAGE_MAX).default(PAGE_DEFAULT),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const actor = await requireScope('reconciliation:write');
    const input = recyclerSaleInputSchema.parse(await request.json().catch(() => null));
    const { sale } = await recordRecyclerSale(getDb(), input, actor.id);
    return NextResponse.json({ sale }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await requireScope('report:generate:all');
    const { cursor, limit } = querySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    return NextResponse.json(await listRecyclerSales(getDb(), { cursor, limit }));
  } catch (error) {
    return errorResponse(error);
  }
}
