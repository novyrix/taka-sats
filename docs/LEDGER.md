# The ledger - an auditor's guide

Taka Sats keeps one **global, append-only, hash-chained ledger** (D-13). Every money- or
trust-relevant fact - a weighed collection, a payout, a correction, a treasury top-up, a rate
change, a tag revocation - becomes one row in `ledger_entries`. This document explains how the
chain is built, how it is protected, and how a person with no access to our systems can check
it. Source of truth for the design: [`REQUIREMENTS.md` §11](REQUIREMENTS.md). Code:
`lib/ledger/`.

## What a ledger row holds

Only ids, hashes and timestamps - never a collector's alias, phone, Lightning address, GPS
position or amount. The detail lives in tables (`collection_events`, …) that point back at the
row; the ledger carries a hash that commits to them.

| Field | Meaning |
|---|---|
| `id` | UUID. For a collection event it is the **client-generated** UUID the supervisor's phone minted offline. |
| `seq` | Server-assigned, starts at 1, +1 per entry, no gaps. The order is **server ingestion order**, not device clock. |
| `entry_type` | `collection_event`, `payout`, `correction`, `treasury_topup`, `rate_change`, `tag_revocation` (and any later type listed in `lib/ledger/index.ts`). A `treasury_topup` is one step of the pool-to-hot-wallet funding vote (proposed, an approval, transfer recorded, confirmed, rejected or cancelled); its hashed payload names the `event`, the proposal id and the steward, never a key or an address. |
| `payload_hash` | SHA-256 (hex) of the canonical JSON of the fact. For an offline collection event this is the phone's own `content_hash`, computed before the event ever reached us. |
| `prev_entry_hash` | The previous row's `entry_hash`; `NULL` at `seq = 1`. |
| `entry_hash` | The link, defined below. |
| `references_id` | For a `correction`: the id of the entry it supersedes. |
| `created_at` / `device_recorded_at` | Server ingestion time / the device's original capture time, if offline-origin. |

## The hash

```
entry_hash = SHA-256( seq | entry_type | payload_hash | prev_entry_hash )
```

The four values are joined with a literal `|` and hashed as UTF-8; the result is lowercase hex.
`seq` is its decimal text; `prev_entry_hash` is the literal word `GENESIS` for `seq = 1`.
Every field is a fixed word, a decimal integer or 64 hex characters, so the delimiter is
unambiguous. This form is frozen by a fixed-vector test - it will not change under you.

Worked example (reproducible with any SHA-256 tool):

```sh
printf '1|collection_event|aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa|GENESIS' | sha256sum
# 473d29a5857ea2150f147e4de0c01dcdd9ce6a8f9614d4712ae5e5fc36a8fc63
```

Because each `entry_hash` includes the previous one, changing, removing, inserting or
reordering any row changes every hash after it.

### `payload_hash`

The SHA-256 of a **canonical** JSON serialisation: object keys sorted lexicographically at
every depth, no insignificant whitespace, arrays in order, `undefined` members omitted. The
phone and the server use the *same* function (`lib/sync/contentHash.ts`), so the hash a
phone computed at capture is, byte for byte, the hash in the chain. If a submitted event's
fields do not recompute to its `content_hash`, the server refuses it (`needs_attention`).

## Append-only, by construction

1. **At the database.** A trigger (`ledger_entries_immutable()`, migration `0006`) raises an
   error on any `UPDATE` or `DELETE` of `ledger_entries`, whatever role is connected - so it
   holds on managed Postgres. A correction is a *new* `correction` row whose `references_id`
   names the entry it supersedes; nothing is edited. `TRUNCATE` is not blocked by the
   trigger (operator reset, test isolation); production operators should
   `REVOKE TRUNCATE ON ledger_entries FROM <app_role>`.
2. **At append time.** `appendEntry` takes a Postgres advisory lock for the transaction,
   reads the head, sets `seq = head.seq + 1` and `prev_entry_hash = head.entry_hash`, computes
   `entry_hash` and inserts - so concurrent writers cannot fork or skip the chain. `UNIQUE (seq)`
   is the backstop. A collection event's ledger row and its `collection_events` row are
   written in one transaction.

## Checkpoints

A **checkpoint** pins the chain at a moment. It is a row in `ledger_checkpoints`:

| Field | Meaning |
|---|---|
| `through_seq` | The head `seq` when the checkpoint was made. |
| `entry_hash` | The `entry_hash` of that entry. |
| `signature` | Ed25519 signature (base64) by the programme key. |
| `created_at` | When it was signed. |
| `nostr_event_id`, `opentimestamps` | Reserved for the optional public anchors; not populated yet. |

The signed message is the UTF-8 string `<through_seq>|<entry_hash>` - for example
`3|aaaaaaaa…` (64 hex chars). A checkpoint over seq 1…N therefore commits the key holder to
the whole prefix, since `entry_hash` already commits to every earlier link.

### Producing them

The worker runs the `create-ledger-checkpoint` job on `ledger.checkpoint_cron` (default
hourly). Each run signs the current head, **unless** the ledger is empty, the head is already
checkpointed, or fewer than `ledger.checkpoint_interval_entries` new entries exist since the
last checkpoint. It is idempotent - an advisory lock plus the check mean two runs never write
two checkpoints for one `through_seq`. On Vercel the Cron bridge
(`/api/v1/internal/jobs/enqueue`) enqueues the same job.

Settings (see [`CONFIGURATION.md`](CONFIGURATION.md)): `ledger.checkpoint_enabled`,
`ledger.checkpoint_cron`, `ledger.checkpoint_interval_entries`. For a low-volume pilot lower
the interval (even to `1`) so a checkpoint exists soon after the first collections.

### The signing key

- **Secret:** `LEDGER_SIGNING_KEY` - the base64 encoding of a 32-byte Ed25519 *seed*.
  Environment only; never in TOML, never logged or returned by an API.
  `openssl rand -base64 32` generates one. If it is unset the job logs a warning and signs
  nothing; if malformed it fails loudly.
- **Public key:** the raw 32-byte key, base64. The app serves it at
  `GET /api/v1/ledger/checkpoints` (`publicKey`). **Pin it out of band** (publish it in the
  programme's repository / website / a signed announcement) - a verifier who takes the key from
  the same server it is auditing learns only that the data is self-consistent.
- **Back it up.** Losing the seed does not break old checkpoints, but you can no longer extend
  the signed history under the same key.
- **Rotation / compromise.** Generate a new seed, deploy it, and announce the new public key
  and the `through_seq` from which it applies. Old checkpoints remain valid under the old
  public key - keep it published. If the key is believed compromised, announce the last
  trustworthy `through_seq`; checkpoints made with the compromised key after that are not to
  be relied on. (A key-rotation entry type in the chain itself is a possible later step.)

## Reading and verifying through the API

All three endpoints need the `ledger:read` scope (admin only). See
[`REQUIREMENTS.md` §10](REQUIREMENTS.md) for the surface.

| Endpoint | Returns |
|---|---|
| `GET /api/v1/ledger?cursor=&limit=&order=` | A page of entries, keyset-paginated on `seq`. `nextCursor` is `null` on the last page. |
| `GET /api/v1/ledger/checkpoints?cursor=&limit=` | Checkpoints newest first, plus `publicKey`. |
| `GET /api/v1/ledger/verify?mode=full\|windowed` | `{ ok: true, mode, count, throughSeq, headHash, checkpoints: { verified, signaturesChecked } }`, or `{ ok: false, mode, brokenAt, reason }`. |

`windowed` starts from the latest checkpoint (trusting its signature and its `entry_hash`) and
recomputes only the entries after it - fast on a large ledger. `full` recomputes from genesis.

## Verifying yourself, without trusting the server

### With the script

Page `GET /api/v1/ledger` from `cursor` 0 to the end (and `GET /api/v1/ledger/checkpoints`),
or ask the operator for an export (`pnpm exec tsx scripts/verify-ledger.ts --export ledger.json`).
Accepted shapes: `{ "entries": [...], "checkpoints": [...], "publicKey": "..." }`, a bare JSON
array of entries and checkpoints, or NDJSON (one entry or checkpoint per line); field names are
the API's camelCase or the table's snake_case.

```sh
git clone <the repository> && cd taka-sats && pnpm install
pnpm exec tsx scripts/verify-ledger.ts ledger.json --public-key <the pinned base64 key>
```

Exit code `0` = verified, `1` = failed verification (the first broken `seq` and reason are
printed), `2` = bad usage or unreadable input. The script reads nothing but the file.

The operator can also run it against the live database: `pnpm exec tsx scripts/verify-ledger.ts`
(uses `DATABASE_URL`; add `--windowed` to start from the last checkpoint).

### By hand

1. For each entry in `seq` order: check `seq` is exactly one more than the previous; check
   `prev_entry_hash` equals the previous `entry_hash` (`NULL` at `seq 1`); recompute
   `entry_hash` with the formula above and compare.
2. For each checkpoint: check `entry_hash` equals the chain's `entry_hash` at `through_seq`
   (a `through_seq` beyond the last entry means entries were cut off the end), then check
   the signature against your pinned public key:

```sh
node -e '
const { createPublicKey, verify } = require("node:crypto");
const [pub, seq, hash, sig] = process.argv.slice(1);
const key = createPublicKey({
  key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(pub, "base64")]),
  format: "der", type: "spki",
});
console.log(verify(null, Buffer.from(`${seq}|${hash}`), key, Buffer.from(sig, "base64")));
' "<public key base64>" <through_seq> <entry_hash> "<signature base64>"
```

It prints `true` for a valid signature. The long hex string is the fixed DER header that
wraps a raw Ed25519 public key.

## A proof pack for one session

`pnpm proof:pack --session <id> --out <folder>` writes the ledger export, its checkpoints and public
key, the verification result, a spreadsheet of the session's collections (collector public codes
only) and a manifest of file hashes, with a README on how to re-verify. See
[`VERIFICATION.md`](VERIFICATION.md). The ledger part is the same file format `verify-ledger.ts`
accepts, so the pack can be checked with no database.

## What this proves - and what it does not

**Proves** (given a pinned public key):

- The chain has not been edited, reordered, truncated or had entries removed or inserted
  since a checkpoint covering that position was signed - any such change breaks a hash or a
  checkpoint.
- A fact recorded offline on a phone is the one in the ledger: its `payload_hash` equals the
  `content_hash` the device computed, and the server refused anything that did not recompute.
- Entries after the last checkpoint are internally consistent (their links verify), though
  not yet vouched for by a signature.

**Does not prove:**

- That a recorded fact is *true* - that the material was really weighed, or the supervisor
  honest. The ledger makes records tamper-evident, not correct; the photo hash, GPS,
  anomaly flags and reconciliation exist for that.
- That the operator could not sign a *different* history. The key holder can produce a
  new chain and re-sign it. What defeats that is publishing checkpoints outside the
  operator's control (Nostr / OpenTimestamps anchoring, planned) and verifiers keeping their
  own copies of the checkpoints they have seen.
- That nothing was appended after the last checkpoint that should not have been. Entries past
  it are only as trustworthy as the next checkpoint.
- Anything about the contents of `collection_events` or other detail tables beyond their
  hashes - those are detail rows, not part of the chain.
