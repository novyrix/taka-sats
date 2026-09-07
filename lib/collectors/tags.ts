// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The physical-tag lifecycle (§7.2–7.3): reissue, revoke, the lookups the
 * PWA/API use to resolve a tap, and the revoked-tap logging (M1-9).
 */

import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from '@/lib/db/client';
import { isUniqueViolation } from '@/lib/db/pg-errors';
import { anomalyFlags, collectors, tagHistory } from '@/lib/db/schema';
import { CollectorNotFoundError, TagAlreadyActiveError } from './errors';
import {
  type CollectorRecord,
  type ReissueTagInput,
  reissueTagInputSchema,
  type RevokeTagInput,
  revokeTagInputSchema,
  type TagHistoryRecord,
} from './types';

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

    // Resending the same reissue request is a no-op (REQUIREMENTS §10.1).
    if (collector.nfcTagId === parsed.newTagId) {
      const [current] = await tx
        .select()
        .from(tagHistory)
        .where(and(eq(tagHistory.collectorId, parsed.collectorId), isNull(tagHistory.revokedAt)));
      if (current) {
        return current;
      }
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

/**
 * Log an attempt to use a revoked tag (§7.3, FR-1.4, M1-9). Writes an
 * `anomaly_flags` row for human review — it never blocks anything by itself.
 */
export async function recordRevokedTapAttempt(db: Database, tagId: string): Promise<void> {
  await db.insert(anomalyFlags).values({
    flagType: 'revoked_tag_tap',
    context: { tagId },
    detectedAt: new Date(),
  });
}
