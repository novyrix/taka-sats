# lib/ledger

The one global append-only hash chain (D-13, REQUIREMENTS §11). Auditor's guide:
[`docs/LEDGER.md`](../../docs/LEDGER.md). Framework-free apart from Drizzle (D-04); server only.

- `chain.ts` — **pure** (no DB): `entryHashInput` / `computeEntryHash` (the frozen
  `sha256( seq | entry_type | payload_hash | prev_entry_hash )`, `GENESIS` at `seq 1`) and
  `verifyEntries(rows, anchor?)`, which recomputes a run of entries and reports the first break.
- `index.ts` — the DB side: `appendEntry` / `appendEntryTx` (advisory-locked `seq` + link),
  `payloadHash` (the SAME canonicalize the PWA uses), `latestEntry` / `entryBySeq` /
  `listEntries` / `pageEntries` (keyset paging for `GET /ledger`), `verifyChain(db)`.
- `signing.ts` — Ed25519 over `<through_seq>|<entry_hash>` with `node:crypto`: key from the
  `LEDGER_SIGNING_KEY` env seed, `signCheckpoint`, `verifyCheckpointSignature`,
  `verifyCheckpoints`.
- `checkpoints.ts` — `createCheckpoint` (idempotent, advisory-locked), `pageCheckpoints`,
  `verifyLedger(db, { mode: 'full' | 'windowed', publicKey })`. Import from
  `@/lib/ledger/checkpoints` (not re-exported from `index`, which it imports).
- `dump.ts` — `parseDump` / `verifyDump`: verify an exported ledger with no database
  (`scripts/verify-ledger.ts`).

`UPDATE`/`DELETE` on `ledger_entries` are blocked by a trigger (migration 0006). `TRUNCATE` is
not blocked (operator reset / test isolation) — operators `REVOKE TRUNCATE` for defence in
depth. A correction is a new `entry_type = 'correction'` row with `references_id` set.
