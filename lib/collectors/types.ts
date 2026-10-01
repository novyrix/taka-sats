// SPDX-License-Identifier: AGPL-3.0-only

import type { InferSelectModel } from 'drizzle-orm';
import { z } from 'zod';
import type { Role } from '@/lib/auth/permissions';
import type {
  collectorAuthorizations,
  collectorPaymentDestinations,
  collectors,
  tagHistory,
} from '@/lib/db/schema';

export type CollectorRecord = InferSelectModel<typeof collectors>;
export type TagHistoryRecord = InferSelectModel<typeof tagHistory>;
export type CollectorAuthorizationRecord = InferSelectModel<typeof collectorAuthorizations>;
export type DestinationRecord = InferSelectModel<typeof collectorPaymentDestinations>;

/** The staff member performing a collector operation (resolved by the route from the session). */
export type CollectorActor = { readonly id: string; readonly role: Role };

export const COLLECTOR_STATUSES = ['pending', 'active', 'revoked'] as const;
export type CollectorStatus = (typeof COLLECTOR_STATUSES)[number];

export const DESTINATION_STATUSES = [
  'pending_validation',
  'verified',
  'invalid',
  'revoked',
] as const;
export type DestinationStatus = (typeof DESTINATION_STATUSES)[number];

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
  /** Site segment of the public code (`KBR` in `TS-KBR-0042`); falls back to config. */
  siteCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2,6}$/, 'siteCode must be 2-6 letters')
    .optional(),
});
export type EnrolCollectorInput = z.infer<typeof enrolCollectorInputSchema>;

export const attachDestinationInputSchema = z.object({
  collectorId: z.uuid(),
  /** The raw scanned/submitted payload — a Lightning Address, LNURL, or QR text. */
  rawCode: z.string().trim().min(1).max(2000),
});
export type AttachDestinationInput = z.infer<typeof attachDestinationInputSchema>;

export const authorizationDecisionSchema = z.enum(['authorize', 'revoke']);
export type AuthorizationDecisionInput = z.infer<typeof authorizationDecisionSchema>;

export const reissueTagInputSchema = z.object({
  collectorId: z.uuid(),
  newTagId: z.string().trim().min(1),
});
export type ReissueTagInput = z.infer<typeof reissueTagInputSchema>;

export const revokeTagInputSchema = z.object({
  tagId: z.string().trim().min(1),
});
export type RevokeTagInput = z.infer<typeof revokeTagInputSchema>;
