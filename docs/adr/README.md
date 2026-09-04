# Architecture Decision Records

One file per decision, numbered, append-only. A decision that is later reversed gets a new
ADR that supersedes it (and a `Superseded by` line here) — existing files are not rewritten.

**Format:** Status · Context · Decision · Consequences · Related. Keep each to a screen.

ADR-001..006 are ported from `Initial assets/Taka_Sats_Technical_Architecture.md §9`
(ADR-003a is recorded here as 0004). The rest record the `docs/REQUIREMENTS.md §2`
decisions (D-xx) that outlive their own obviousness. Where `docs/REQUIREMENTS.md` and an
ADR differ, REQUIREMENTS is authoritative.

| ADR | Title | Status | Decisions |
|---|---|---|---|
| [0001](0001-nfc-tags-receive-only.md) | NFC tags are receive-only | Accepted | ADR-001 |
| [0002](0002-offline-first-pwa.md) | Offline-first PWA, not a native app | Accepted | ADR-002 |
| [0003](0003-pluggable-lightning-provider.md) | Pluggable `LightningProvider` + two-tier treasury | Accepted | ADR-003 |
| [0004](0004-one-global-ledger-hash-chain.md) | One global `ledger_entries` hash chain | Accepted | ADR-003a, D-13 |
| [0005](0005-operation-log-not-crdts.md) | Operation log with idempotent events, not CRDTs | Accepted | ADR-004 |
| [0006](0006-reconciliation-primary-fraud-control.md) | Reconciliation is the primary fraud control | Accepted | ADR-005 |
| [0007](0007-configurable-custody.md) | Configurable custody; non-custodial default | Accepted | ADR-006, D-05, D-22 |
| [0008](0008-api-first-standalone.md) | API-first, standalone system | Accepted | D-01 |
| [0009](0009-single-nextjs-app-router-project.md) | Single Next.js App Router project, monorepo-ready | Accepted | D-04 |
| [0010](0010-fiat-per-kg-rate-table.md) | Rate table stores fiat-per-kg, not sats-per-kg | Accepted | D-14 |
| [0011](0011-config-first.md) | Config-first — nothing operational is hardcoded | Accepted | D-21 |
| [0012](0012-dual-deployment.md) | Dual deployment: Docker Compose and Vercel | Accepted | D-03 |
| [0013](0013-two-collector-address-sources.md) | Two collector address sources, per-collector | Accepted | D-05 |
| [0014](0014-append-only-ledger.md) | Append-only ledger, corrections are new rows | Accepted | D-13 |
| [0015](0015-custody-is-configuration.md) | Custody/payout model is configuration, not a fork | Accepted | D-22 |
| [0016](0016-three-lightning-provider-implementations.md) | Three real `LightningProvider` implementations | Accepted | D-23 |
