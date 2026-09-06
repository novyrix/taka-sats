// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Job names + payload types for the pg-boss queue (D-10). Names are the
 * pg-boss queue names; keep them stable. Zero framework imports (D-04).
 */

import { z } from 'zod';

export const JOB_PROVISION_COLLECTOR_WALLET = 'provision-collector-wallet';

/** Every job queue the app knows about — created on boss start (pg-boss ≥10 needs this). */
export const JOB_QUEUES = [JOB_PROVISION_COLLECTOR_WALLET] as const;

export const provisionCollectorWalletPayloadSchema = z.object({
  collectorId: z.uuid(),
});
export type ProvisionCollectorWalletPayload = z.infer<typeof provisionCollectorWalletPayloadSchema>;
