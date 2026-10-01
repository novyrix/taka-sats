// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Collector identity and tag lifecycle (§7, ROADMAP M1). Framework-free
 * (D-04): callers pass a Drizzle `Database` and (where needed) a
 * `LightningProvider`, so these functions are usable from a route handler, a
 * worker job, or a test with no HTTP layer involved.
 */

export { decideCollectorAuthorization, type AuthorizationOutcome } from './authorization';
export {
  attachDestination,
  completeDestinationValidation,
  getLiveDestination,
  listDestinations,
  normalizeDestination,
  providerHintFor,
  revokeDestination,
  validationErrorCode,
  type AttachDestinationResult,
} from './destinations';
export { enrolCollector } from './enrol';
export {
  CollectorNotAuthorizedError,
  CollectorNotFoundError,
  CollectorNotYoursError,
  DestinationInUseError,
  DestinationNotFoundError,
  DestinationReplaceForbiddenError,
  ProvisioningDisabledError,
  TagAlreadyActiveError,
  TagRevokedError,
} from './errors';
export {
  findCollectorByCode,
  findCollectorById,
  listActiveCollectors,
  liveDestinationsFor,
  searchCollectors,
  type CollectorSearch,
  type CollectorSummary,
} from './lookup';
export {
  COLLECTOR_REF_SCHEME,
  collectorRefUrl,
  formatCollectorRef,
  formatPublicCode,
  isPublicCode,
  parseCollectorRef,
} from './reference';
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
  attachDestinationInputSchema,
  authorizationDecisionSchema,
  COLLECTOR_STATUSES,
  DESTINATION_STATUSES,
  enrolCollectorInputSchema,
  reissueTagInputSchema,
  revokeTagInputSchema,
  type AddressSource,
  type AttachDestinationInput,
  type CollectorActor,
  type CollectorRecord,
  type CollectorStatus,
  type DestinationRecord,
  type DestinationStatus,
  type EnrolCollectorInput,
  type ReissueTagInput,
  type RevokeTagInput,
  type TagHistoryRecord,
} from './types';
export {
  canSeeAddress,
  toCollectorView,
  toDestinationView,
  type CollectorView,
  type DestinationView,
} from './view';
