// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Reconciliation (FR-3.5) and anomaly detection (FR-3.6). Detectors and the reconciliation run
 * WRITE `anomaly_flags`; nothing here ever blocks a sync or a payout (ADR-0006). Framework-free
 * apart from Drizzle (D-04); server only.
 */

export {
  ANOMALY_STATUSES,
  getAnomaly,
  listAnomalies,
  reviewAnomaly,
  reviewInputSchema,
  type AnomalyFilter,
  type AnomalyPage,
  type AnomalyView,
} from './anomalies';
export {
  detectPayoutConcentration,
  MIN_COLLECTORS_FOR_CONCENTRATION,
  type ConcentrationResult,
} from './concentration';
export {
  detectDuplicatePhoto,
  detectGpsOutlier,
  detectIdenticalWeightRepeat,
  detectWeightOutlier,
  runEventDetectors,
} from './detectors';
export { AnomalyNotFoundError, AnomalyReviewError } from './errors';
export { raiseFlag, type NewFlag } from './flags';
export {
  computeReconciliation,
  listReconciliationReports,
  reconciliationPeriodSchema,
  runReconciliation,
  toReportView,
  toRowView,
  type ReconciliationPeriod,
  type ReconciliationRow,
  type ReconciliationStatus,
  type ReportPage,
  type ReportView,
} from './reconciliation';
export {
  listRecyclerSales,
  recordRecyclerSale,
  recyclerSaleInputSchema,
  type RecyclerSaleInput,
  type RecyclerSalePage,
  type RecyclerSaleView,
} from './recycler-sales';
