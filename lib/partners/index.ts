// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Reading sponsoring partners (; M7 reuses this). Partner *login*
 * is set up by `scripts/create-partner.ts` (M2-1); this is just the pickable
 * list for "which partner sponsors this session". Framework-free apart from
 * Drizzle (D-04).
 */

import { asc, eq } from 'drizzle-orm';
import type { Database } from '@/lib/db/client';
import { partners } from '@/lib/db/schema';

export type PartnerSummary = {
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
};

export async function listPartners(
  db: Database,
  filter: { readonly activeOnly?: boolean } = {},
): Promise<PartnerSummary[]> {
  const rows = await db
    .select({ id: partners.id, name: partners.name, active: partners.active })
    .from(partners)
    .where((filter.activeOnly ?? true) ? eq(partners.active, true) : undefined)
    .orderBy(asc(partners.name));
  return rows;
}
