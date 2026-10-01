# Taka Sats — Threat Model (first draft)

| | |
|---|---|
| Status | Draft — M0-14. Revised whenever a component is added (see CONTRIBUTING). |
| Source | `docs/REQUIREMENTS.md §16`, Technical Architecture §7, the ADRs in `docs/adr/`. |
| Companion | The external security review at M8-6 (gate G5) supersedes this draft's assurance claims. |

This is a working model for contributors: what we are protecting, from whom, and which
control covers each threat. It is deliberately concrete about the money and evidence paths
and lighter elsewhere.

---

## 1. Assets

| Asset | Why it matters |
|---|---|
| Operating float (hot) | Spendable Lightning balance. Deliberately small — a few days of payouts. |
| Cold reserve | The bulk of programme funds. Self-custodied, Trezor 2-of-3 multisig. |
| Provider credentials | Blink API key / LNbits admin key / Nostr private key / `AUTH_SECRET` / DB URL / object-store creds. |
| The ledger | The append-only `ledger_entries` hash chain — the tamper-evidence the whole programme's credibility rests on. |
| Collection evidence | Per-event photo + its on-device SHA-256, GPS, timestamp, supervisor id. |
| Collector PII | Alias + Lightning Address only. No legal name, no ID. Still must not leak via public/partner surfaces. |
| Rate table & exchange snapshots | Wrong values here pay the wrong amount. |
| Supervisor / admin sessions | Long-lived, offline-surviving auth tokens on field devices. |

## 2. Trust boundaries

1. **Field device ↔ server** — supervisor PWA over intermittent network. The device is
   semi-trusted: it holds a valid session and queued events, but its clock, GPS, and camera
   are attacker-influenceable. The server re-validates everything on sync.
2. **Collector ↔ system** — a collector only ever presents an NFC tag (or a QR at
   enrolment). No authentication, no session; a tag is a bearer *receive* pointer.
3. **Third party ↔ API** — `public:read` (no key) and scoped API keys. Everything past the
   PII-filtering serialiser is untrusted output territory.
4. **System ↔ Lightning provider** — an external custodial or federated service reached with
   a secret key. Treated as available-but-fallible and never trusted with destination choice.
5. **Operator ↔ config** — `config/settings.toml` + env. The `provisioning_ack` string is the
   boundary that makes turning on custody a deliberate act.

## 3. Threat agents

- A **supervisor** acting dishonestly (self-payment, inflated weights, phantom collectors).
- A **supervisor + collector** colluding.
- An **external attacker** with a stolen field device, a leaked API key, or network position.
- A **compromised Lightning provider account** (key theft upstream or our side).
- A **malicious enrollee** submitting a hostile address/QR.
- An **insider with admin access** attempting to redirect funds or edit history.

## 4. Threats and controls

| # | Threat | Control | Where |
|---|---|---|---|
| T1 | Supervisor directs a payout to themselves | `payout:execute` scope is in **no** human role; destination is resolved server-side from the tag mapping, never from a request body; redundant unit test fails the build if violated | `lib/auth/permissions.ts`, payout worker (M5-3), `permissions.test.ts` |
| T2 | Supervisor + collector inflate weights | Reconciliation vs recycler tonnage (variance flagged); supervisor rotation; anomaly flag for repeated identical weights | `lib/fraud/` (M6-2, M6-4), FR-3.5/3.7 |
| T3 | Phantom collectors (invented aliases pointing at a supervisor's wallet) | **Authorization gate (D-25):** a supervisor's registration is `pending`; only a `hub_lead`/`admin` authorizes, each decision ledger-anchored. A wallet address is unique across live collectors (migration 0008), so one wallet cannot back many ghosts; a new destination for a first payout needs approval. Reconciliation surfaces divergence; payout-concentration (Gini) flag |
| T4 | Records edited to hide fraud (incl. by an admin) | Append-only `ledger_entries`; DB-level `UPDATE`/`DELETE` revoked; hash chain; signed checkpoints; external verifier | ADR-0004/0014, M4-1, `scripts/verify-ledger.ts` |
| T5 | Lost / stolen credential (QR / NFC tag / card) used to drain funds | A credential carries only `takasats:<public_code>` — an identity pointer; it holds no payment target and no spend authority, so a found one can neither pay nor withdraw. Payouts always go to the collector's registered `verified` destination. Revoke + reissue; revoked-tap logged as an anomaly. (A wallet partner's own card — e.g. Paybee — is that partner's custody, outside this system.) |
| T6 | Stolen field device with queued events | Opportunistic frequent sync; end-of-session sync drill; session can be revoked (with a short offline window as accepted residual risk) | ADR-0002, §5 below |
| T7 | Lightning provider key compromise | Key in environment only, never client/logs; float deliberately small; cold reserve multisig unaffected; worker alerts on abnormal outflow | REQUIREMENTS §16, M5-6 |
| T8 | API key leak | Scoped (default `public:read`), no PII, no writes; hashed at rest; revocable; `last_used_at` visible; per-key + per-IP rate limits | D-07, M7-2 |
| T9 | Exchange-rate oracle manipulation | ≥2 independent sources; a payout will not run against a rate older than `money.rate_staleness_ttl_seconds` | ADR-0010, D-18, M2-9 |
| T10 | Malicious address at enrolment (e.g. an `LNURLw` withdraw code) | BYO code is validated receive-capable and resolvable before it is stored or written to the tag; withdraw codes rejected | ADR-0001/0013, `LightningProvider.resolveReceiveAddress`, M1-10 |
| T11 | PII leak via partner / public surfaces | A central response serialiser strips alias / phone / individual amounts / precise GPS for `partner` and `public:read`; contract tests fail the build on a leak | NFR 7.4, M7-4, M7-12 |
| T12 | Regulatory exposure from accidental custody | Non-custodial by default; custodial LNbits provisioning is opt-in behind gate G1 and requires the exact `PROVISIONING_ACKNOWLEDGEMENT` string, checked at boot | ADR-0007/0015, `lib/config/schema.ts` |
| T13 | Above-threshold payout pushed through by one person | `payouts.status = 'pending_approval'` above `payouts.second_signoff_threshold_sats`; approval needs a **distinct** `hub_lead`/`admin`; self-approval rejected | FR-3.2, M5-4 |
| T14 | Photo evidence swapped after capture | SHA-256 computed on-device before upload; server recomputes on receipt and rejects a mismatch; the hash is a ledger field, not just a DB row | D-12, M3-5, M4-3 |
| T15 | Secret committed to the repo or logged | Secrets are env-only; the config Zod schema has no secret fields; structured logging uses a safe-field allow-list; CI (future) secret scan | D-21, Code Style Guide §9.6 |
| T16 | Scanned/returned LNURL used to make the server fetch an internal or spend URL (SSRF; a card's Pay link) | Configured spend-link hosts rejected before any fetch; https-only, no URL credentials, public targets only (static + DNS check, also on the remote `callback`); no redirects, timeout, 64 KiB cap; errors never echo the code. **Residual:** DNS rebinding between check and connect is not closed (no IP pinning without a new dependency) | `lib/lightning/lnurl.ts`, `lnurlPay.ts`, `lightning.spend_link_hosts` |
| T17 | Payout redirected by setting or changing a collector's destination | A supervisor may write a wallet **only for a collector they registered, only while it is `pending`, and only inside an active session** — once staff authorize, the wallet is what they vouched for and only `collector:authorize` (hub_lead/admin) may change it; so an unrelated or off-shift supervisor cannot release a parked backlog to their own wallet, and a registrar cannot swap a wallet staff reviewed. The old destination is revoked and kept (history). Wallet addresses are shown only to staff and the registrar; `destination_in_use` is deliberately generic |
| T18 | Wallet card's spend side scanned or photographed by staff | The Pay QR host is rejected before any network call and never stored/logged (T16). Operationally: staff scan **Receive** only; the card holder keeps the card; training material shows both sides |
| T19 | A destination's LNURL server returns an invoice for far more than the payout (rails pay the invoice's own amount) | `requestLnurlInvoice` decodes the BOLT11 amount and refuses anything but exactly the requested sats (zero-amount and malformed invoices too), and refuses an amount outside the wallet's own sendable range, **before** any rail sees the invoice; the error never carries the invoice |
| T20 | An uploaded "photo" is an SVG/HTML that runs script on the app origin when staff open it (stored XSS → a supervisor becomes an admin) | Uploads are allow-listed to raster types (JPEG/PNG/WebP/HEIC; anything else `415`); the read route serves `Content-Security-Policy: default-src 'none'; sandbox`, `nosniff`, and forces anything not allow-listed to an opaque `attachment` download |
| T19 | Double payment after a crash, a retry or two workers racing | One payout per event (UNIQUE); the `sending` claim is a conditional UPDATE made BEFORE the provider call; the payout id is the provider idempotency key; a payout stuck in `sending` or with an unknown provider outcome is flagged `payout_uncertain` and never re-sent automatically |
| T20 | The demo "fake" Lightning rail left on in production (payouts marked paid, nothing sent) | The factory refuses `float_provider = "fake"` when `NODE_ENV=production` unless `TAKASATS_ALLOW_FAKE_PROVIDER=true` is set explicitly |

## 5. Accepted residual risks

- **R1** — A revoked supervisor may keep acting **offline** until their next sync (sessions
  are long-lived by design, ADR-0002). Mitigation: a short session-refresh window; the events
  they record still pass server-side validation and reconciliation on sync.
- **R2** — Reconciliation is a **detective** control (ADR-0006): fraud is caught after the
  fact via variance, not prevented at capture. Accepted over the exclusion cost of biometric
  gatekeeping.
- **R3** — Ledger ordering is by **server ingestion**, not device clock — the system only
  attests to what it received and when.
- **R4** — A compromised operator device or database is out of scope for this model; it is
- **R4** — A compromised operator device or database is out of scope for this model; it is
  covered by deployment hardening and the treasury runbook (M5-7).
- **R5** — A single `hub_lead`/`admin` can register a collector, authorize it, and set its wallet
  alone (the gate is a *supervisor*-vs-*staff* separation, not dual control among staff). Accepted
  for the pilot's small, known staff; mitigated by the first-payout-to-a-wallet approval, the
  pilot's hold-every-payout mode, and the ledger-anchored authorization trail. A
  registrar-must-differ-from-authorizer rule is the next step if the staff grows.

## 6. Out of scope

Denial of service from unrealistic request volume (rate limits are best-effort), physical
attacks on a supervisor, vulnerabilities in third-party services (Blink, LNbits, Neon,
Vercel, relays) — reported upstream — and social engineering of Afribit staff.

## 7. Keeping this current

- A PR that adds a component or a data flow updates §1–§4 here in the same change
  (see CONTRIBUTING).
- A PR touching money-handling or RBAC-enforcement code adds a note to `SECURITY.md §Notes`.
- The M8-6 external review (gate G5) produces the authoritative assessment; its findings are
  tracked to closure and this document is reconciled against them.
