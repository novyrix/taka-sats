# ADR-0019: Weight provenance is signed at capture; verification is derived

**Status:** Accepted (records D-27)

## Context

Kilograms are what money is computed from, yet a typed number is the weakest evidence in the
system. A connected scale, OCR of the scale display, and recycler mass-balance can each raise
confidence - but none should ever overwrite what the supervisor actually captured, and none
exist yet. The event's `content_hash` is frozen by fixed-vector tests and recomputed on ingest,
so a field added to the signed payload *later* would invalidate every event already queued on
devices.

## Decision

1. The signed event payload (and so `content_hash`, `ledger_entries.payload_hash`) carries
   **weight provenance now**, even though only `manual` exists in the pilot: `weightSource`
   (`manual` | `ble_scale` | `serial_scale` | `industrial_scale`), optional `scaleId`,
   optional `scaleReadingRaw`. `weightSource` is *how the number was captured* - OCR agreement
   is not a capture source (the V2 draft's `manual_ocr_verified` is a verification result).
2. **Verification is derived data, never part of the signed event.** It lives in
   `verification_checks` (append-only), `anomaly_flags`, and `collection_events.verification_level`
   (`V0` manual … `V4` audited). An AI/OCR check returns flags and evidence; it never mutates
   the event or invents payout kilograms. The physical scale stays authoritative.
3. **`verification_level` and payout state are separate axes.** A `V1` event can be `PAID`;
   reaching `V3` later does not re-pay or claw back - repeated reconciliation problems raise hub
   and supervisor risk, not a collector debt.
4. Corrections to a weight are new linked `correction` ledger entries, as always (ADR-0014).

## Consequences

The hash contract is stable across the roadmap from manual entry to BLE scales. OCR can run
in shadow mode (record, don't flag) while its accuracy is measured. Anything about a weight that
changes after capture is a new row, so the original claim stays provable.

## Related

REQUIREMENTS D-27, §8.2; ADR-0004, ADR-0006, ADR-0014; `docs/TAKA_SATS_PROTOTYPE_ARCHITECTURE_V2.md`.
