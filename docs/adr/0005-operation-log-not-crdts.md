# ADR-0005: Operation log with idempotent events, not full CRDTs

**Status:** Accepted (ported from Technical Architecture §9 ADR-004)

## Context

Collection events are append-only facts, not collaboratively-edited shared documents - the
classic CRDT use case (concurrent edits to the same mutable object) barely applies.

## Decision

Use a client-generated UUID v4 per event as an idempotency key. The sync endpoint upserts by
UUID: a resent event is a no-op returning the original result, never a duplicate or a silent
drop. For the smaller surface of genuinely mutable shared state (collector profiles, rate
tables) use last-write-wins by timestamp plus an `anomaly_flags` row when two writes land
suspiciously close together.

## Consequences

Meaningfully simpler to build, test, and reason about than Automerge/Yjs. Revisit if a future
feature (e.g. collaborative session planning) introduces real concurrent-document editing.

## Related

REQUIREMENTS §10.3, FR-4.2; ADR-0004.
