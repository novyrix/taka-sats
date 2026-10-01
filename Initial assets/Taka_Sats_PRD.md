# Taka Sats — Product Requirements Document

**Waste-to-Bitcoin Earn-First Incentive Program**
Afribit Africa · Kibera (Soweto West), Nairobi, Kenya

Version 1.1 — Draft for Development
Prepared August 2026 · Revised September 2026

**Revision 1.1 (2026-09):** reconciled with `docs/REQUIREMENTS.md` for implementation and its resolved decisions D-01…D-23. Changes: the payout rail is a pluggable, configurable `LightningProvider` (**Blink** as the shipped default, self-hosted **LNbits** as the opt-in custodial provider, and **Fedimint/Fedi** as a supported rail — see §8, Technical Architecture ADR-003/006); collectors may use a **bring-your-own** Lightning Address / Blink Paycode *or* a program-provisioned LNbits wallet (§6.1); the HTTP API is a first-class, documented, versioned product surface (`/api/v1`); per-material rates are stored in fiat and converted to sats at disbursement; open-source publication and the public open dataset are v1 (Phase 2) deliverables. Nothing operational is hardcoded — see `docs/CONFIGURATION.md`.

Companion documents: Taka Sats User Stories, Taka Sats Brand Guidelines, Taka Sats Technical Architecture, Taka Sats CONTRIBUTING Guide, Taka Sats Code Style Guide, and the engineering set under `docs/` (`REQUIREMENTS.md` — the consolidated spec, `DESIGN.md`). This PRD states *what* and *why*; `docs/REQUIREMENTS.md` is the buildable consolidation and is authoritative where the two differ.

---

## Document Control

| | |
|---|---|
| Status | Draft, ready for engineering scoping |
| Owner | Eddie (Technical Lead), Ronnie Mdawida (Executive Director) |
| Reviewers | Afribit core team, prospective grant reviewers (HRF BDF, OpenSats) |
| Related research | *Taka Sats: Waste-to-Bitcoin Earn-First Program — Technical and Grant Documentation* (Aug 2026), *Afribit Africa Freedom-Tech Grant Strategy* (Aug 2026) |

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Goals and Success Metrics](#2-goals-and-success-metrics)
3. [Non-Goals / Out of Scope](#3-non-goals--out-of-scope)
4. [Personas](#4-personas)
5. [Core Product Principles](#5-core-product-principles)
6. [Functional Requirements](#6-functional-requirements)
7. [Non-Functional Requirements](#7-non-functional-requirements)
8. [System Architecture Summary](#8-system-architecture-summary)
9. [Data Model Summary](#9-data-model-summary)
10. [Program Lifecycle](#10-program-lifecycle)
11. [Success Metrics and KPIs](#11-success-metrics-and-kpis)
12. [Risks and Mitigations](#12-risks-and-mitigations)
13. [Rollout Plan](#13-rollout-plan)
14. [Open Questions](#14-open-questions)
15. [Glossary](#15-glossary)

---

## 1. Problem Statement

Kibera generates waste that goes largely uncollected by formal municipal systems. Young residents already collect recyclable waste informally, but with no consistent income, no proof of impact, and no path into the financial system — many lack the documentation traditional banks require, and mobile money fees are regressively expensive on small amounts.

Afribit's existing Taka Sats program addresses this by paying collectors in Bitcoin for verified waste collection. It is currently Afribit's highest-retention program because it leads with earning, not education. But it runs on manual processes: no NFC identity, no digital weighing record, no fraud-resistant verification chain, and no way to prove to partners and funders — credibly and auditably — that the kilograms collected and the sats paid are real, reconciled, and not the product of a supervisor rewarding themselves or a phantom collector on the books.

**This PRD defines the system that closes that gap**: a digital identity and payment layer for collectors, a verified weighing and fraud-prevention workflow for supervisors, and a transparent, auditable ledger that Afribit, partners (Trezor, Blink, Fedi), and grant funders (HRF, OpenSats) can trust without trusting any single person in the chain.

---

## 2. Goals and Success Metrics

**Primary goal:** make every Taka Sats payout traceable to a real, verified collection event, without adding friction that undermines the earn-first onboarding model.

**Secondary goals:**
- Give Afribit a credible, open, auditable dataset to support grant applications (HRF BDF, OpenSats) and partner reporting (Trezor, Blink, Fedi).
- Reduce supervisor-level fraud risk to a level defensible to a skeptical funder or auditor.
- Keep the system operable on low-cost Android devices under Kibera's intermittent connectivity, by non-technical staff.
- Publish the system as open source (AGPL-3.0) so other circular-economy and Bitcoin-adoption programs can adopt it.

Success is measured in Section 11.

---

## 3. Non-Goals / Out of Scope

- **Not a general-purpose recycling marketplace.** Taka Sats pays collectors for delivering weighed waste to Afribit collection points; it does not build a marketplace connecting collectors directly to buyers.
- **Not a consumer wallet product.** Collectors receive sats to a Lightning Address; Taka Sats does not build or maintain a general-purpose Bitcoin wallet app. A collector may bring their own wallet (e.g. a Blink Paycode) *or* be issued one from Afribit's self-hosted LNbits instance — either way, Taka Sats is not the wallet.
- **Custody is a deployment choice, not a fixed posture.** Afribit may enable collector wallets on a self-hosted LNbits instance (custodial) only after completing the corresponding legal review for Kenya's VASP regime (§7.6). The codebase also ships a fully non-custodial mode (collector brings their own wallet; the operating float runs on Blink) so that other operators without a virtual-asset licence can run the system. Both modes are built and documented in v1; the mode is selected in configuration.
- **Not a credit-scoring or lending product.** Reputation data captured here may inform a future Boda-Boda-style microloan product (see the Afribit Freedom-Tech Grant Strategy, Idea #4), but lending is explicitly out of scope for this PRD.
- **Full offline Lightning settlement is out of scope for v1.** V1 uses deferred settlement (authorize offline, settle when online). A Fedimint ecash pilot for genuinely offline value transfer is a Phase 3 exploration, not a v1 requirement.
- **Biometric verification is out of scope for v1**, given the exclusion risk documented in the technical research (biometric requirements measurably slowed comparable cash-transfer rollouts and can exclude undocumented residents — the exact population Taka Sats serves). Revisit only if reconciliation data shows a phantom-collector problem NFC + community verification cannot solve.

---

## 4. Personas

### 4.1 Amina — Waste Collector
19 years old, lives in Soweto West, no formal ID, no bank account, has a basic feature phone she shares with family. Collects recyclable waste on weekends. Wants to be paid quickly, fairly, and without needing to own a smartphone or understand Bitcoin technically. Trusts Afribit because she knows the supervisors personally.

### 4.2 Brian — Community Supervisor
26 years old, an early Afribit participant now trained to run a weigh station. Has an Android phone. Responsible for weighing waste, verifying collectors, and triggering payment. Wants a fast, simple workflow he can run in a busy outdoor setting, and does not want to be the one holding money or keys — he'd rather the system make it obvious he isn't the one deciding payouts.

### 4.3 Ronnie / Eddie — Program Admin
Runs Afribit. Needs visibility into every session in real time, control over payout rates and treasury settings, the ability to detect and investigate anomalies, and clean exportable data for partners and grant reporting.

### 4.4 Trezor / Blink / Fedi — Partner
Sponsors Taka Sats or a related program. Wants aggregate, credible impact data (kg collected, sats paid, retention, cost per kg) without access to individual collector PII. Wants confidence the program is fraud-resistant before attaching their name to it.

### 4.5 HRF / OpenSats — Grant Reviewer
Evaluates whether Taka Sats is a legitimate freedom-tech / open-source project worth funding. Wants to see: real usage data, an open-source codebase under a proper license, a credible fraud-prevention model, and a team capable of maintaining it.

---

## 5. Core Product Principles

These are non-negotiable design constraints, established in the underlying technical research and restated here as product law:

1. **Earn-first, always.** No collector-facing step may require literacy, a smartphone, ID documentation, or an existing bank/Bitcoin account. If a requirement would exclude someone Afribit currently serves, it is wrong.
2. **Separation of duties.** The person who weighs waste never controls the treasury. No single role can both certify a collection and authorize its payout without a second, independent check.
3. **Offline-first, always functional.** Every collector-facing and supervisor-facing action must work with zero connectivity at the moment of use. Sync happens when connectivity returns; it is never a precondition for earning.
4. **Evidence over trust.** Every payout traces to a timestamped, geotagged, photographed weighing event, and reconciles against independent revenue-side data (recycler sale tonnage) rather than relying on any one person's word.
5. **Transparent by default, private by design.** Aggregate program data (kg, sats, retention) is public and auditable. Individual collector identity and amounts are pseudonymous in any public-facing view.
6. **Receive, not spend.** Collector-facing NFC identity is a receive-only credential (LNURL-pay / Lightning Address on a static tag). It carries no spend risk if lost, which removes an entire category of security engineering the collector-facing side would otherwise need.

---

## 6. Functional Requirements

Requirements are grouped by capability area. Each numbered requirement (`FR-x.y`) is the atomic unit user stories and technical specs should map back to.

### 6.1 Collector Identity and NFC Tags

- **FR-1.1** — System shall issue each enrolled collector a static NFC tag (NTAG213 or NTAG216) encoding a receive-only Lightning Address or LNURL-pay link. The address is obtained by one of two configurable paths: **(a) bring-your-own** — the collector presents their own Lightning Address / Blink Paycode QR, which is scanned, validated as receive-capable, and written to the tag; or **(b) program-provisioned** — a bulk wallet-creation flow against Afribit's self-hosted LNbits instance mints a wallet and address per collector. Path (a) is the shipped default; Afribit may enable path (b) after G1. Both paths are v1 deliverables. Config: `settings.custody` (see `docs/CONFIGURATION.md`).
- **FR-1.2** — Collector enrollment shall require only a name (or chosen alias) and the physical issuance of a tag — no ID document, phone, or literacy test. (Bring-your-own additionally captures a scan of the collector's existing payment QR; this adds no identity requirement.)
- **FR-1.3** — A lost or damaged tag shall be replaceable by re-mapping a new physical tag to the same collector record, with no fund-recovery risk (tags are receive-only).
- **FR-1.4** — System shall support revoking a tag's server-side mapping (e.g. on suspected fraud or collector exit) without affecting other collectors.
- **FR-1.5** — Tags shall be physically durable for outdoor use (IP67/IP68-rated card or keyfob form factor), wearable on a lanyard.

### 6.2 Weighing and Collection Workflow

- **FR-2.1** — Supervisor app shall support recording a collection event: collector tap → material type selection → weight entry (manual v1; BLE scale auto-capture v2) → mandatory photo of scale reading and waste → automatic sats calculation. The rate table stores a **fiat value per kg** per material; the sats figure shown at capture is indicative (converted at a cached exchange rate) and the binding sats amount is set at disbursement (see FR-7.3).
- **FR-2.2** — System shall support multiple material types with independently configurable per-kg **fiat** rates, editable only by Admin. Rate changes are versioned, never overwritten; a past event always reflects the rate active when it was recorded.
- **FR-2.3** — Every collection event shall capture: collector ID, material(s), weight(s), indicative sats, photo, photo hash, timestamp, GPS coordinates, and supervisor ID.
- **FR-2.4** — Collection events shall be writable and fully functional with no network connectivity (see Section 7.2).

### 6.3 Fraud Prevention

- **FR-3.1** — Supervisors shall have no direct capability to move treasury funds to any wallet, including their own. Payout execution is a system function triggered by a verified event, not a supervisor-held permission.
- **FR-3.2** — Payouts above an Admin-configurable threshold shall require a second, independent sign-off (hub lead or Admin) before settlement.
- **FR-3.3** — System shall maintain an append-only, cryptographically signed ledger of all collection and payout events. Records shall not be editable after creation; corrections are new records that reference the original.
- **FR-3.4** — System shall publish a public, independently verifiable attestation (Nostr event) for each verified collection, excluding collector PII and (configurably) exact amounts.
- **FR-3.5** — System shall support reconciliation reporting: total kg paid for, by material and time period, against total kg sold to recycling partners, surfacing variance for Admin review.
- **FR-3.6** — System shall flag statistical anomalies for Admin review: repeated identical weights, payouts concentrated among a small collector subset, and activity outside scheduled supervisor hours.
- **FR-3.7** — System shall support supervisor rotation scheduling and maintain an audit log of which supervisor verified which events, to support spot audits.

### 6.4 Offline Sync

- **FR-4.1** — Supervisor app shall function as an installable offline-first PWA: all core actions (tap, weigh, photograph, sign off) succeed with local storage only.
- **FR-4.2** — On connectivity return, the app shall sync queued events to the backend, resolving conflicts without data loss.
- **FR-4.3** — System shall surface pending-sync status to the supervisor (queued / syncing / confirmed) at all times.

### 6.5 Waste Mapping

- **FR-5.1** — Every collection event's GPS coordinate shall be captured as a byproduct of normal operation and made available as an open-data layer (collection points, hotspot density) on an OpenStreetMap base layer.
- **FR-5.2** — Admin dashboard shall provide a map view of collection activity, filterable by date range and material type.

### 6.6 Supervisor Scheduling

- **FR-6.1** — Admin shall be able to create and assign supervisor shifts per session/location.
- **FR-6.2** — System shall alert Admin of unstaffed coverage gaps ahead of a scheduled session.
- **FR-6.3** — When no supervisor is available, collectors shall be able to log a provisional, unpaid "pending weigh" record (photo + estimate) at a self-serve drop point, payable only after a supervisor later verifies it — preserving earn-first continuity without opening a verification gap.

### 6.7 Treasury and Payouts

- **FR-7.1** — System shall maintain a hot operating float (days of expected payouts) separate from a cold multisig reserve holding the bulk of program funds.
- **FR-7.2** — System shall automatically alert Admin when the hot float falls below a configurable threshold, and support manual or automated top-up from the cold reserve.
- **FR-7.3** — System shall execute payouts to each verified collector's Lightning Address through a configurable `LightningProvider` — **Blink** (shipped default), self-hosted **LNbits** (opt-in custodial), or **Fedimint/Fedi** — denominated in a stable fiat-equivalent value converted to sats at time of disbursement. The payout code path and the separation-of-duties guarantee (FR-3.1) are identical across providers; the destination is always resolved server-side from the tag mapping, never accepted as input.
- **FR-7.4** — If the operating pool is depleted, verified-but-unpaid collections shall accrue as a visible "pending payout" balance rather than being silently dropped.
- **FR-7.5** — Admin dashboard shall display real-time treasury status: hot balance, cold reserve, pending payouts, and a public-facing transparent accounting summary.

### 6.8 Admin Dashboard

- **FR-8.1** — Admin shall be able to create, configure, and monitor collection sessions, including per-kg rates, supervisor assignment, and geographic scope.
- **FR-8.2** — Admin shall have a live view during active sessions: collectors verified, kg collected, sats disbursed, anomaly flags.
- **FR-8.3** — Admin shall be able to generate partner- and funder-facing reports (aggregate, pseudonymized) for a selected date range and, where applicable, a specific sponsoring partner.

### 6.9 Partner and Funder Reporting

- **FR-9.1** — Partners (Trezor, Blink, Fedi) shall have a read-only, aggregate-only view scoped to sessions tagged to their sponsorship, with no access to individual collector PII.
- **FR-9.2** — System shall support exporting an open, pseudonymized dataset (kg, sats, retention, reconciliation status) suitable for public publication and academic/grant-reviewer scrutiny. Served by the public `/api/v1` (JSON + CSV) and versioned so changes are tracked, not silently overwritten. **In v1** (pulled forward from Phase 3, since the documented API makes it cheap).
- **FR-9.3** — System shall expose a documented, versioned public HTTP API (`/api/v1`, OpenAPI 3.1 spec) as a first-class product surface, so that Afribit Console and any third party can read programme data without a bespoke integration. Scoped API keys gate access; the default `public:read` scope exposes only aggregate, pseudonymized data (no collector PII, no individual payout amounts).

---

## 7. Non-Functional Requirements

### 7.1 Usability and Accessibility
- Collector-facing interaction requires zero reading (tap-only) wherever feasible; where text is unavoidable, it is in Swahili/Sheng alongside English.
- Supervisor app usable one-handed, in direct outdoor sunlight, on a sub-$150 Android device.

### 7.2 Reliability and Offline Behavior
- Core supervisor actions (tap, weigh, photograph, sign off) must succeed with zero network connectivity, with no data loss on sync.
- The system must degrade gracefully, not fail closed, when any single backend dependency (Lightning provider, mapping tile server) is unreachable — collection events still record locally regardless.

### 7.3 Security
- No collector-facing credential (NFC tag) carries spend risk if lost or cloned.
- Treasury cold reserve requires multisig (no single key can move reserve funds).
- API credentials are scoped to least privilege and never logged in plaintext.
- See the Technical Architecture document for full threat model and audit cadence.

### 7.4 Privacy
- Collector PII is minimized by design (name/alias + Lightning Address only; no ID requirement).
- Public attestations and partner/funder reports are aggregate and pseudonymous by default.

### 7.5 Performance
- A single weighing-to-payout-authorization interaction should complete in under 30 seconds of supervisor interaction time under normal connectivity, and be instant (local-only) under no connectivity.

### 7.6 Regulatory
- The codebase supports two custody models, selected in configuration:
  - **Non-custodial (shipped default for third-party operators).** The collector brings their own wallet; the operating float runs on Blink (Blink, not Afribit, custodies collector funds). Minimises exposure under Kenya's Virtual Assets Service Providers Act, 2025 (dual CBK/CMA regime) and comparable regimes elsewhere.
  - **Custodial (operator opt-in).** A self-hosted LNbits instance provisions and holds a wallet per collector. A legal-review owner and outcome must be recorded before program-provisioned wallets hold real collector funds in production (gate G1 in `docs/REQUIREMENTS.md §1.3`).
- Any operator enabling the custodial model is responsible for their own jurisdiction's review. The `custody.provisioning_enabled` flag is off by default and requires an explicit acknowledgement string.

### 7.7 Localization
- All collector- and supervisor-facing UI text supports Swahili and Sheng in addition to English, consistent with Afribit's existing training materials.

### 7.8 Maintainability
- Codebase must be maintainable by Afribit's existing small technical team (currently one lead developer) without specialized infrastructure expertise beyond what's already in use (Vercel, Cloudflare, Neon Postgres). The self-hosted LNbits instance (custodial model) is operated by the technical lead; day-2 monitoring ownership is named before it holds real funds.
- The system deploys two ways, both first-class: `docker compose up` (app, Postgres, worker, object storage, Nostr relay; LNbits added by the custodial overlay) and a managed path (Vercel + Neon + Cloudflare R2).

### 7.9 Configuration
- Nothing operational is hardcoded. Per-kg rates, thresholds, tolerances, TTLs, the custody model, and the Lightning provider all live in a documented settings file (`config/settings.default.toml`, overridden per deployment), validated at boot. See `docs/CONFIGURATION.md`.

---

## 8. System Architecture Summary

This is a summary; full detail lives in the Taka Sats Technical Architecture document.

```
Collector NFC tag (NTAG213/216, receive-only)
   ── the collector's OWN address (bring-your-own, e.g. Blink Paycode)
   ── or a program-provisioned LNbits address (opt-in, gated on G1)
        │  physical tap
        ▼
Supervisor PWA (offline-first, Next.js App Router, IndexedDB, Service Worker)
        │  sync on connectivity
        ▼
/api/v1  (documented, versioned HTTP API — Next.js route handlers)
        │            ▲
        │            └── Afribit Console · third-party consumers (scoped API keys)
        ▼
PostgreSQL (Neon or self-hosted) ── object storage (Cloudflare R2 or MinIO)
        │
        ├──► LightningProvider: Blink (default) | LNbits (opt-in) | Fedimint ──► Collector Lightning Address (payout)
        ├──► Nostr relay ──► Public attestation
        ├──► worker (pg-boss): reconciliation, anomaly, payouts, checkpoints, alerts
        └──► Admin Dashboard + Public transparency site (same Next.js app)
```

Treasury: cold multisig reserve (Trezor 2-of-3 hardware wallets) → hot operating float (the configured provider's wallet) → per-event payouts, per Section 6.7. Every collection event, payout, correction and top-up appends to one hash-chained `ledger_entries` chain with periodic signed checkpoints for external verification.

---

## 9. Data Model Summary

Core entities (full schema in the Technical Architecture document §8 and `docs/REQUIREMENTS.md §9`):

- **Collector** — id, alias, NFC tag mapping, `address_source` (byo | provisioned), Lightning Address, LNbits wallet id (provisioned only), enrollment date, status
- **Supervisor / staff user** — id, name, phone, role (supervisor | hub_lead | admin), credentials, locale, assigned sessions, active status
- **Partner** — id, name, contact, login, active
- **CollectionEvent** — collector_id, supervisor_id, session_id, material, weight, rate_id, indicative_sats, photo_url, photo_hash, timestamp, GPS, registration_type, verification_status, ledger_entry_id
- **MaterialRate** — material, `rate_fiat_minor`, fiat_currency, effective_from/to (versioned, never overwritten)
- **Payout** — collection_event_id, amount_sats, amount_fiat_minor, exchange_snapshot_id, provider, provider_payment_ref, status (pending_approval | pending_float | paid | failed), approved_by, settled_at, ledger_entry_id
- **Session** — location, geo_bounds, scheduled_window, assigned_supervisors, sponsor_partner_id
- **Treasury** — treasury_snapshots (hot/cold/pending), treasury_topups (two-sign-off), exchange_rate_snapshots
- **LedgerEntry** — the canonical append-only hash chain (seq, entry_type, payload_hash, prev_entry_hash, entry_hash); **LedgerCheckpoint** — periodic signed anchor
- **ApiKey** — label, hashed key, scopes, partner_id (nullable)
- **Attestation** — public Nostr event reference per verified collection event, with a configurable amount-disclosure mode

---

## 10. Program Lifecycle

```
COLLECTOR ENROLLMENT → TAG ISSUED
        │
        ▼
SESSION SCHEDULED (supervisor assigned, rate table set)
        │
        ▼
SESSION ACTIVE — collection events recorded (online or offline-queued)
        │
        ▼
SESSION CLOSED — supervisor submits summary
        │
        ▼
VERIFICATION / SECOND SIGN-OFF (for above-threshold payouts)
        │
        ▼
PAYOUT EXECUTED (or queued pending treasury float)
        │
        ▼
RECONCILIATION — paid kg vs. recycler-sold kg
        │
        ▼
PUBLIC ATTESTATION + PARTNER/FUNDER REPORTING
```

---

## 11. Success Metrics and KPIs

| Metric | Target / Direction |
|---|---|
| Collection-to-payout reconciliation variance | Within an Admin-defined tolerance (e.g. ≤5%) between kg paid and kg sold to recyclers |
| Collector retention (return rate across sessions) | Maintain or improve on Taka Sats' existing status as Afribit's highest-retention program |
| Fraud/anomaly flags investigated | 100% of flagged events reviewed within a defined SLA |
| Offline reliability | Zero data loss on sync across all offline-recorded events |
| Cost per verified kg collected | Tracked and reported per session and cumulatively |
| Unique collectors reached (deduplicated) | Tracked cumulatively as a core impact metric for grant reporting |
| Open dataset publication | Aggregate, pseudonymized dataset published and kept current |

---

## 12. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Supervisor/collector collusion | Separation of duties (FR-3.1), reconciliation against recycler tonnage (FR-3.5), rotation (FR-3.7) |
| Phantom collectors | NFC enrollment + community-based re-verification; reconciliation surfaces divergence |
| Payer-side connectivity dependency (no fully offline settlement) | Deferred settlement model (Section 5.3); Fedimint ecash explored in Phase 3 |
| Treasury single point of failure | Cold multisig reserve, minimal hot float (FR-7.1) |
| Bitcoin price volatility affecting collector's effective wage | Payouts computed against a stable fiat-equivalent value, converted to sats at disbursement (FR-7.3) |
| Regulatory exposure under Kenya's VASP Act | Non-custodial mode shipped for licence-free operators (Section 7.6); Afribit's custodial LNbits deployment gated on a recorded VASP-regime legal review (gate G1) before it holds real collector funds |
| Grant/funding dependence | Recycling-revenue pathway tracked as a future treasury input (see Technical Architecture doc) |

---

## 13. Rollout Plan

**v1 delivers Phase 1 and Phase 2 in one continuous build** (decision D-02 in `docs/REQUIREMENTS.md`), because Phase 2 is what makes the project grant-ready.

**Phase 1 — Pilot.** Collector enrolment (bring-your-own or program-provisioned), NFC receive-tag issuance, manual weighing + mandatory photo evidence, offline-capable supervisor PWA, hash-chained signed ledger, reconciliation against recycler sales from day one, separation of duties.

**Phase 2 — Harden.** BLE scale auto-capture, Nostr public attestations, self-hosted LNbits with Trezor 2-of-3 multisig cold reserve, second sign-off, anomaly detection, public accounting dashboard, the documented `/api/v1` and the open dataset (FR-9.2/9.3), open-source publication under AGPL-3.0, grant applications (HRF, OpenSats).

**Phase 3 — Scale (out of scope for v1).** Fedimint community ecash for genuinely offline value transfer, route optimization from accumulated mapping data, formalize recycling-revenue contracts to reduce grant dependence.

Advance criteria for each phase are defined in the underlying Taka Sats technical research document and should be reconfirmed against real pilot data before Phase 2 hardening is declared complete.

---

## 14. Open Questions

Tracked with owners and gates in `docs/REQUIREMENTS.md §17` (OQ-1…OQ-8). Status at revision 1.1:

1. **Open** — Per-kg rate methodology and how collector input factors into rate-setting. No gate; rates are configurable regardless.
2. **Resolved (approach)** — BLE scale support is built behind a `WeightSource` interface; the specific model is plugged in at M8 after a short evaluation.
3. **Open** — Public-transparency granularity. Now a configuration key `settings.transparency.amount_disclosure` (`exact` | `bucketed` | `omitted`, default `bucketed`); the team confirms the value before the public surface ships.
4. **Resolved** — Fedimint federation guardianship: Afribit's federation already exists (Fedi, fedi.xyz); `FedimintProvider` is a supported v1 rail.
5. **Open (gate G1)** — VASP-regime legal review for any self-hosted LNbits custodial deployment. A legal-review owner and outcome must be recorded before program-provisioned wallets hold real funds in production.
6. **Open (gate G2)** — Web NFC read/write coverage on the actual supervisor Android devices; manual search + QR scan ship as first-class fallbacks regardless.
7. **Open (gate G3)** — Recycler-sales data pipeline: who enters it, how often, or a recycler-side integration.

---

## 15. Glossary

- **Sats** — satoshis, the smallest unit of Bitcoin.
- **NTAG213/216** — passive NFC tag standards used here for receive-only collector identity.
- **LNURL-pay / Lightning Address** — a standard allowing a static, shareable identifier to receive Lightning payments.
- **Reconciliation** — cross-checking kg paid for against independent revenue-side data (recycler sales) to detect fraud.
- **Deferred settlement** — authorizing a payout offline and executing it once connectivity returns.
- **Attestation** — a signed, publicly verifiable record (here, a Nostr event) proving a collection occurred without necessarily revealing private details.
- **Bring-your-own wallet** — the collector's tag points at a wallet they already control (e.g. their Blink account). Afribit holds no balance for them.
- **Program-provisioned wallet** — a wallet minted for the collector on Afribit's self-hosted LNbits instance (custodial).
- **LightningProvider** — the configurable interface every payout goes through: LNbits, Blink, or Fedimint.
- **Ledger entry / checkpoint** — a row in the single append-only hash chain / a periodically signed anchor over it for external verification.

---

*This PRD (revision 1.1) states what Taka Sats must do and why. The buildable consolidation — data model, API contract, decisions, config surface — is `docs/REQUIREMENTS.md` (signed), with UI in `docs/DESIGN.md`. The User Stories, Brand Guidelines, Technical Architecture, CONTRIBUTING Guide, and Code Style Guide remain companions.*
