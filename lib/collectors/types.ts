// SPDX-License-Identifier: AGPL-3.0-only

import type { InferSelectModel } from 'drizzle-orm';
import { z } from 'zod';
import type { collectors, tagHistory } from '@/lib/db/schema';

export type CollectorRecord = InferSelectModel<typeof collectors>;
export type TagHistoryRecord = InferSelectModel<typeof tagHistory>;

export const addressSourceSchema = z.enum(['byo', 'provisioned']);
export type AddressSource = z.infer<typeof addressSourceSchema>;

/**
 * §7.1: the only required field is an alias. `id` is optional client-supplied
 * idempotency (REQUIREMENTS §10.1) — resending the same `id` returns the
 * original row rather than creating a second collector.
 */
export const enrolCollectorInputSchema = z.object({
  id: z.uuid().optional(),
  alias: z.string().trim().min(1, 'alias is required').max(200),
  addressSource: addressSourceSchema.optional(),
});
export type EnrolCollectorInput = z.infer<typeof enrolCollectorInputSchema>;

export const attachByoAddressInputSchema = z.object({
  collectorId: z.uuid(),
  /** The raw scanned/submitted payload — a Lightning Address, LNURL, or QR text. */
  rawCode: z.string().trim().min(1),
});
export type AttachByoAddressInput = z.infer<typeof attachByoAddressInputSchema>;

export const reissueTagInputSchema = z.object({
  collectorId: z.uuid(),
  newTagId: z.string().trim().min(1),
});
export type ReissueTagInput = z.infer<typeof reissueTagInputSchema>;

export const revokeTagInputSchema = z.object({
  tagId: z.string().trim().min(1),
});
export type RevokeTagInput = z.infer<typeof revokeTagInputSchema>;
