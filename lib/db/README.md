# lib/db

Drizzle schema and the typed client (D-08, M0-6).

## Migration convention

- Every migration hand-writes a working `down` (Code Style Guide §8).
- No destructive production migration without a reviewed backup step.
- `ledger_entries` has `UPDATE`/`DELETE` revoked at the DB role level (M4-1); corrections are new linked rows.
