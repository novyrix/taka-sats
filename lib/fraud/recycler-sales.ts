// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Recycler sales (FR-3.5, gate G3): what a buyer accepted from the programme. The net
 * `weightKg` is computed here (gross − tare, in exact milli-kg) and is the figure
 * reconciliation compares against. A sale is trust-relevant evidence, so it is anchored on the
 * ledger (`recycler_sale`) in the SAME transaction as its row — no unanchored sale exists.
 */

import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '@/lib/db/client';
import { isUniqueViolation } from '@/lib/db/pg-errors';
import { ledgerEntries, recyclerSales } from '@/lib/db/schema';
import { appendEntryTx, payloadHash } from '@/lib/ledger';
import { decodeCursor, encodeCursor, PAGE_DEFAULT, PAGE_MAX } from '@/lib/pagination';
import { fromMilli, toMilli } from './kg';

/** Capacity of `numeric(9, 3)`. */
const MAX_SALE_KG = 999_999.999;

const kgField = z
  .number()
  .max(MAX_SALE_KG)
  .refine((kg) => Number(kg.toFixed(3)) === kg, 'at most 3 decimals');

export const recyclerSaleInputSchema = z
  .object({
    id: z.uuid().optional(),
    material: z.string().trim().min(1).max(64),
    grossKg: kgField.refine((kg) => kg > 0, 'grossKg must be positive'),
    tareKg: kgField.refine((kg) => kg >= 0, 'tareKg cannot be negative').default(0),
    buyer: z.string().trim().min(1).max(200),
    soldAt: z.coerce.date(),
    pricePerKgFiatMinor: z.number().int().nonnegative().optional(),
    /** The receipt's total as entered — never computed from price × weight. */
    totalFiatMinor: z.number().int().nonnegative().optional(),
    receiptSha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
  })
  .refine((v) => v.tareKg <= v.grossKg, {
    message: 'tareKg cannot exceed grossKg',
    path: ['tareKg'],
  });
export type RecyclerSaleInput = z.infer<typeof recyclerSaleInputSchema>;

export type RecyclerSaleView = {
  readonly id: string;
  readonly material: string;
  readonly grossKg: number;
  readonly tareKg: number;
  /** Net accepted weight, gross − tare. */
  readonly weightKg: number;
  readonly buyer: string;
  readonly pricePerKgFiatMinor: number | null;
  readonly totalFiatMinor: number | null;
  readonly soldAt: Date;
  readonly receiptSha256: string | null;
  readonly receiptPath: string | null;
  readonly enteredBy: string;
  readonly ledgerSeq: number;
  readonly createdAt: Date;
};

const columns = {
  sale: recyclerSales,
  ledgerSeq: ledgerEntries.seq,
  soldAtExact: sql<string>`${recyclerSales.soldAt}::text`,
} as const;

function toView({
  sale,
  ledgerSeq,
}: {
  sale: typeof recyclerSales.$inferSelect;
  ledgerSeq: number;
}) {
  return {
    id: sale.id,
    material: sale.material,
    grossKg: Number(sale.grossKg),
    tareKg: Number(sale.tareKg),
    weightKg: Number(sale.weightKg),
    buyer: sale.buyer,
    pricePerKgFiatMinor: sale.pricePerKgFiatMinor,
    totalFiatMinor: sale.totalFiatMinor,
    soldAt: sale.soldAt,
    receiptSha256: sale.receiptSha256,
    receiptPath: sale.receiptSha256 ? `/api/v1/photos/${sale.receiptSha256}` : null,
    enteredBy: sale.enteredBy,
    ledgerSeq,
    createdAt: sale.createdAt,
  } satisfies RecyclerSaleView;
}

async function findSale(db: Database, id: string): Promise<RecyclerSaleView | null> {
  const [row] = await db
    .select(columns)
    .from(recyclerSales)
    .innerJoin(ledgerEntries, eq(ledgerEntries.id, recyclerSales.ledgerEntryId))
    .where(eq(recyclerSales.id, id));
  return row ? toView(row) : null;
}

/**
 * Record a sale. Idempotent on the optional client `id`: resending returns the original sale
 * (`created: false`) and writes nothing — a retried request cannot double a sale.
 */
export async function recordRecyclerSale(
  db: Database,
  input: RecyclerSaleInput,
  enteredBy: string,
): Promise<{ readonly sale: RecyclerSaleView; readonly created: boolean }> {
  const id = input.id ?? randomUUID();
  const existing = input.id ? await findSale(db, id) : null;
  if (existing) {
    return { sale: existing, created: false };
  }

  const grossMilli = toMilli(input.grossKg);
  const tareMilli = toMilli(input.tareKg);
  const net = {
    grossKg: fromMilli(grossMilli),
    tareKg: fromMilli(tareMilli),
    weightKg: fromMilli(grossMilli - tareMilli),
  };
  const receiptSha256 = input.receiptSha256 ?? null;
  const hash = await payloadHash({
    id,
    material: input.material,
    ...net,
    buyer: input.buyer,
    soldAt: input.soldAt.toISOString(),
    receiptSha256,
    enteredBy,
  });

  try {
    await db.transaction(async (tx) => {
      const entry = await appendEntryTx(tx, {
        entryType: 'recycler_sale',
        id,
        payloadHash: hash,
      });
      await tx.insert(recyclerSales).values({
        id,
        material: input.material,
        ...net,
        buyer: input.buyer,
        pricePerKgFiatMinor: input.pricePerKgFiatMinor ?? null,
        totalFiatMinor: input.totalFiatMinor ?? null,
        soldAt: input.soldAt,
        receiptSha256,
        enteredBy,
        ledgerEntryId: entry.id,
      });
    });
  } catch (error) {
    // A concurrent resend of the same id won the race.
    const raced = isUniqueViolation(error) ? await findSale(db, id) : null;
    if (raced) {
      return { sale: raced, created: false };
    }
    throw error;
  }
  const sale = await findSale(db, id);
  if (!sale) {
    throw new Error('recordRecyclerSale: sale not readable after insert');
  }
  return { sale, created: true };
}

export type RecyclerSalePage = {
  readonly sales: RecyclerSaleView[];
  readonly nextCursor: string | null;
};

/** Sales, newest `sold_at` first, keyset-paginated. */
export async function listRecyclerSales(
  db: Database,
  { cursor, limit = PAGE_DEFAULT }: { cursor?: string | undefined; limit?: number } = {},
): Promise<RecyclerSalePage> {
  const size = Math.min(Math.max(limit, 1), PAGE_MAX);
  const conditions: SQL[] = [];
  if (cursor) {
    const after = decodeCursor(cursor);
    conditions.push(
      sql`(${recyclerSales.soldAt}, ${recyclerSales.id}) < (${after.ts}::timestamptz, ${after.id}::uuid)`,
    );
  }
  const rows = await db
    .select(columns)
    .from(recyclerSales)
    .innerJoin(ledgerEntries, eq(ledgerEntries.id, recyclerSales.ledgerEntryId))
    .where(and(...conditions))
    .orderBy(desc(recyclerSales.soldAt), desc(recyclerSales.id))
    .limit(size + 1);

  const page = rows.slice(0, size);
  const last = page[page.length - 1];
  return {
    sales: page.map(toView),
    nextCursor: rows.length > size && last ? encodeCursor(last.soldAtExact, last.sale.id) : null,
  };
}
