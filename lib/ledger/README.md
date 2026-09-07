# lib/ledger

The one global append-only hash chain (D-13, REQUIREMENTS §11, ROADMAP M4-2).
Framework-free apart from Drizzle (D-04); server only.

- `appendEntry(db, { entryType, payloadHash, id?, referencesId?, deviceRecordedAt? })`
  — takes a per-transaction advisory lock, reads the head, assigns
  `seq = head.seq + 1`, links `prev_entry_hash`, computes `entry_hash`.
- `entry_hash = sha256( seq | entry_type | payload_hash | prev_entry_hash )`,
  `|`-joined, `prev_entry_hash` = literal `GENESIS` at `seq = 1`. Frozen —
  guarded by a fixed-vector test.
- `payloadHash(payload)` = `contentHash(payload)` from `lib/sync/contentHash` —
  the SAME canonical serialisation the PWA uses, so an offline event's client
  `content_hash` is reused verbatim as its `payload_hash`.
- `verifyChain(db)` recomputes the whole chain and reports the first broken
  link (`GET /ledger/verify`, `scripts/verify-ledger.ts` — M4-8).
- `latestEntry` / `entryBySeq` / `listEntries({ afterSeq, limit })`.

`UPDATE`/`DELETE` on `ledger_entries` are blocked by a trigger (migration
0006). `TRUNCATE` is not blocked (operator reset / test isolation) — operators
`REVOKE TRUNCATE` for defence in depth. A correction is a new
`entry_type = 'correction'` row with `references_id` set.

Still to come: `POST /api/v1/sync/events` (M4-3), the client sync loop (M4-4),
the checkpoint worker + `ledger_checkpoints` (M4-7), the read/verify API (M4-8).
