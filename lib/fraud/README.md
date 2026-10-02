# lib/fraud

Reconciliation (FR-3.5) and anomaly detection (FR-3.6). Detectors and the reconciliation run write `anomaly_flags`; they never block a sync or a payout (ADR-0006). Framework-free (D-04).

- `detectors.ts` - per-event detectors (`duplicate_photo`, `identical_weight_repeat`, `gps_outlier`, `weight_outlier`), run by `lib/collection-events` after the ingest commit via `runEventDetectors`.
- `concentration.ts` - `payout_concentration` (Gini of per-collector paid sats in a session).
- `reconciliation.ts` - collected vs paid vs recycler kilograms, exact (milli-kg `bigint`, `kg.ts`).
- `recycler-sales.ts` - recycler sales, each anchored by a `recycler_sale` ledger entry.
- `anomalies.ts` - the review queue and verdicts.
- `stats.ts`, `geo.ts`, `kg.ts` - pure helpers (median/MAD, Gini, point-in-polygon, exact kilogram maths).
