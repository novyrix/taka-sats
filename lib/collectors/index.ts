// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Collector identity and tag lifecycle (§7, ROADMAP M1). Framework-free
 * (D-04): callers pass a Drizzle `Database` and (where needed) a
 * `LightningProvider`, so these functions are usable from a route handler, a
 * worker job, or a test with no HTTP layer involved.
 */

export { attachByoAddress } from './address';
export { enrolCollector } from './enrol';
export {
  CollectorNotFoundError,
  ProvisioningDisabledError,
  TagAlreadyActiveError,
  TagRevokedError,
} from './errors';
export {
  findCollectorById,
  listActiveCollectors,
  searchCollectorsByAlias,
  type CollectorSummary,
} from './lookup';
export {
  findActiveTagMapping,
  isTagRevoked,
  recordRevokedTapAttempt,
  reissueTag,
  revokeTag,
  type ActiveTagMapping,
} from './tags';
export {
  addressSourceSchema,
  attachByoAddressInputSchema,
  enrolCollectorInputSchema,
  reissueTagInputSchema,
  revokeTagInputSchema,
  type AddressSource,
  type AttachByoAddressInput,
  type CollectorRecord,
  type EnrolCollectorInput,
  type ReissueTagInput,
  type RevokeTagInput,
  type TagHistoryRecord,
} from './types';
