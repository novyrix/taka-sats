// SPDX-License-Identifier: AGPL-3.0-only

/** The background job queue (D-10). Handlers run in `worker/`; the app only enqueues. */

export {
  enqueueCreateLedgerCheckpoint,
  enqueueProcessPayout,
  enqueueProcessPayoutSafely,
  enqueueProvisionCollectorWallet,
  enqueueRefreshExchangeRate,
  enqueueSweepPayouts,
  enqueueValidateCollectorDestination,
  getBoss,
  stopBoss,
} from './queue';
export { registerWorkers } from './register';
export {
  provisionCollectorWallet,
  type CollectorWalletProvisioner,
} from './provisionCollectorWallet';
export { createLedgerCheckpoint } from './createLedgerCheckpoint';
export { enqueuePayoutsAwaitingDestination, processPayoutJob, sweepPayouts } from './processPayout';
export { refreshExchangeRate } from './refreshExchangeRate';
export {
  JOB_CREATE_LEDGER_CHECKPOINT,
  JOB_PROCESS_PAYOUT,
  JOB_PROVISION_COLLECTOR_WALLET,
  JOB_QUEUES,
  JOB_REFRESH_EXCHANGE_RATE,
  JOB_SWEEP_PAYOUTS,
  JOB_VALIDATE_COLLECTOR_DESTINATION,
  processPayoutPayloadSchema,
  provisionCollectorWalletPayloadSchema,
  validateCollectorDestinationPayloadSchema,
  type ProcessPayoutPayload,
  type ProvisionCollectorWalletPayload,
  type ValidateCollectorDestinationPayload,
} from './types';
