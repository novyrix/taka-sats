// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Job names + payload types for the pg-boss queue (D-10). Names are the
 * pg-boss queue names; keep them stable. Zero framework imports (D-04).
 */

import { z } from 'zod';

export const JOB_PROVISION_COLLECTOR_WALLET = 'provision-collector-wallet';
export const JOB_REFRESH_EXCHANGE_RATE = 'refresh-exchange-rate';
export const JOB_CREATE_LEDGER_CHECKPOINT = 'create-ledger-checkpoint';
export const JOB_VALIDATE_COLLECTOR_DESTINATION = 'validate-collector-destination';
export const JOB_PROCESS_PAYOUT = 'process-payout';
export const JOB_SWEEP_PAYOUTS = 'sweep-payouts';
export const JOB_CONFIRM_TREASURY_TOPUPS = 'confirm-treasury-topups';

/** Every job queue the app knows about — created on boss start (pg-boss ≥10 needs this). */
export const JOB_QUEUES = [
  JOB_PROVISION_COLLECTOR_WALLET,
  JOB_REFRESH_EXCHANGE_RATE,
  JOB_CREATE_LEDGER_CHECKPOINT,
  JOB_VALIDATE_COLLECTOR_DESTINATION,
  JOB_PROCESS_PAYOUT,
  JOB_SWEEP_PAYOUTS,
  JOB_CONFIRM_TREASURY_TOPUPS,
] as const;

export const provisionCollectorWalletPayloadSchema = z.object({
  collectorId: z.uuid(),
});
export type ProvisionCollectorWalletPayload = z.infer<typeof provisionCollectorWalletPayloadSchema>;

export const validateCollectorDestinationPayloadSchema = z.object({
  destinationId: z.uuid(),
});
export type ValidateCollectorDestinationPayload = z.infer<
  typeof validateCollectorDestinationPayloadSchema
>;

export const processPayoutPayloadSchema = z.object({
  payoutId: z.uuid(),
});
export type ProcessPayoutPayload = z.infer<typeof processPayoutPayloadSchema>;
