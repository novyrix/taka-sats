# lib/sync

Offline-first sync engine. Framework-free apart from `idb` (D-04).

| File             | What                                                                                                                                                                                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contentHash.ts` | `canonicalize()` (deterministic JSON — sorted keys, no whitespace, dropped `undefined`) + `sha256Hex()` + `contentHash()`. The client `payload_hash` of REQUIREMENTS §11.1. Fixed-vector tested — changing the canonical form re-hashes every event. |
| `events.ts`      | `assembleCollectionEvent(draft)` → fills the client UUID v4, device-local `recordedAt`, `indicativeSats` (display only — **not** `computePayout`), and `contentHash`. `indicativeSats()` = `rateFiatMinor × kg × 1e6 / exchangeRate`, floored.       |
| `store.ts`       | `idb` wrapper. Stores: `events` (assembled events + a discriminated `SyncStatus`), `collectors` (cached for offline lookup, M3-3), `sessionConfig`, `outbox`. **Browser/worker only** — never import on the server.                                  |
| `capture.ts`     | `captureCollectionEvent(draft)` — assemble → IndexedDB write → outbox enqueue, resolving only after the write commits (M3-8: the UI shows "queued" _after_ this).                                                                                    |
| `index.ts`       | Barrel.                                                                                                                                                                                                                                              |

Still to come: the Serwist SW that drains the outbox (M3-1), the photo upload queue (M3-10), and M4's idempotent batch sync loop (queued → syncing → confirmed).
