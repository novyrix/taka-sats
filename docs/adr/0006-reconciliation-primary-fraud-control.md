# ADR-0006: Reconciliation against recycler sales is the primary fraud control

**Status:** Accepted (ported from Technical Architecture §9 ADR-005)

## Context

Biometric verification measurably slowed comparable cash-transfer rollouts and risks
excluding undocumented residents - the exact population Taka Sats serves.

## Decision

Lead with structural controls (separation of duties, dual sign-off, hash-chained ledger) and
revenue-side reconciliation - `SUM(collection weight)` by material/period vs `recycler_sales`
tonnage, variance flagged above a configurable tolerance - as the primary fraud-detection
mechanism. Anomaly detectors write flags but never auto-block a payout. Biometrics are out of
scope unless reconciliation later reveals a phantom-collector problem these controls can't solve.

## Consequences

Enrolment stays frictionless (earn-first). Trade-off: reconciliation is a *detective* control
(catches fraud after the fact via variance), not a *preventive* one - accepted, because
biometric gatekeeping trades a smaller fraud-detection gain for a larger exclusion cost.
Depends on the recycler-sales data pipeline (gate G3).

## Related

REQUIREMENTS §16, FR-3.5/3.6; gate G3.
