// SPDX-License-Identifier: AGPL-3.0-only

/** The background job queue (D-10). Handlers run in `worker/`; the app only enqueues. */

export { enqueueProvisionCollectorWallet, getBoss, stopBoss } from './queue';
export { registerWorkers } from './register';
export {
  provisionCollectorWallet,
  type CollectorWalletProvisioner,
} from './provisionCollectorWallet';
export {
  JOB_PROVISION_COLLECTOR_WALLET,
  JOB_QUEUES,
  provisionCollectorWalletPayloadSchema,
  type ProvisionCollectorWalletPayload,
} from './types';
