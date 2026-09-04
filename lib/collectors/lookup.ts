// SPDX-License-Identifier: AGPL-3.0-only

import { eq } from 'drizzle-orm';
import type { Database } from '@/lib/db/client';
import { collectors } from '@/lib/db/schema';
import type { CollectorRecord } from './types';

export async function findCollectorById(db: Database, id: string): Promise<CollectorRecord | null> {
  const [row] = await db.select().from(collectors).where(eq(collectors.id, id));
  return row ?? null;
}
