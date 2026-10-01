// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Payouts (ROADMAP M5, REQUIREMENTS §10.4): one row per collection event, driven to
 * `paid` by {@link processPayout}. Framework-free apart from Drizzle (D-04): callers pass a
 * `Database` and a `LightningProvider`, so the same code runs from a worker job, a route
 * handler or a test. There is no function here that accepts a destination — it is always
 * resolved from the collector's verified payment destination (§12.3).
 */

export {
  PayoutApprovalError,
  PayoutCursorError,
  PayoutNotFoundError,
  PayoutResolveError,
  PayoutStateError,
} from './errors';
export {
  checkPayout,
  resolvePayout,
  type PayoutCheck,
  type ResolvePayoutInput,
  type ResolvePayoutResult,
} from './resolve';
export {
  approvePayout,
  createPayoutForEvent,
  flagStaleSendingPayouts,
  PAYOUT_STATUSES,
  payoutIdsAwaitingDestination,
  processPayout,
  retryPayout,
  sweepablePayoutIds,
  type PayoutRecord,
  type PayoutStatus,
} from './process';
export {
  getPayoutView,
  listPayouts,
  PAYOUT_PAGE_DEFAULT,
  PAYOUT_PAGE_MAX,
  payoutSummary,
  type PayoutFilter,
  type PayoutPage,
  type PayoutSummary,
  type PayoutView,
} from './queries';
