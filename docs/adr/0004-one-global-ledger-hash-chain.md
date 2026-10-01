# ADR-0004: One global `ledger_entries` hash chain

**Status:** Accepted (ports Technical Architecture §9 ADR-003a; records D-13)

## Context

v1.0 put `prev_record_hash`/`record_hash` on each event row. Multiple supervisors recording
offline on separate devices cannot know the latest hash to chain onto, and payouts and
treasury movements also need to be in the tamper-evident record.

## Decision

One append-only `ledger_entries` table is the canonical chain. The client computes a content
hash per fact at capture; the server assigns a monotonic `seq` and links `prev_entry_hash` at
ingestion, then computes `entry_hash`. `collection_events` / `payouts` / `treasury_topups`
become detail tables linked by `ledger_entry_id`. `UPDATE`/`DELETE` on `ledger_entries` is
revoked at the DB role level — corrections are new linked rows. Periodic `ledger_checkpoints`
are signed and optionally Nostr/OpenTimestamps-anchored. `scripts/verify-ledger.ts` and
`GET /api/v1/ledger/verify` let any auditor check the chain.

## Consequences

A single, simple artifact to hand a funder or auditor. Ordering is by server ingestion, not
device clock — honest about what the server can attest. The client/server canonical
serialisation must match byte-for-byte (one shared implementation, tested both sides).

## Related

REQUIREMENTS §11, D-13/D-19; ADR-0005.
