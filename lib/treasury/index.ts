// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Treasury (M5-7, ADR-0020): the vote that refills the capped hot wallet from the
 * multisig pool. Taka Sats records proposals, approvals and outcomes in the ledger. It never
 * holds pool keys and never moves pool funds: the transfer is signed in the pool's own wallet.
 */

export {
  TopupApprovalError,
  TopupCapError,
  TopupConflictError,
  TopupFloatUnavailableError,
  TopupInputError,
  TopupNotFoundError,
  TopupStateError,
} from './errors';
export {
  getTopupView,
  getTreasuryOverview,
  listTopups,
  TOPUP_PAGE_DEFAULT,
  TOPUP_PAGE_MAX,
  type TopupPage,
  type TopupView,
  type TreasuryOverview,
} from './queries';
export {
  approveTopup,
  cancelTopup,
  confirmArrivedTopups,
  confirmTopup,
  normaliseTransferReference,
  OPEN_TOPUP_STATUSES,
  openTopupSats,
  proposeTopup,
  recordTopupTransfer,
  rejectTopup,
  TOPUP_STATUSES,
  type ConfirmOutcome,
  type FloatReader,
  type Steward,
  type TopupOutcome,
  type TopupRecord,
  type TopupStatus,
} from './topups';
