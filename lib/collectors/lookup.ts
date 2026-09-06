// SPDX-License-Identifier: AGPL-3.0-only

import { desc, eq, ilike } from 'drizzle-orm';
import type { Database } from '@/lib/db/client';
import { collectors } from '@/lib/db/schema';
import type { CollectorRecord } from './types';

export async function findCollectorById(db: Database, id: string): Promise<CollectorRecord | null> {
  const [row] = await db.select().from(collectors).where(eq(collectors.id, id));
  return row ?? null;
}

/** A compact projection for the manual alias-search fallback (§7.1, G2, M1-8). */
export type CollectorSummary = Pick<CollectorRecord, 'id' | 'alias' | 'nfcTagId' | 'status'>;

/**
 * Case-insensitive substring search on `alias`, newest first, capped. The
 * fully offline version searches the PWA's cached list (M3-2/M3-3); this is
 * the online path until that lands.
 */
export async function searchCollectorsByAlias(
  db: Database,
  query: string,
  limit = 20,
): Promise<CollectorSummary[]> {
  return db
    .select({
      id: collectors.id,
      alias: collectors.alias,
      nfcTagId: collectors.nfcTagId,
      status: collectors.status,
    })
    .from(collectors)
    .where(ilike(collectors.alias, `%${query}%`))
    .orderBy(desc(collectors.enrolledAt))
    .limit(Math.min(Math.max(limit, 1), 100));
}
