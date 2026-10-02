# Security Policy

Taka Sats moves real money for people with little margin for error. Security reports are
welcome and taken seriously.

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

- Preferred: open a private advisory at
  <https://github.com/novyrix/taka-sats/security/advisories/new>.
- Or email **security@afribit.africa** with enough detail to reproduce.

You will get an acknowledgement within **3 working days** and a substantive response within
**10 working days** with an assessment and a remediation timeline. We will credit you in
the advisory unless you ask us not to. Please give us a reasonable window to ship a fix
before any public disclosure.

## Scope

In scope: the payout path, the BYO Lightning-address validation, the RBAC/permission
enforcement, the append-only ledger and its verification, the sync endpoint's idempotency
and validation, API-key scoping and PII filtering, and secret handling.

Out of scope: findings that require a compromised operator device or database, denial of
service from unrealistic request volume, and issues in third-party services (Blink, LNbits,
Neon, Vercel, relays) — report those upstream.

## Supported versions

Pre-1.0. Only `main` is supported; fixes land there.

## Security properties this codebase maintains

These are the invariants a review should re-check. A change that touches the code enforcing
one of them must say so (see "Notes" below).

| Property                                                                                                                                | Where enforced                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| No human role (`supervisor`, `hub_lead`, `admin`) can execute or direct a payout                                                        | `lib/auth/permissions.ts` — `payout:execute` in no role; `permissions.test.ts`                                                   |
| A payout destination is never taken from client input — always the collector's `verified` destination, resolved server-side             | `lib/payouts/process.ts` (no address parameter); the payout API has no `destination` field and returns no address                |
| Only an authorized (`active`) collector can be weighed, issued an NFC tag, or paid; each authorize/revoke is a ledger-anchored row      | `lib/collectors/authorization.ts`, ingest (`collector_not_authorized`), `reissueTag`, payout worker; scope `collector:authorize` |
| A wallet card's Pay QR (a spend link) is rejected before any network call and is never stored, logged, or echoed                        | `lib/lightning/lnurl.ts` (`lightning.spend_link_hosts`), `lib/collectors/destinations.ts`                                        |
| An address is live for at most one collector; replacing a verified destination is staff-only                                            | partial unique indexes (migration 0008), `attachDestination` (`collector:authorize`)                                             |
| Weight provenance is signed with the event (`weightSource`, scale fields); later verification is derived data and never edits the event | `lib/sync/events.ts:collectionEventPayload`, frozen vectors in `lib/sync/events.test.ts`                                         |
| Exactly one function does sats arithmetic for a payout                                                                                  | `lib/money.ts:computePayoutDetail` (`computePayout` wraps it)                                                                    |
| A BYO address is validated receive-capable before it is stored or written to a tag; a withdraw (`LNURLw`) code is rejected              | `LightningProvider.resolveReceiveAddress` (M1-2, M1-10)                                                                          |
| `ledger_entries` is append-only — a DB trigger blocks `UPDATE`/`DELETE` (any role); corrections are new linked rows; the chain verifies | migration 0006 (`ledger_entries_immutable()`), `lib/ledger/` (`appendEntry`, `verifyChain`)                                      |
| Ledger checkpoints are Ed25519-signed with an environment-only key (never returned or logged); the whole ledger is `admin`-read-only    | `lib/ledger/{signing,checkpoints}.ts`, `LEDGER_SIGNING_KEY`; scope `ledger:read`                                                 |
| Above-threshold payouts (and a destination's first payout) require a second, distinct approver; self-approval is refused                | `lib/payouts/process.ts` (`approvePayout`, `processPayout`), scope `payout:approve`                                              |
| A payout is never sent twice; an unknown outcome is flagged for a human, never retried automatically                                    | `lib/payouts/process.ts` (conditional-UPDATE claim before `pay`, `payout_uncertain`), UNIQUE `payouts.collection_event_id`       |
| A hot-wallet top-up needs a vote: a proposer never approves their own, each approver counts once; no pool key is held                   | `lib/treasury/`; trigger `treasury_topup_signoff_guard` + UNIQUE (topup, approver), migration 0011; scopes `treasury:*` (admin)  |
| A payout will not run against an exchange rate older than the configured TTL                                                            | `lib/payouts/process.ts` (`requireFreshRate`), `lib/money.ts` (`computePayoutDetail` re-checks)                                  |
| Secrets (DB URL, provider keys, `AUTH_SECRET`, Nostr key) live in the environment only — never in `config/*.toml`, client code, or logs | `lib/config/` (schema rejects them), structured-logging allow-list                                                               |
| `partner` / `public:read` responses carry no collector PII or individual payout amounts                                                 | central response serialiser (M7-4) + contract tests (M7-12)                                                                      |
| Every `/api/v1` route is deny-by-default: no session → 401, wrong role → 403, before the handler body runs                              | `lib/auth/session.ts:requireScope`; `session.test.ts`, `app/api/v1/**/*.test.ts`                                                 |
| Passwords are never stored or logged in plaintext                                                                                       | `lib/auth/password.ts` (`scrypt`, random salt, `timingSafeEqual`)                                                                |

## Notes

Chronological log of changes to money-handling or RBAC-enforcement code and the property
each preserves or alters (Code Style Guide §12). Newest first.

- 2026-10-02: Treasury arrival accounting (`lib/treasury/topups.ts:claimsAheadOf`), found in an attacker
  review. Two proposals in flight shared one baseline, so a SINGLE deposit made the hot-wallet balance
  satisfy both and both were confirmed, recording twice the funds that arrived. Confirmation now
  requires the rise to cover this proposal plus every proposal transferred before it that is still
  waiting or was confirmed after this baseline was taken. Conservative: when in doubt a confirmation
  waits for more funds rather than claiming evidence that belongs to another proposal. Residual:
  nothing ties a deposit to the pool wallet's transaction, so an admin who tops up the hot wallet from
  elsewhere can still make a proposal confirm; the recorded transfer reference is the audit trail.
- 2026-10-02: Browser security headers (`next.config.ts`, `app/security-headers.test.ts`). The app sent
  none. Every response now carries a CSP (default-src self; no remote scripts, frames, plugins or
  foreign form targets; connect-src self; blob: images for photo previews), `X-Frame-Options: DENY` and
  `frame-ancestors 'none'`, `nosniff`, a strict referrer policy, COOP same-origin, HSTS, and a
  Permissions-Policy that allows camera, location and Bluetooth for this origin only. Residual:
  `script-src` keeps `'unsafe-inline'` (Next's inline bootstrap, no nonce middleware yet), so the CSP
  limits where code can load from but is not a full XSS barrier; the sandboxing CSP on served photos
  still applies on top. Checked in a headless browser: no violations on `/`, `/login`, `/about`.
- 2026-10-02: Sessions now follow the account (`lib/auth/live-account.ts`, `auth.ts`). A session is a JWT valid for
  up to 30 days, so deactivating an account or lowering its role changed nothing until it expired (a stolen phone
  or a demoted admin kept full access). The JWT callback now re-reads the account on every session read: an
  inactive or deleted account ends the session at once (401 on the next request), and the role is always the
  stored one. If the lookup fails (database outage) the token is kept, so an outage does not sign every phone
  out. Verified live: demote -> 403, deactivate -> 401, reactivate -> 200 with the same cookie. Residual: one
  indexed query per session read; offline queued events from a deactivated device are rejected when they sync.
- 2026-10-02: Account creation refuses a weak password (`weakPasswordReason`: at least 12 characters, more than
  a few distinct characters, not a known placeholder) in `create-supervisor` and `create-partner`. Residual:
  it is a floor, not a strength meter, and existing accounts are not re-checked.
- 2026-10-02: Credential login hardening (`auth.ts`, `lib/auth/throttle.ts`) and a route guard test.
  Login was not throttled: an attacker could guess passwords at full speed. Now `auth.login_max_failures`
  (default 8) failed attempts for one identifier inside `auth.login_window_minutes` (15) lock that
  identifier, even for the right password, until the oldest failure ages out; the refusal looks like a
  wrong password and a success clears the count. It is per identifier, not per IP (behind the proxy every
  caller shares an address and a forwarded header is attacker controlled), in memory per process (a
  restart resets it), and bounded in size. Residual: an attacker can lock a known identifier out for one
  window (a nuisance, not a breach), and the lock does not span several app instances. Unknown
  identifiers now cost the same time as known ones (a decoy hash is verified), so response time no longer
  reveals which accounts exist. `app/api/route-guard.test.ts` walks every route file and requires 401
  without a session unless the route is on an explicit allow list (health, meta, public stats, Auth.js),
  so a new route cannot ship unguarded.
- 2026-10-02: Resolving a payout stuck in `sending` (`lib/payouts/resolve.ts`, migration 0012). Adds the
  scope `payout:resolve`, held by `admin` only (matrix test updated; `hub_lead` can approve and retry but
  cannot settle an uncertain payment). `payout:execute` is still in no role and nothing here sends money:
  resolving only RECORDS a person's decision. Preserves **never pay twice**: only a payout in `sending`
  that is stale or flagged can be resolved; `failed` does not re-queue it (retry stays a separate act); a
  `paid` resolution needs a reference that no other payout holds (also a UNIQUE column) and that equals the
  payment hash the payout was sent with; the provider's own lookup, when it can answer, vetoes a decision
  that contradicts it (paid or pending against `failed`, failed against `paid`), except that a "paid" the
  provider shows for a hash another payout already settled is not treated as evidence (a reused invoice).
  Separation of duties: the person who recorded the weigh or approved the payout cannot resolve it
  (`payouts.resolution_requires_distinct_actor`, default true; off only for a one-admin deployment).
  One resolution per attempt, so it is idempotent and concurrent identical requests write one ledger
  entry; the table is append-only (trigger), every resolution is anchored by a `payout` or `correction`
  ledger entry, and the uncertainty flag is closed in the same transaction. A flag that was closed
  re-opens if a retried payout gets stuck again. Residual: the check reads the provider; a compromised
  provider account could mislead the admin, and `not_found` is never proof of non-payment.
- 2026-10-02: Payment provider hardening (`lib/lightning/{BlinkProvider,LNbitsProvider,bolt11}.ts`),
  written against Blink's published GraphQL schema and the LNbits 1.6 OpenAPI document
  (`docs/providers/`). Tightens the rule that prevents a double payment: only a definite success is
  "paid" and only a definite refusal is "failed". A Blink `FAILURE` counts as failed only when every
  error code is on an allow list of "nothing was sent" codes (Blink also returns `FAILURE` for
  internal faults that can follow a sent payment); `ALREADY_PAID`, `PENDING`, an unlisted code, a lost
  connection, a timeout, an unreadable answer and an HTTP 5xx are all an UNKNOWN outcome. An LNbits 201
  with `status: pending` is no longer treated as paid (it was). A success whose preimage does not hash
  to the invoice's payment hash is not trusted. The USD wallet is refused as a float (its balance is in
  cents). The payment hash (parsed from the invoice before sending) is now the provider reference and is
  kept on a payout whose outcome is unknown, so a person can look the payment up. Requests carry a
  timeout. Residual: no live account has been exercised; the allow list is from the open source
  resolver and may need extending after the supervised first payment.

- 2026-10-01: The treasury funding vote (M5-7, ADR-0020, migration 0011). Adds three scopes,
  `treasury:read`, `treasury:propose` and `treasury:approve`, held by `admin` only (matrix test
  updated; `hub_lead` deliberately holds none, so nobody who vets collectors also approves the money
  that pays them). `payout:execute` is still in no role and nothing here pays a collector. Preserves:
  **Taka Sats holds no pool key and moves no pool funds**; the vote is a record plus checks around a
  transfer signed in the pool's own wallet, and no request field carries an address or a key.
  Separation of duties is enforced in code and by a database trigger (the proposer cannot approve or
  reject their own proposal; an approval counts once; only a `proposed` proposal takes approvals;
  approvals can never be updated or deleted). One transfer reference can back one proposal (UNIQUE).
  A proposal that would take the hot wallet above `treasury.hot_wallet_cap_sats` is refused, and if the
  float cannot be read while a cap is set the proposal is refused too (nothing is guessed). Arrival is
  confirmed only from the rail's own balance, never from a caller's claim. Every step appends a
  `treasury_topup` ledger entry in the same transaction. Residual: one person holding two admin
  accounts defeats the distinct approver rule, and nothing yet links a recorded approval
  cryptographically to the pool wallet's signatures (compare the recorded transfer reference).

- 2026-10-01 — Vercel-to-VM same-origin API forwarding: the optional
  `TAKASATS_API_ORIGIN` build setting forwards only `/api/*` with a `beforeFiles` rewrite. It is
  unset on the VM to prevent a proxy loop. Authentication, authorization and request validation
  still execute on the VM; the Vercel layer does not mint or interpret sessions. Deploy checks
  cover CSRF, `Set-Cookie`, authenticated session reads and upload limits through the public origin.

- 2026-10-01 — Reconciliation, anomaly detection and the review/read APIs.
  Adds ONE scope, `reconciliation:write` (admin only; matrix test updated), guarding `POST
/recycler-sales` and `POST /reconciliation/runs`; the reads reuse `report:generate:all`
  (admin) and `anomaly:review` (admin). Preserves: **no flag blocks anything** — detectors run
  after the ingest commit, are wrapped so a failure never changes a sync result, and nothing
  reads `anomaly_flags` to gate a payout (they only warn: `openFlags` on `GET /payouts`).
  A recycler sale is trust evidence, so it is a `recycler_sale` ledger entry written in the
  same transaction as its row. Reconciliation sums kilograms in Postgres `numeric` and compares
  in integer milli-kg (no float accumulation); `reconciliation_reports` rows are never
  updated. A review is final for its reviewer — only a DIFFERENT admin may overturn it, and the
  superseded verdict is kept in `context.history`. `GET /events` shows a plain supervisor only
  their own events and withholds GPS from them; it never returns `photo_url`. `GET
/stats/summary` is public by design: aggregates only, precision set by
  `transparency.amount_disclosure`, a test proves no alias, wallet, code, coordinate or id leaks.

- 2026-10-01 — Independent-review hardening (found by a read-only adversarial review of the
  identity/gate/destinations change set; each was reproduced from the code before fixing):
  1. **Inflated-invoice drain (high).** `pay()` took the invoice a destination's LNURL server
     returned and handed it to the rail, and rails pay the invoice's _own_ amount. `requestLnurlInvoice`
     now decodes the BOLT11 amount (`lib/lightning/bolt11.ts`, BigInt, no float) and refuses anything
     but exactly the requested sats, plus an amount outside the wallet's sendable range — before any
     rail is called. Preserves: the ledger records what actually moved.
  2. **Destination ownership (high).** Any supervisor could set a wallet on any collector, or swap
     one staff had just authorized. A supervisor may now write a destination only for a collector
     they registered, only until it is authorized, and only inside an active session; addresses are
     visible to staff and the registrar only. Alters: who may change where money goes.
  3. **Stored XSS through photos (high).** `image/*` accepted SVG and the read route replayed the
     type on the app origin. Uploads are now allow-listed raster types and the read route serves a
     sandboxing CSP, `nosniff`, and an opaque download for anything else.
  4. **Collector lock order (medium).** `FOR UPDATE` on the collector followed by the ledger advisory
     lock could deadlock against ingest (ledger lock, then the collector foreign-key lock). Authorize,
     destination writes and tag issue now take `FOR NO KEY UPDATE`.
  5. **One wallet, many spellings (low-medium).** A bech32 or `.well-known` URL of an address (or a
     trailing slash / query string) defeated the one-wallet-per-collector rule. All spellings now
     canonicalise to one string; query-string/fragment URLs are refused.
  6. **Exchange feed (medium).** Verified against the real services for the first time: Yadio's
     `/rate` endpoint is _inverted_ and CoinGecko has no KES. Sources are now Yadio (pair-echo
     checked) + Coinbase + a Kraken×FX cross; two sources may not be further apart than the
     tolerance; an outlier is set aside; numbers are parsed strictly. A wrong-direction value could
     previously have been stored if two sources were both wrong the same way.
  7. **Legacy destinations (low).** Migration 0008 records legacy addresses it cannot migrate as
     `invalid` (and clears the stale copy) instead of leaving collectors silently unpayable.
     `payout:execute` unaffected.

- 2026-10-01 — The payout engine (M5): `lib/money.ts:computePayout` implemented, `lib/payouts/`,
  the payout jobs and `/api/v1/payouts` (migration 0009). Money and RBAC-enforcement code touched:
  `lib/auth/permissions.ts` gains `payout:read` (`supervisor`, `hub_lead`, `admin`; a plain
  supervisor is scoped in the handler to payouts of events THEY recorded; `partner` has none;
  `rbac-matrix.test.ts` pins every cell). `payout:execute` is still in no role and no HTTP route
  can start a payment — the only caller of `LightningProvider.pay` is the worker's
  `processPayout`. Properties:
  1. **One arithmetic core.** `computePayoutDetail` (BigInt integer maths, half-up, a 0-sat
     result is a `MoneyError`) is the only code that turns weight × rate into an amount.
  2. **Destination never client input.** No function in `lib/payouts` takes an address; it reads the
     collector's `verified` destination itself, and no payout endpoint has a destination field or
     returns an address. Only an `active` collector is ever paid.
  3. **No double pay.** One payout per event (UNIQUE); every transition is a conditional UPDATE and
     the `sending` claim precedes the provider call, so concurrent runs cannot both send; the
     payout id is the provider idempotency key. A payout whose outcome is unknown (crash,
     timeout, bookkeeping failure) stays `sending`, raises one `payout_uncertain` flag and is
     NEVER re-sent automatically.
  4. **Approval.** Above `payouts.second_signoff_threshold_sats` — and, by default, for the first
     payout to any destination — a distinct `hub_lead`/`admin` must approve; the supervisor who
     recorded the event cannot. An approval is bound to the destination it was given for: a
     destination swapped afterwards voids it.
  5. **Fresh price, event-time rate.** Priced at the rate active when the event was recorded, against
     a snapshot within `money.rate_staleness_ttl_seconds`; stale means parked, not paid.
  6. `lightning.float_provider = "fake"` (marks payouts paid without paying) is refused in
     production unless `TAKASATS_ALLOW_FAKE_PROVIDER=true`.
     Logs use a field allow-list (id, status, attempts, error code, provider) — no address or amount.

- 2026-10-01 — Cardless identity, the collector authorization gate and payment destinations
  (D-24 / D-25 / D-26 / D-27, ADR-0017..0019, migration 0008). RBAC-enforcement code touched:
  `lib/auth/permissions.ts` gains `collector:authorize`, granted to `hub_lead` and `admin`
  (`rbac-matrix.test.ts` pins every cell). Properties:
  1. **The gate (alters who may act).** `collectors.status` gains `pending`, and the column now
     **fails closed** (`DEFAULT 'pending'`). A supervisor's registration is `pending`; only
     staff holding `collector:authorize` register `active`, and each decision (including a
     pre-authorized registration) writes a `collector_authorizations` row anchored by a
     `collector_authorization` ledger entry in the same transaction. Enforced at four points: the
     offline cache lists only `active` collectors; ingest returns `needs_attention`
     (`collector_not_authorized` / `collector_not_found` — previously an unknown collector was an
     FK error that failed the whole batch); `reissueTag` and the tag-resolve route refuse a
     non-`active` collector; the payout worker will refuse one. `authorization_required = false`
     removes the gate by operator choice — its absence is then the operator's decision, not a bug.
  2. **Destinations (preserves "destination is never client input").** The payout target is a
     `collector_payment_destinations` row, validated receive-capable before it is written
     (`attachDestination` calls the provider first, writes nothing on a 4xx-class failure). A live
     address is unique across collectors, so a supervisor cannot point many invented collectors at
     one wallet; **replacing a verified destination is the redirect-fraud path, so it needs
     `collector:authorize`** (a supervisor may set the first one, or fix one that is still
     unverified). `DestinationInUseError` is deliberately generic — it never says whose address it is.
     A transient wallet-host failure stores `pending_validation` and a worker re-checks; **only
     `verified` is ever payable**.
  3. **Credentials carry identity only.** A QR/NFC payload is `takasats:<public_code>` — a pointer.
     It grants nothing and pays nobody; the earlier "tag encodes the Lightning address" half of
     ADR-0001 is superseded (the receive-only guarantee is kept and made stronger: nothing on a
     credential can move or even address money).
  4. **Signed payload.** `weightSource` / `scaleId` / `scaleReadingRaw` are inside the hash, so a
     supervisor cannot later claim a scale produced a number that was typed (and vice versa) — the
     server recomputes the hash from what it receives and rejects any difference. Verification
     results stay outside the signed event so the original claim is never overwritten.
  5. **Not yet covered.** `collector_authorizations` and `collector_payment_destinations` have no
     DB-level immutability trigger (only the ledger rows do); their history is append-only by
     convention and by the ledger anchor for authorizations. Destination changes are not
     ledgered. `payout:execute` is unaffected (still in no role); no money arithmetic changed.

- 2026-10-01 — Signed ledger checkpoints + the read/verify API (M4-7/M4-8, D-19, §11.2).
  RBAC-enforcement code touched: `lib/auth/permissions.ts` gains the scope `ledger:read`,
  granted to `admin` alone (`rbac-matrix.test.ts` pins the row); the three new routes
  (`GET /api/v1/ledger`, `/ledger/checkpoints`, `/ledger/verify`) are
  `requireScope('ledger:read')` — a `supervisor`, `hub_lead` or `partner` gets 403. Ledger
  rows hold ids, hashes and timestamps only (no alias, phone, address, GPS or amount), and
  that must stay true of anything appended. Properties and key handling:
  1. **What a checkpoint proves.** An Ed25519 signature over the UTF-8 string
     `<through_seq>|<entry_hash>`. Given a pinned public key it shows the programme key holder
     vouched for the chain head at that seq; because `entry_hash` commits to every prior link,
     any later rewrite of entries `<= through_seq` is detectable. It does **not** prove the
     facts were true, and it does not stop the key holder signing a rewritten chain — hence
     the optional Nostr / OpenTimestamps anchoring (not yet built) and out-of-band key pinning.
  2. **Key handling.** The signing seed is `LEDGER_SIGNING_KEY` (base64, 32 bytes) —
     environment only, read lazily at use (`lib/ledger/signing.ts`), never in TOML, a response
     or a log. The worker uses it to sign; the app process (same env on Compose/Vercel) only
     derives and serves the **public** key (`GET /ledger/checkpoints` -> `publicKey`) and
     checks signatures with it — the seed never leaves the process. Unset: the job logs a warning and signs
     nothing; malformed: the job fails and the API answers 503 `ledger_key_invalid`.
     Rotation: sign new checkpoints with the new key, keep the old public key to verify old
     ones (see `docs/LEDGER.md`).
  3. **Idempotent, tamper-evident writes.** `createCheckpoint` runs under its own advisory
     lock and never writes a second checkpoint for a `through_seq`, nor one on an empty ledger.
     `verifyLedger` fails on a bad signature, a checkpoint whose `entry_hash` the chain does
     not have, or a `through_seq` past the head (a truncated tail). `ledger_checkpoints`
     itself has no immutability trigger: a deleted checkpoint is not detectable from the DB
     alone — verifiers keep their own copy of published checkpoints.
     `payout:execute` unaffected; no money arithmetic.
- 2026-10-01 — LNURL resolution hardened (`lib/lightning/{lnurl,lnurlPay,errors}.ts`). Adds,
  without loosening the receive-only guarantee: (1) a code on a configured spend-link host
  (`lightning.spend_link_hosts`, default `card.paybee.buzz` — the Pay side of a Paybee card) is
  rejected with `SpendCredentialRejectedError` **before any network call**, is never stored or
  logged, and is never converted into a receive address; (2) SSRF guard on the scanned URL and
  on the `callback` a remote LNURL server returns — https only, no URL credentials, no
  loopback/private/link-local/CGNAT/metadata/local-only target (literal or DNS-resolved) →
  `UnsafeLnurlTargetError`, redirects never followed, `lightning.lnurl_timeout_ms` timeout, 64
  KiB response cap; (3) error messages carry a hostname or a generic description, never the
  scanned code (a spend/withdraw link must not reach API error JSON or logs). Transient
  failures are a distinct `LightningEndpointUnreachableError`. Residual: DNS-rebinding between
  the DNS check and the connect (THREAT_MODEL T16).
- 2026-09-07 — Sync ingest (M4-3, FR-4.2, §10.3). New route `POST /api/v1/sync/events`,
  `requireScope('collection:record')` (no matrix change) + `lib/collection-events` +
  migration 0007 (`collection_events`). Trust properties it establishes:
  1. **Content binding.** Each event's `content_hash` is **recomputed server-side** from the
     submitted fields via the same `collectionEventPayload` + `canonicalize` the PWA used; a
     mismatch is `needs_attention`, never ingested. The confirmed `ledger_entries` row's
     `payload_hash` is that same hash — the fact in the chain is provably the one the device
     recorded.
  2. **Idempotency (FR-4.2).** `id` (client UUID) is the `collection_events` PK; a resent
     event returns its stored `{ status: 'confirmed', seq }` with no second ledger entry. A
     concurrent duplicate that loses the unique-violation race is resolved to the same result.
  3. **Authorisation at the boundary.** A plain `supervisor` may only sync events whose
     `supervisorId` is their own (`hub_lead`/`admin` may sync on behalf — device recovery);
     and every event is rejected unless that supervisor is in `session_supervisors` for its
     `session_id` (M2-7 enforced where offline events actually enter the system).
  4. **Rate integrity.** `rate_id` must be the `material_rates` row active for that material
     at `recorded_at` (`rateActiveAt`) — a queued event cannot be revalued by a later rate
     change. No sats arithmetic here (`indicative_sats` is display, §8.3).
  5. Never a silent drop — every submitted event gets a `confirmed`/`needs_attention` result
     in order. `photo_url` is a soft back-fill (`photoUrlFor`), a missing photo does not block.
- 2026-09-07 — The append-only ledger (M4-1/M4-2, D-13, REQUIREMENTS §11). New
  `ledger_entries` / `ledger_checkpoints` tables (migration 0006) + `lib/ledger`. Properties
  it establishes (a review of anything touching the chain must re-check these):
  1. **Append-only at the DB.** A `BEFORE UPDATE OR DELETE … FOR EACH STATEMENT` trigger
     (`ledger_entries_immutable()`) raises `restrict_violation` — enforced regardless of the
     connecting role, so it holds on managed Postgres too. `TRUNCATE` is _not_ blocked
     (operator reset / test isolation); operators `REVOKE TRUNCATE` for defence in depth. A
     correction is a new `entry_type = 'correction'` row with `references_id` set — never an
     edit.
  2. **Hash chain.** `appendEntry` runs under `pg_advisory_xact_lock`, so `seq` (app-assigned,
     `= head.seq + 1`, `UNIQUE` backstop) and `prev_entry_hash = head.entry_hash` are
     race-free. `entry_hash = sha256(seq | entry_type | payload_hash | prev_entry_hash)`,
     `prev` = `GENESIS` at `seq 1`. Both forms are frozen by fixed-vector tests.
  3. **Client-bound payload.** `payload_hash` is the SHA-256 of the fact's canonical JSON —
     the _same_ `canonicalize` the PWA computes its `content_hash` with (`lib/sync/contentHash`,
     imported by `lib/ledger`), so an offline event's client hash is the ledger payload hash
     verbatim. If the two serialisations ever diverge, `content_hash` checks fail spuriously.
  4. `verifyChain(db)` recomputes every link and returns the first `brokenAt` seq + reason —
     the basis for `GET /ledger/verify` and `scripts/verify-ledger.ts` (M4-8).
     No money arithmetic and no RBAC change here; the sync-ingest route + its authz land in M4-3.
- 2026-09-07 — Photo upload queue (M3-10, FR-4.2, D-12). New route
  `POST /api/v1/photos`, `requireScope('collection:record')` (supervisor / hub_lead / admin —
  no matrix change). Evidence-integrity property it establishes: the server **recomputes**
  SHA-256 over the received bytes and rejects (422 `photo_hash_mismatch`) anything that does
  not match the `X-Photo-Sha256` header the device computed at capture — so the stored object
  is provably the bytes the supervisor photographed. Objects are content-addressed
  (`photos/<sha256>`), making a re-send an idempotent overwrite. `Content-Type` must be
  `image/*` (415), body ≤ 8 MiB (413). Storage credentials (`S3_*`) stay environment-only
  (`lib/storage`, read lazily). No money path; `payout:execute` unaffected.
- 2026-09-06 — Supervisor rotations (M2-8, FR-3.7). New CRUD routes
  (`GET`/`POST /api/v1/rotations`, `DELETE /api/v1/rotations/:id`) all behind
  `requireScope('session:configure')` (admin only) — no RBAC-matrix change. The one
  authorization-relevant behaviour change: `lib/sessions.createSession` now **unions** the
  explicit `supervisorIds` with anyone rostered for the session's location+window
  (`rotationSupervisorsFor`, window-overlap, exact location match). Those auto-assigned
  supervisors then pass M2-7's `requireActiveSession` for that session — i.e. a rotation can
  grant a supervisor the ability to act in a session without the session's creator listing
  them explicitly. Bounded by: admin-only rotation writes, exact location-string match, and
  the M2-7 window/active checks still apply. `applyRotations: false` opts a `createSession`
  call out. `payout:execute` unaffected.
- 2026-09-06 — Session access window (M2-7, FR-6.1). New authz gate, not a scope
  change: `lib/sessions/requireActiveSession(db, actor)` throws `NoActiveSessionError`
  (→ 403 `no_active_session`) when `actor.role === 'supervisor'` and there is no session
  that is assigned to them, `status='active'`, and open at `now` (`currentSessionForSupervisor`,
  window end exclusive). `hub_lead`/`admin` are not shift-bound and pass through. Wired into
  `POST /api/v1/collectors` (the only supervisor-initiated write today); M3's
  `collection:record` route must call the same helper. `POST /collectors/:id/{address,tags}`
  are **not** gated yet — they are sub-steps reached only after a gated `POST /collectors`
  in the enrol flow; standalone use (e.g. a later tag reissue) by an unassigned supervisor
  is a known gap. The PWA mirrors the gate in the UI
  (`components/supervisor/session-context.tsx` `<SessionGate>`) but the server check is
  authoritative. `payout:execute` unaffected; the RBAC matrix (`permissions.ts`) is unchanged.
- 2026-09-06 — Sessions + rates API, exchange feed, partner login (M2-5, M2-9, M2-1).
  RBAC-enforcement code touched: `lib/auth/permissions.ts` gains two fine-grained staff read
  scopes, `rates:read` and `session:read`, granted to `supervisor` / `hub_lead` / `admin`
  and to no other role — `partner` does **not** hold them; `rbac-matrix.test.ts` pins the
  full row for each. `lib/auth/session.ts` gains `requireAnyScope([...])` (deny-by-default,
  same 401-then-403 shape as `requireScope`) and widens `Actor.kind` to
  `'supervisor' | 'partner'`. `auth.ts` gains a second credentials branch: an `identifier`
  containing `@` is looked up in `partners` by `login_email` (lowercased) and signs in with
  `role: 'partner'`; the phone branch is unchanged and still refuses any row whose `role`
  fails `isRole()` or equals `'partner'`. Partner passwords are `scrypt`-hashed by the same
  `lib/auth/password.ts` path; there is no self-service partner sign-up (`scripts/create-partner.ts`
  only). Write routes stay admin-only: `POST /api/v1/rates`, `POST /api/v1/sessions`,
  `PATCH /api/v1/sessions/[id]` all `requireScope('session:configure')` (in `admin` alone).
  `GET /api/v1/sessions` and `/sessions/[id]` scope visibility to the actor — `admin` sees
  all, a `partner` sees only sessions whose `sponsor_partner_id` is its own id, a supervisor
  sees only sessions it is assigned to; a mismatch is a 403 (`ForbiddenError('session:read')`),
  not a 404. `payout:execute` remains in no role — unaffected. New exchange feed
  (`lib/money/rates/`) only reads/writes `exchange_rate_snapshots` and does no sats
  arithmetic; `requireFreshRate()` is the guard M5's payout path will call for the
  rate-staleness property (still unused — no payout path exists yet).
- 2026-09-04 — Auth.js credentials login (`auth.ts`) + `lib/auth/session.ts` + the first
  `/api/v1` routes (`app/api/v1/collectors/**`), pulled forward from M2-1/M2-2 to unblock
  M1-4. Establishes: every route resolves its actor via `requireScope(scope)`, which is
  deny-by-default (`lib/auth/permissions.ts`, unchanged) — no session is 401, the wrong role
  is 403, before any handler body runs. `auth.ts` refuses to sign in a supervisor row whose
  `role` fails `isRole()` or equals `'partner'` (defense in depth on top of the DB CHECK
  constraint). Passwords are `scrypt`-hashed (`lib/auth/password.ts`, `node:crypto`, random
  salt per password, `timingSafeEqual` comparison) — the hash is never logged. Sessions are
  JWT (no `sessions` table, no DB round trip to validate one), signed with `AUTH_SECRET` from
  the environment only. `payout:execute` remains reachable by no role — unaffected by this
  change; `session.test.ts` asserts it explicitly for every role via the new `requireScope`
  path too.
- 2026-09-04 — `lib/lightning/` (LightningProvider implementations) and `lib/collectors/`
  introduced. Establishes the receive-only guarantee (ADR-0001, M1-10) at the one point every
  provider and `attachByoAddress` funnel through: `lib/lightning/lnurlPay.ts` resolves a code
  and throws `NotReceiveCapableError` for anything but a `payRequest` (in particular a
  withdraw `LNURLw`) — before the code is ever stored on a collector row or written to a tag.
  `FakeLightningProvider.pay()` re-validates the destination even though it was "already
  resolved", so a future caller cannot bypass the check by skipping straight to `pay`.
  `receive-only.test.ts` asserts this for every provider and asserts `PayoutDestination` has
  no field a withdraw/callback primitive could hide in. No payout execution path exists yet
  (M5); `pay()` on `BlinkProvider`/`LNbitsProvider` is unreachable from any route or worker
  until then.
- 2026-09-04 — `lib/auth/permissions.ts` introduced. Establishes: `payout:execute` exists
  as a scope but is in no role's set; `permissions.test.ts` fails the build if any human
  role gains it. Preserves separation of duties (ADR-003).
- 2026-09-04 — `lib/money.ts` introduced. `Sats` is a branded integer built only via
  `sats()`; `computePayout` is the sole payout-arithmetic entry point and currently throws
  `NotYetImplemented`. No destination parameter exists on its signature.
