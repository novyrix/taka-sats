// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The physical-tag lifecycle (§7.2–7.3): reissue, revoke, and the lookups the
 * PWA/API use to reject a revoked tap (M1-9 groundwork — the `anomaly_flags`
 * write itself lands with the M6-1 migration).
 */

import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from '@/lib/db/client';
import { collectors, tagHistory } from '@/lib/db/schema';
import { CollectorNotFoundError, TagAlreadyActiveError } from './errors';
import {
  type CollectorRecord,
  type ReissueTagInput,
  reissueTagInputSchema,
  type RevokeTagInput,
  revokeTagInputSchema,
  type TagHistoryRecord,
} from './types';

const UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}

/**
 * Map a new physical tag to `collectorId`. Closes every currently-active
 * mapping for that collector first — the earnings history (collection_events,
 * ledger entries) is untouched, only the tag pointer moves.
 */
export async function reissueTag(db: Database, input: ReissueTagInput): Promise<TagHistoryRecord> {
  const parsed = reissueTagInputSchema.parse(input);

  return db.transaction(async (tx) => {
    const [collector] = await tx
      .select()
      .from(collectors)
      .where(eq(collectors.id, parsed.collectorId));
    if (!collector) {
      throw new CollectorNotFoundError(parsed.collectorId);
    }

    const now = new Date();
    await tx
      .update(tagHistory)
      .set({ revokedAt: now })
      .where(and(eq(tagHistory.collectorId, parsed.collectorId), isNull(tagHistory.revokedAt)));

    try {
      const [inserted] = await tx
        .insert(tagHistory)
        .values({ collectorId: parsed.collectorId, tagId: parsed.newTagId, issuedAt: now })
        .returning();
      if (!inserted) {
        throw new Error('reissueTag: insert returned no row');
      }

      await tx
        .update(collectors)
        .set({ nfcTagId: parsed.newTagId })
        .where(eq(collectors.id, parsed.collectorId));

      return inserted;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new TagAlreadyActiveError(parsed.newTagId);
      }
      throw error;
    }
  });
}

/**
 * Revoke a tag mapping by `tagId` (never global — other collectors are
 * unaffected). A no-op if the tag has no active mapping (already revoked,
 * or never issued) — callers distinguish that case via {@link
 * findActiveTagMapping} before calling this, since "revoke a tag that
 * doesn't exist" is not itself an error worth surfacing loudly here.
 */
export async function revokeTag(
  db: Database,
  input: RevokeTagInput,
): Promise<TagHistoryRecord | null> {
  const parsed = revokeTagInputSchema.parse(input);
  const now = new Date();

  return db.transaction(async (tx) => {
    const [active] = await tx
      .select()
      .from(tagHistory)
      .where(and(eq(tagHistory.tagId, parsed.tagId), isNull(tagHistory.revokedAt)));

    if (!active) {
      return null;
    }

    const [revoked] = await tx
      .update(tagHistory)
      .set({ revokedAt: now })
      .where(eq(tagHistory.id, active.id))
      .returning();

    // Clear the collector's denormalised "current tag" only if this was it.
    await tx
      .update(collectors)
      .set({ nfcTagId: null })
      .where(and(eq(collectors.id, active.collectorId), eq(collectors.nfcTagId, parsed.tagId)));

    return revoked ?? null;
  });
}

export type ActiveTagMapping = {
  readonly collector: CollectorRecord;
  readonly tag: TagHistoryRecord;
};

/** The live collector + tag_history row for a tapped tag, or null if none is active. */
export async function findActiveTagMapping(
  db: Database,
  tagId: string,
): Promise<ActiveTagMapping | null> {
  const [row] = await db
    .select({ collector: collectors, tag: tagHistory })
    .from(tagHistory)
    .innerJoin(collectors, eq(tagHistory.collectorId, collectors.id))
    .where(and(eq(tagHistory.tagId, tagId), isNull(tagHistory.revokedAt)));

  return row ?? null;
}

/** True when `tagId` has been issued and later revoked (a "revoked tap"). */
export async function isTagRevoked(db: Database, tagId: string): Promise<boolean> {
  const rows = await db.select().from(tagHistory).where(eq(tagHistory.tagId, tagId));
  return rows.length > 0 && rows.every((row) => row.revokedAt !== null);
}
