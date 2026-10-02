# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project aims to follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) once it has a first release.

## [Unreleased]

## [0.1.0] - not yet released

The first version, ready for a supervised pilot. It runs in demo mode by default: payments are
simulated unless an operator switches on a real wallet provider. Real Lightning payments have not
yet been run against a live account.

### Added

- **Field app** (a progressive web app for supervisors): offline weighing with a scale photo, GPS
  or a typed reason, a local queue that syncs by itself and never double counts, a visible sync
  state with plain reasons when a record needs attention.
- **Collector identity without cards**: a public code, an alias and a receive only Lightning
  address. Staff approval before a collector can be weighed or paid. A card's spend link is refused.
- **Tamper evident ledger**: one append only hash chain for collections, payouts, approvals and
  treasury steps, signed checkpoints, a read and verify API and a standalone verifier that needs no
  database (`scripts/verify-ledger.ts`).
- **Payouts**: exact integer sats, rate and exchange snapshot recorded per payout, second person
  approval, a worker that is the only caller of the wallet provider, honest handling of unknown
  outcomes, and an admin tool to check and resolve a stuck payout.
- **Wallet providers**: Blink and LNbits, plus a demo provider. A read only checking tool
  (`pnpm provider:check`) with an optional supervised 1 sat payment.
- **Treasury funding vote**: a recorded vote by distinct stewards that refills the hot wallet from a
  pool held elsewhere, a cap on the hot wallet, and an arrival check against the wallet's own balance.
- **Operator console**: overview, collectors, payouts, treasury, collections with a "how do we know"
  page, anomalies, reconciliation against recycler sales, ledger, sessions, rates, rotations, staff.
- **Verification layers**: authorization, session and rate checks at ingest, a content hash seal,
  photo fingerprint re-check, anomaly flags that never block on their own, reconciliation.
- **Operations**: Docker Compose stack with HTTPS and private object storage overlays, backups with a
  restore rehearsal, login throttling, security headers, `pnpm db:seed-team` for test accounts, a
  smoke test over real HTTP.
- **Documentation**: backend contract, ledger guide, treasury design, verification protocol, threat
  model, provider notes, self hosting and development guides, architecture decision records.

### Known limits

- Real Blink and LNbits payments are unverified against a live account.
- Weights are typed from a physical scale. Connected scales and reading the scale display from the
  photo are not built.
- Collectors must be enrolled online. Offline enrolment is not built.
- The pool's own balance is not shown (the vote and the arrival check are built).
- Swahili and Sheng text are placeholders awaiting human translation.
- No independent security review has happened yet.
