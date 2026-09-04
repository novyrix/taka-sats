# ADR-0014: Append-only ledger — corrections are new linked rows

**Status:** Accepted (records D-13; see ADR-0004 for the chain construction)

## Context

"Independently verifiable" (US-3.3) needs the record to be tamper-evident *and* simple enough
to hand a non-technical auditor.

## Decision

Collection events, payouts, corrections, and treasury movements all append to the single
`ledger_entries` chain. There is no `UPDATE` or `DELETE` — the privilege is revoked at the
database role level. A mistake is fixed by appending a new entry that references the one it
corrects. Signed checkpoints every `ledger.checkpoint_interval_entries` give external verifiers
stable anchors.

## Consequences

History is complete and monotonic. Application code and migrations must never assume they can
edit a ledger row. A correction flow (new linked entry) is required wherever data can be wrong.

## Related

REQUIREMENTS §11, D-13; ADR-0004; ROADMAP M4-1, M4-8.
