# Taka Sats — Consolidated Requirements (v1)

**Waste-to-Bitcoin Earn-First Programme · Afribit Africa**

| | |
|---|---|
| Document status | Draft v0.1 — for engineering sign-off |
| Date | 2026-09-03 |
| Owner | Eddie (Technical Lead) |
| Supersedes | Nothing — this is the first consolidated engineering spec |
| Builds on | `Initial assets/Taka_Sats_PRD.md`, `Taka_Sats_Technical_Architecture.md`, `Taka_Sats_User_Stories.md`, `Taka_Sats_Code_Style_Guide.md`, `Taka_Sats_Brand_Guidelines.md` |

---

## 0. How to use this document

This is the single reference an engineer or an outside contributor reads to understand **what v1 must do, how the pieces fit, and which decisions are already settled**. It does not replace the source documents in `Initial assets/` — it consolidates them, resolves the open questions that blocked a build, and adds the implementation-level detail (API surface, data model deltas, ledger spec, auth model) those documents deferred.

Every requirement here traces to a PRD functional requirement (`FR-x.y`) or user story (`US-x.y`). Where this document changes something in a source document, it is called out explicitly in **§4 Proposed updates to the source documents** — the source documents remain authoritative until those edits land.

**Nothing operational is hardcoded.** Every tunable value — per-kg rates, sign-off thresholds, reconciliation tolerance, rate-staleness TTL, anomaly parameters, amount-disclosure mode, and which Lightning provider and custody model an operator runs — lives in a documented, version-controlled settings file (**§13**), never in source. This is a hard project rule, not a preference: it is what lets another circular-economy or Bitcoin-adoption programme adopt this codebase without forking it.


---

## 1. Scope of v1

The programme's own rollout (PRD §13) has three phases. **v1 covers Phase 1 and Phase 2 in one continuous build**, because Phase 2 is what makes the project grant-ready (open-source publication, public transparency, Nostr attestations) and the team wants to reach that bar in the first release.

### 1.1 In scope for v1

| Capability area | Phase | Notes |
|---|---|---|
| Collector enrolment (name/alias only, no ID) | 1 | FR-1.1–1.2 |
| Static receive-only NFC tags (NTAG213/216, LNURL-pay) | 1 | FR-1.1, ADR-001 |
| **Bring-your-own wallet** — collector submits their own Lightning Address / Blink POS QR, encoded on the tag (non-custodial; default) | 1 | §7.1, D-22 |
| **Program-provisioned wallet** — self-hosted LNbits mints one wallet + address per collector (custodial; opt-in, operator legal review) | 1–2 | §7.1, D-22, G1 |
| Pluggable Lightning provider for the operating float: **Blink** (default), self-hosted **LNbits**, or **Fedimint / Fedi** | 1–2 | D-22, D-23 |
| Tag reissue and revocation | 1–2 | FR-1.3 (P1), FR-1.4 (P2) |
| Manual weigh workflow: tap → material → weight → mandatory photo → auto sats calc | 1 | FR-2.1, FR-2.3–2.4 |
| Versioned per-material rate table (fiat-per-kg, converted to sats at disbursement) | 1 | FR-2.2, US-7.3 — see §4.1 |
| Offline-first Supervisor PWA (all core actions work with zero connectivity) | 1 | FR-4.1–4.3 |
| Sync engine (idempotent, UUID-keyed, no data loss, visible status) | 1 | FR-4.2–4.3, ADR-004 |
| Append-only hash-chained ledger with signed checkpoints | 1–2 | FR-3.3, US-3.3 — see §11 |
| Separation of duties: supervisors structurally cannot direct payouts | 1 | FR-3.1, Code Style Guide §9 |
| Second sign-off on above-threshold payouts | 2 | FR-3.2 |
| Reconciliation: paid kg vs recycler-sold kg, with variance flagging | 1–2 | FR-3.5 (day one per PRD §13) |
| Anomaly detection (identical weights, payout concentration, off-hours) | 2 | FR-3.6 |
| Supervisor rotation scheduling + full verifier audit trail | 1–2 | FR-6.1 (P1), FR-3.7/6.2 (P2) |
| Self-serve "pending weigh" drop-point records (unpaid until verified) | 2 | FR-6.3 |
| Two-tier treasury: operating float (Blink default / LNbits / Fedi) + Trezor 2-of-3 multisig cold reserve | 2 | FR-7.1–7.2, ADR-003 |
| Payout execution against a stable fiat-equivalent value, converted at disbursement | 1 | FR-7.3, US-7.3 |
| Pending-payout accrual when the float is depleted (never silently dropped) | 2 | FR-7.4 |
| Real-time treasury view (hot / cold / pending) | 2 | FR-7.5 |
| Admin dashboard: session config, live session monitoring, report generation | 1–2 | FR-8.1 (P1), FR-8.2–8.3 (P2) |
| **Documented, versioned public HTTP API** (`/api/v1`) with OpenAPI spec | 1–2 | New first-class surface — see §10 |
| Partner read-only aggregate views, scoped to sponsored sessions | 2 | FR-9.1 |
| Public, pseudonymised open dataset (served by the API + exportable) | 2 | FR-9.2 — pulled forward from P3 because the API makes it cheap |
| Nostr public attestations per verified collection (pseudonymous) | 2 | FR-3.4 |
| Public transparency dashboard (aggregate accounting) | 2 | PRD §13 Phase 2 |
| Waste map view (collection points / hotspot density on OSM) | 2 | FR-5.2, US-5.1 — GPS capture itself is P1 via FR-2.3 |
| BLE scale auto-capture | 2 | FR-2.1 "v2"; specific model TBD (PRD Open Q 2) — built behind an interface |
| Dual deployment: `docker compose up` **and** Vercel + Neon + R2 | 1 | Both paths first-class |
| Open-source release: AGPL-3.0, CONTRIBUTING, SECURITY, CoC, DCO, templates | 2 | PRD §2, §13 |
| Swahili + Sheng localisation scaffolding | 1 | NFR 7.7 (strings filled by Afribit) |

### 1.2 Deferred to Phase 3 (out of scope for v1)

- Fedimint community ecash for genuinely offline value transfer (PRD §3, §13).
- Route optimisation from accumulated mapping data.
- Formalised recycling-revenue contracts / treasury income modelling.
- Biometric verification (explicitly out of scope unless reconciliation data later demands it — ADR-005).
- Any consumer wallet, recycling marketplace, or lending/credit-scoring product (PRD §3).

### 1.3 Hard gates inside v1

These block a production launch of the feature they name, not the build:

- **G1 — Legal review before enabling the custodial (program-provisioned) mode.** The shipped default is non-custodial (bring-your-own wallet + Blink float — see §7.1, D-22), designed to keep an operator out of scope for virtual-asset custody licensing. An operator that turns on program-provisioned LNbits wallets holding collector-designated balances takes on custodial exposure and must complete their own jurisdiction review first — for Afribit, under Kenya's Virtual Assets Service Providers Act 2025 (ADR-006, NFR 7.6). The config flag for this mode is off by default and requires an explicit acknowledgement.
- **G2 — Web NFC device coverage confirmed** against the actual Android phones supervisors carry before tap-lookup is treated as the primary flow (Tech Arch Open Q 1). Manual search is a first-class fallback regardless.
- **G3 — Recycler-sales data pipeline confirmed** (who enters it, how often) before reconciliation output is shown to funders as authoritative (Tech Arch Open Q 4).
- **G4 — Cold-reserve key-holder ceremony** (Ronnie + Treasurer + Advisor, 2-of-3) documented and rehearsed before the cold reserve holds meaningful value.
- **G5 — Security review** of the payout path and the ledger before Phase 2 publication.

---

## 2. Resolved decisions

Decisions made to unblock the build. Each can be revisited, but code is written against these until a decision record supersedes it. Formal ADRs land in `docs/adr/` during Milestone 0.

| # | Decision | Rationale |
|---|---|---|
| D-01 | **API-first, standalone.** Taka Sats is its own system exposing a documented, versioned HTTP API. Afribit Console is one consumer (admin surface), not a host. Third parties can self-host and consume the API. | User direction. Keeps the project genuinely open and unlocked from any one deployment. |
| D-02 | **v1 = PRD Phase 1 + Phase 2.** | User direction — reach grant-readiness in the first release. |
| D-03 | **Dual deployment, equal priority.** A `docker compose` stack (app + Postgres + worker + MinIO + Nostr relay; LNbits added only when custodial mode is enabled) and a Vercel + Neon + Cloudflare R2 path are both maintained and CI-tested. | "Standalone, not locked to a system" applies to hosting too. |
| D-04 | **Single Next.js App Router project**, monorepo-ready: `lib/` subpackages (`money`, `sync`, `fraud`, `lightning`, `ledger`, `db`) contain zero framework imports so they lift into `packages/*` later without a rewrite. | Matches Code Style Guide §3 literally; simplest for a one-lead team now. |
| D-05 | **Two collector-address sources, operator-selectable per collector.** (a) *Bring-your-own* — the collector submits their own Lightning Address or Blink POS / Paycode QR at enrolment; it is scanned, validated, and written to the tag. Afribit never holds a balance designated to that collector. This is the **shipped default** and the path for operators without a virtual-asset licence. (b) *Program-provisioned* — a self-hosted LNbits instance mints one wallet + LNURLp per collector. This is custodial, **off by default**, and gated on G1. | User direction: offer a non-custodial route (collector's own Blink account) alongside the custodial LNbits route, which is kept. Blink's one-account-one-address limit only matters for bulk minting — which is exactly what the LNbits mode is for. |
| D-21 | **Config-first — nothing operational is hardcoded.** A committed `config/settings.default.toml` holds every tunable with documented defaults; an operator overrides via a git-ignored `config/settings.toml` and/or environment variables; the merged result is Zod-validated at boot (`lib/config/`). Secrets (DB URL, provider API keys, LNbits admin key, Nostr private key) stay in the environment, never in the TOML. A literal magic number in domain code is a review-blocking defect. | PRD §2 — publishable so other programmes can adopt it. A programme in another city changes a file, not the code. See §13. |
| D-22 | **Custody / payout model is configuration, not a fork.** `settings.toml` selects the operating-float provider (`blink` \| `lnbits` \| `fedimint`) and whether program-provisioned collector wallets are enabled. The payout code path is identical across every combination — destination is always resolved server-side from the collector's primary verified destination (D-26, §12.3); only provisioning and the `LightningProvider` implementation differ. | One codebase serves a licensed custodial operator and an unlicensed non-custodial one with no code difference. |
| D-23 | **`LightningProvider` has three real implementations** (plus `FakeLightningProvider` for tests): `BlinkProvider` (default float; also resolves and validates a collector's Blink Paycode / Lightning Address), `LNbitsProvider` (custodial provisioning + float), `FedimintProvider` (Fedi federation). Afribit's federation already exists (fedi.xyz), so Fedi is a supported rail in v1, not a Phase-3 unknown. | Restores Tech Arch ADR-003's Blink rail as the default; adds Fedi now that OQ-4 is resolved. |
| D-06 | **Auth.js / NextAuth v5** for human sessions (`supervisor`, `hub_lead`, `admin`, `partner`); credentials provider; supervisor sessions are long-lived and survive extended offline periods. | No vendor lock; works identically on both deploy targets. |
| D-07 | **Scoped API keys** (`api_keys` table, hashed at rest) for third-party API consumers. Default scope is `public:read`. Broader scopes are granted explicitly. | Lets "anyone can query info" be true without exposing PII or write paths. |
| D-08 | **Drizzle ORM + drizzle-kit** for schema and migrations; every migration hand-writes its `down`. | Code Style Guide §8 ("every migration reversible"); light footprint for self-hosters; SQL-first. |
| D-09 | **Zod** for all boundary validation (API input, sync payloads, env). | Named in Code Style Guide §7. |
| D-10 | **pg-boss** for the background job queue and cron, run by a dedicated `worker/` process. | Postgres-backed — no Redis dependency to self-host. On Vercel, Vercel Cron calls authed internal routes that enqueue the same jobs. |
| D-11 | **Lightning access is an interface** (`lib/lightning/LightningProvider`) with the implementations named in D-23. `FakeLightningProvider` for local dev and unit tests; Playwright payout e2e runs against a regtest backend, never real funds (Code Style Guide §10). The active implementation is chosen from `settings.toml` (D-22). | Testability; keeps money-path code provider-agnostic. |
| D-12 | **Photo integrity:** the PWA computes a SHA-256 of the image bytes before upload; the server recomputes it on receipt and rejects a mismatch; the hash is a field in the ledger entry, not just the DB row. | Tamper-evidence from the point of capture, not the point of storage. |
| D-13 | **One global append-only `ledger_entries` chain** with a server-assigned monotonic sequence, covering collection events, payouts, corrections, and treasury movements. `collection_events` / `payouts` become detail tables referenced by their ledger entry. Periodic **signed checkpoints** give external verifiers stable anchors. | Refines Tech Arch §7/§8 — makes "independently verifiable" (US-3.3) a single, simple artifact to hand an auditor. See §11. |
| D-14 | **Rate table stores fiat-per-kg**, not sats-per-kg. Sats are computed at disbursement from a BTC exchange-rate snapshot. | Resolves the conflict between Tech Arch §8 (`rate_sats_per_kg BIGINT`) and US-7.3 (stable fiat-equivalent value). See §4.1. |
| D-15 | **i18n via `next-intl`.** English authored in-repo; `sw` (Swahili) and `sheng` locale files stubbed and filled by Afribit staff. Collector-facing UI is tap/icon-first with no reading in the critical path (NFR 7.1). | |
| D-16 | **DCO `Signed-off-by`** on every commit (no CLA), enforced in CI. License is **AGPL-3.0-only** with SPDX headers in every source file. | Standard for a community AGPL project; lowest contributor friction. |
| D-17 | **Testing stack per Code Style Guide §2/§10:** Vitest + React Testing Library (unit/integration), Playwright (e2e). Money-path code requires adversarial test cases (§9.5). | |
| D-18 | **Exchange rate feed** is a config-driven interface (`lib/money/rates`) with at least two independent sources (e.g. a BTC/USD source + a USD/KES source, or a direct BTC/KES source) and a staleness guard — a payout will not execute against a rate older than `settings.money.rate_staleness_ttl` (§13). | US-7.3 correctness; avoids a single-oracle failure paying collectors the wrong amount. |
| D-19 | **Hash-chain verifier is a standalone script** (`scripts/verify-ledger.ts`) *and* a public API endpoint that streams the chain, so a non-technical auditor can verify without running code and a technical one can (Tech Arch Open Q 3). | |
| D-20 | **Nostr attestations use one programme keypair** for v1 (per-supervisor keys deferred). Attestation payload carries: ledger sequence, session id, material, rounded weight bucket, timestamp, and an amount disclosure set by `settings.transparency.amount_disclosure` (`exact` \| `bucketed` \| `omitted`, default `bucketed`). Never a collector identifier. | FR-3.4; the exact-amount question is a team decision (PRD Open Q 3 / OQ-3) exposed as config, not hard-coded. |
| D-24 | **Cardless identity.** A collector exists independently of any physical credential: a permanent client-generatable `id` and a server-allocated `public_code` (`TS-KBR-0042`). Alias/code search, a QR, and an NFC tag are interchangeable lookup shortcuts into the supervisor's cached directory; a credential payload is `takasats:<public_code>` — **identity only, never a payment target**. No credential is required. | `docs/TAKA_SATS_PROTOTYPE_ARCHITECTURE_V2.md`; Paybee cards are QR-only. Supersedes the "tag encodes the Lightning address" half of ADR-0001. ADR-0017. |
| D-25 | **Collector authorization gate.** `collectors.status` is `pending` \| `active` (= authorized) \| `revoked`. A supervisor's registration is `pending`; a `hub_lead`/`admin` (`collector:authorize`) authorizes it. Only `active` collectors can be weighed (cache + ingest), issued an NFC tag, or paid. Each decision is a `collector_authorizations` row anchored in the ledger (`collector_authorization`). `collectors.authorization_required = false` disables the gate. NFC tags are issued only to authorized collectors. | Closes ghost-collector fraud (aliases pointing at a supervisor's wallet) now that no physical credential gates enrolment. ADR-0017. |
| D-26 | **Payment destinations are records.** `collector_payment_destinations` (status `pending_validation` → `verified` \| `invalid`, or `revoked`; ≤1 live destination per collector, which is the primary; address unique across live destinations). The payout destination is always the collector's primary **verified** destination, resolved server-side. Replacing a verified destination needs `collector:authorize`. A spend link (`lightning.spend_link_hosts`, e.g. a Paybee card's Pay QR) is rejected before any network call and never stored/logged. Wallet providers (Paybee, Blink, Fedi …) are a `provider_hint`, not code. | Destination history + the cleanest redirect-fraud control. ADR-0018. |
| D-27 | **Weight provenance is signed at capture; verification is derived.** The signed event payload carries `weightSource` (+ optional `scaleId`, `scaleReadingRaw`). OCR/AI/mass-balance results live in `verification_checks` / `anomaly_flags` / `verification_level` (`V0`–`V4`) and never mutate the event. `verification_level` and payout state are independent axes. The physical scale is authoritative; AI audits kilograms, it does not invent them. | The `content_hash` is frozen and recomputed on ingest — adding a field later breaks queued events. ADR-0019. |
| D-28 | **A multisig pool funds a capped, pluggable hot wallet.** Stewards (not field supervisors) hold an M of N multisig pool. A recorded vote refills a small hot wallet behind `LightningProvider`, which pays collectors automatically. Taka Sats never holds pool keys and never moves pool funds. Both roles are filled by any provider that meets `docs/providers/README.md`. | Payouts must be automatic, so the key on the server must guard little. ADR-0020, `docs/TREASURY.md`. |

---

## 3. Actors, roles, and auth model

### 3.1 Actors

| Actor | Authenticates? | How |
|---|---|---|
| **Collector** (Amina) | Never | Physical NFC tag only. No account, no app, no login. The tag encodes a receive-only Lightning Address / LNURL-pay link — either the collector's **own** wallet (e.g. a Blink Paycode they bring to enrolment) or a program-provisioned one (§7.1). |
| **Supervisor** (Brian) | Yes | Auth.js credentials in the PWA. Session token is long-lived and refreshes opportunistically; the PWA stays usable offline for the life of a cached session. Role: `supervisor`. |
| **Hub lead** | Yes | As supervisor, plus the `hub_lead` role, which unlocks second sign-off (FR-3.2) on payouts they did not submit. |
| **Admin** (Ronnie / Eddie) | Yes | Full access: sessions, rates, treasury settings, anomaly review, reporting, tag revocation, API-key management. Role: `admin`. |
| **Partner** (Trezor / Blink / Fedi) | Yes | Read-only web login scoped to sessions tagged to their sponsorship. Aggregate figures only — no collector PII, no individual payout amounts. Role: `partner`. |
| **API consumer** (third party) | Yes | API key in an `Authorization: Bearer` header. Scopes gate what it can read; `public:read` is the default and needs no key for the explicitly public endpoints. |
| **Public** | No | Unauthenticated access to the public transparency endpoints and the open dataset. |

### 3.2 Role → permission matrix (summary; full matrix in code as `lib/auth/permissions.ts`)

| Permission | supervisor | hub_lead | admin | partner |
|---|:--:|:--:|:--:|:--:|
| Enrol collector, issue/replace tag | ✅ | ✅ | ✅ | — |
| Record collection event | ✅ | ✅ | ✅ | — |
| Revoke tag mapping | — | — | ✅ | — |
| Configure sessions / rates / thresholds | — | — | ✅ | — |
| Approve above-threshold payout (not own submission) | — | ✅ | ✅ | — |
| **Execute / direct a payout** | **— (never, structurally)** | **— (never, structurally)** | — (system function only) | — |
| Initiate cold→hot top-up | — | — | ✅ (needs 2nd sign-off) | — |
| Review / resolve anomaly flags | — | — | ✅ | — |
| View live session metrics | own sessions | own sessions | all | sponsored only |
| Generate partner/funder report | — | — | ✅ | own scope |
| Manage API keys | — | — | ✅ | — |

Beyond the summary above, `lib/auth/permissions.ts` defines a few fine-grained **read** scopes for the staff surface — `collector:read`, `rates:read`, `session:read` — held by `supervisor` / `hub_lead` / `admin` (never `partner`, whose reads go through the PII-filtered aggregate surface, §10.1). `lib/auth/rbac-matrix.test.ts` asserts the full `(role × scope)` table and fails the build if any scope widens.

**Enforcement (Code Style Guide §9.3–9.4):** the payout-execution scope does not exist in any human role's permission set. Payout destination is *always* resolved server-side from the tapped tag's mapping and is never accepted from a request body. Both facts are covered by a unit test that fails the build if violated.

---

## 4. Applied updates to the source documents

These edits reconcile the source documents with the resolved decisions. They were applied under Milestone 0 issue M0-15 on 2026-09-04; `docs/REQUIREMENTS.md` is now the authoritative buildable consolidation.

### 4.1 `Taka_Sats_Technical_Architecture.md`

1. **§3 / §8 — API is a product, not an internal detail.** Replace "Backend API (Node.js)" framing with: a documented, versioned `/api/v1` surface; an OpenAPI 3.1 spec committed at `docs/openapi.yaml`; API-key auth for third-party consumers; explicitly public read endpoints. Add a C4 container for "Public API consumers."
2. **§6.1–6.3 — payout rails are pluggable and custody is configurable.** Keep Blink as the **default** operating-float rail (it is already Afribit's production provider). Add self-hosted **LNbits** as an opt-in for program-provisioned custodial collector wallets, and **Fedimint / Fedi** as a third supported rail. Rework ADR-003 to describe the `LightningProvider` interface + `settings.toml` selection (D-22, D-23); rework ADR-006 so the custodial LNbits mode is an operator-enabled option behind gate G1, not the baseline.
3. **§6 — collector-address provisioning.** Add the bring-your-own path: a collector presents a Blink POS / Paycode (or any Lightning Address) QR at enrolment; it is scanned, resolved, validated as receive-capable, and written to the tag. Program-provisioning via LNbits is the alternative, not the only, path.
4. **§8 `material_rates`** — `rate_sats_per_kg BIGINT` becomes `rate_fiat_minor BIGINT` + `fiat_currency TEXT` (e.g. KES minor units). Add `exchange_rate_snapshots`. `collection_events.computed_sats` is documented as *indicative at record time*; the binding amount is set at payout time.
5. **§8 — new / changed tables:** credentials fields on `supervisors`, `partners`, `sessions.sponsor_partner_id`, `api_keys`, `treasury_topups`, `exchange_rate_snapshots`, `ledger_entries`, `ledger_checkpoints`, and `collectors.address_source`. See §9 below.
6. **§7 / §8 — ledger.** Adopt the single global `ledger_entries` chain (D-13). `collection_events` and `payouts` keep their columns but the canonical hash chain lives in `ledger_entries`.
7. **§11 Open Questions** — Q3 (hash-chain verification tooling) is answered by D-19; Q4 (Fedi guardianship) is resolved (the federation exists); keep Q1, Q2 open and map them to gates G2 and G3.

### 4.2 `Taka_Sats_PRD.md`

1. **§8 architecture summary** — show the payout rail as pluggable (Blink default / LNbits / Fedi); add the bring-your-own-wallet path and the public API box.
2. **§3 Non-Goals / §7.6 Regulatory** — record that the shipped default is non-custodial (BYO wallet + Blink float) and that the custodial LNbits mode is an operator-enabled option requiring their own legal review (G1).
3. **§6.9 / §14 Open Q3** — record that per-event amount disclosure is a runtime config in `settings.toml` (`exact` \| `bucketed` \| `omitted`), defaulting to `bucketed`, pending the team's decision.
4. **§13** — note that Phase 2's "open-source publication" is a v1 deliverable and that FR-9.2's open dataset is pulled into v1.
5. **§14 Open Questions** — mark Q2 (BLE scale model) and Q4 (Fedimint guardianship) as resolved per OQ-2 / OQ-4.

### 4.3 `Taka_Sats_Code_Style_Guide.md`

1. **§3.1** — add `worker/` (background jobs), `db/` (drizzle schema + migrations), `e2e/` (Playwright), `docker/`, `scripts/`, `messages/` (i18n), and `config/` (`settings.default.toml` + schema) to the project structure.
2. **New subsection under §9 or §2** — the config-first rule (D-21): no operational literal in domain code; defaults live in `config/settings.default.toml`; the merged config is Zod-validated at boot.
3. **§13** — the forthcoming CONTRIBUTING Guide is now part of v1 (Milestone 0); add a pointer.

### 4.4 New documents to add

- Under `docs/`: `DESIGN.md` (design system + UI component inventory + library choices), `adr/` (decision records), `openapi.yaml`, `LEDGER.md` (auditor's verification guide), `SELF_HOSTING.md`, `THREAT_MODEL.md`, `CONFIGURATION.md` (annotated walk-through of every `settings.toml` key).

---

## 5. System overview (updated)

```
   Collector NFC tag (NTAG213/216, receive-only, LNURL-pay)
   ── encodes the collector's OWN address (BYO, e.g. Blink Paycode)  ──┐
   ── or a program-provisioned LNbits address (custodial, opt-in)    ──┘
                                        │  physical tap
                                        ▼
        ┌──────────────────────────────────────────────────────────────┐
        │  CLIENT LAYER (one Next.js App Router project)                 │
        │  • Supervisor PWA  — offline-first, IndexedDB, Service Worker,  │
        │                       Web NFC / Camera / Geolocation           │
        │  • Admin dashboard — session config, live monitoring, reports  │
        │  • Public site     — transparency dashboard, open dataset      │
        └───────────────┬──────────────────────────────────────────────┘
                        │  HTTPS · /api/v1  (sync on reconnect)
                        ▼
        ┌──────────────────────────────────────────────────────────────┐
        │  API LAYER  (Next.js route handlers, /api/v1/*)                │
        │  • Auth.js sessions (humans) · API keys (third parties)        │
        │  • Zod-validated input · no business logic in handlers         │
        │  • Idempotent write endpoints (client UUID keys)               │
        └───────┬───────────────────────────────┬──────────────────────┘
                │                               │
                ▼                               ▼
        ┌───────────────┐               ┌──────────────────┐
        │ PostgreSQL     │               │ Object storage    │
        │ (Neon / local) │               │ (R2 / MinIO local)│
        │  domain +      │               │  evidence photos  │
        │  ledger_entries│               └──────────────────┘
        └───────┬───────┘
                │
   ┌────────────┼───────────────────┬───────────────┬──────────────┐
   ▼            ▼                   ▼               ▼              ▼
┌────────┐ ┌───────────────────┐ ┌────────────┐ ┌────────────┐ ┌──────────┐
│ worker │ │ LightningProvider  │ │ Nostr relay │ │OpenStreetMap│ │ Exchange │
│(pg-boss)│ │ (settings.toml):   │ │(attestation)│ │ (map tiles) │ │rate feeds│
│ recon,  │ │  • BlinkProvider   │ └────────────┘ └────────────┘ │ (BTC/KES)│
│ anomaly,│ │    (default float) │                               └──────────┘
│ payouts,│ │  • LNbitsProvider  │   Cold reserve: Trezor 2-of-3 multisig
│ alerts, │ │    (opt-in custodial│   (Ronnie + Treasurer + Advisor), manual
│ ckpts   │ │     provisioning)  │   or threshold-triggered top-up to the
└────────┘ │  • FedimintProvider│   active float wallet
           │    (Fedi, fedi.xyz)│
           └───────────────────┘
```

`computePayout` and the payout code path are identical whichever provider is active; only the `LightningProvider` implementation and whether collector wallets are program-provisioned change (D-22).

**Deployment targets (D-03):**

- **Self-host:** `docker compose up` → app, Postgres, MinIO (R2-compatible), worker, a local Nostr relay, and — only if the operator enables custodial mode — LNbits. One `.env` for secrets, one `config/settings.toml` for everything else.
- **Managed:** Vercel (app + API), Neon (Postgres), Cloudflare R2 (photos), Vercel Cron → authed internal enqueue routes, an external Lightning provider (Blink account by default), a public Nostr relay.

---

## 6. Functional requirements — consolidated disposition

Every PRD functional requirement, its v1 disposition, and the milestone that delivers it. "Milestone" is the build stage that delivers it (M0 to M8).

| FR | Summary | v1 disposition | Milestone |
|---|---|---|---|
| FR-1.1 | Issue static NFC tag encoding a Lightning Address | In (BYO scan default; LNbits bulk-provision opt-in — D-05) | M1 |
| FR-1.2 | Enrolment needs only a name/alias — no ID, phone, or literacy test | In | M1 |
| FR-1.3 | Replace lost/damaged tag by remapping, no fund-recovery risk | In | M1 |
| FR-1.4 | Revoke a tag's server-side mapping without affecting others | In | M1 |
| FR-1.5 | Tags physically durable (IP67/68), lanyard-wearable | In — procurement + 2-week field test | M1 / M8 |
| FR-2.1 | Record collection: tap → material → weight → mandatory photo → auto sats calc | In (manual weight; BLE in M8) | M3 |
| FR-2.2 | Multiple materials, independently configurable per-kg rates, admin-only | In (fiat-per-kg per D-14) | M2 |
| FR-2.3 | Capture collector, material, weight, sats, photo, timestamp, GPS, supervisor id | In | M3 |
| FR-2.4 | Collection events fully functional offline | In | M3 |
| FR-3.1 | Supervisors cannot move treasury funds — payout is a system function | In | M2 (RBAC) / M5 |
| FR-3.2 | Above-threshold payouts need a second independent sign-off | In | M5 |
| FR-3.3 | Append-only, cryptographically signed ledger; corrections are new linked records | In | M4 |
| FR-3.4 | Public Nostr attestation per verified collection, PII-excluded | In | M7 |
| FR-3.5 | Reconciliation: paid kg vs recycler-sold kg, variance surfaced | In (from day one per PRD §13) | M6 |
| FR-3.6 | Flag statistical anomalies for admin review | In | M6 |
| FR-3.7 | Supervisor rotation scheduling + verifier audit log | In | M2 / M6 |
| FR-4.1 | Supervisor app is an installable offline-first PWA; all core actions local | In | M3 |
| FR-4.2 | Sync queued events on reconnect, conflict-resolved, no data loss | In | M4 |
| FR-4.3 | Surface pending-sync status (queued / syncing / confirmed) | In | M3 / M4 |
| FR-5.1 | Every event's GPS captured as byproduct; available as an open-data layer | In (capture M3; open layer M7) | M3 / M7 |
| FR-5.2 | Admin map view, filterable by date range and material | In | M7 |
| FR-6.1 | Admin creates and assigns supervisor shifts per session/location | In | M2 |
| FR-6.2 | Alert admin of unstaffed coverage gaps ahead of a session | In | M6 |
| FR-6.3 | Self-serve "pending weigh" record, payable only after supervisor verification | In | M6 |
| FR-7.1 | Operating float separate from cold multisig reserve | In (float provider per settings: Blink default / LNbits / Fedi; Trezor 2-of-3 cold) | M5 |
| FR-7.2 | Alert when float below threshold; manual/automated top-up from cold | In (alert + manual top-up; auto optional) | M5 / M6 |
| FR-7.3 | Payout via the configured provider to collector's Lightning Address, fiat-equivalent → sats at disbursement | In | M5 |
| FR-7.4 | Depleted pool → visible "pending payout" balance, not silently dropped | In | M5 |
| FR-7.5 | Real-time treasury status + public transparent accounting summary | In | M6 / M7 |
| FR-8.1 | Admin creates/configures/monitors sessions (rates, supervisors, geo scope) | In | M2 |
| FR-8.2 | Live session view: collectors verified, kg, sats, anomaly flags | In | M6 |
| FR-8.3 | Generate partner/funder reports (aggregate, pseudonymised), branded rendering | In | M7 |
| FR-9.1 | Partner read-only aggregate view scoped to sponsored sessions, no PII | In | M7 |
| FR-9.2 | Export open, pseudonymised dataset for public publication | In (via API + export) | M7 |

Nothing in the PRD's FR set is dropped from v1. The only descoped items are the Phase 3 explorations listed in §1.2, none of which have an FR number.

---

## 7. Collector identity and Lightning provisioning

### 7.1 Enrolment (FR-1.2, US-1.1, D-05, D-22)

A supervisor enrols a collector with **one required field: `alias`** (a name or chosen alias). No ID, phone, DOB, address, or literacy step. The system creates a `collectors` row with a server-allocated `public_code` (D-24) and `status = 'pending'` when a supervisor registers (a `hub_lead`/`admin` registers straight to `active`; `collectors.authorization_required = false` makes every registration `active`) — the authorization gate (D-25). It then obtains a receive-only Lightning Address by one of two paths, chosen per collector and constrained by `settings.custody`. The address becomes a `collector_payment_destinations` row (D-26); a scanned **Pay** QR of a wallet card is rejected, only its **Receive** QR / Lightning Address is accepted:

**Path A — Bring-your-own wallet (`address_source = 'byo'`; shipped default).**
1. The collector shows their own payment QR — a **Blink POS / Paycode**, a Lightning Address, or any LNURL-pay code.
2. The PWA scans it (camera), normalises it to a Lightning Address / LNURL-pay link, and validates it is **receive-capable and resolvable** (a `LNURLp` GET, or an address probe) — a withdraw (`LNURLw`) code is rejected.
3. The validated address is stored as the collector's primary payment destination (D-26). A physical tag, if the programme uses one, carries only `takasats:<public_code>` (D-24) and is issued only to an authorized collector (D-25); the mapping is recorded in `tag_history`.
4. Afribit never creates or holds a wallet for this collector. Their earnings land in their own account the instant a payout is sent — this is what keeps an operator without a virtual-asset licence out of custodial scope.

**Path B — Program-provisioned wallet (`address_source = 'provisioned'`; opt-in, requires `settings.custody.provisioning_enabled = true` + G1).**
1. The server calls LNbits to create a wallet and an LNURLp / Lightning Address for the collector (`{id}@<lnbits-host>`), stored on the collector row.
2. The address is written to the tag as in Path A.
3. Afribit custodies a balance designated to this collector until payout — hence gate G1.

**Offline enrolment.** Path A works fully offline once the QR is scanned (validation is deferred to sync, and the event still queues). Path B queues the `collectors` row and a provisional `tag_history` entry; the LNbits wallet is created on sync and the tag written when the address resolves. In both paths, a collector with no usable address yet can still be weighed — events queue and payout waits, consistent with FR-7.4.

An operator can also run **mixed**: e.g. BYO for collectors who already have the Blink app, program-provisioned for those who do not, with `settings.custody.default_address_source` picking the enrolment default.

### 7.2 Tags are receive-only (ADR-001, US-1.2, US-1.3)

> **Amended by D-24 / ADR-0017:** a tag no longer encodes a payment target — it encodes `takasats:<public_code>`, an identity reference only. A found tag reveals nothing and can pay nobody; the paragraph below describes the original receive-only design and its guarantees still hold (nothing on a credential can withdraw).

The tag encodes a **static LNURL-pay link / Lightning Address only**. There is no `LNURLw`, no rolling code, no NTAG424. A found tag lets a stranger *send* money to the collector, never withdraw. Reissue = map a new physical tag to the same `collectors.id`; the earnings history is untouched. The back of the physical card states this in plain language (Brand Guidelines §6).

### 7.3 Revocation (FR-1.4, US-1.4)

An admin revokes a mapping: `tag_history.revoked_at` is set, and the tag id is added to a revocation set. A subsequent tap of a revoked tag is rejected by the PWA and the API, and the attempt is logged (`anomaly_flags` with `flag_type = 'revoked_tag_tap'`). Other collectors are unaffected — revocation is per `tag_id`, never global.

### 7.4 Operating float and provider notes

The **operating float** is Afribit's own money that payouts are sent *from* — it is not a per-collector balance, and it exists in every configuration (even pure BYO: something has to send the sats). The float wallet is whatever the active `LightningProvider` provides:

- **`blink` (default).** The float is an Afribit-controlled Blink account (already in production). Payouts call the Blink API to send to the collector's address. No self-hosted custody anywhere; combined with BYO collector addresses this is the non-custodial baseline.
- **`lnbits` (opt-in).** LNbits runs as its own container/host. The float is a dedicated LNbits wallet (`hot-float`); if `provisioning_enabled`, each collector also has a wallet within the same instance. **This makes Afribit a custodian of collector-designated balances → G1 before real funds.**
- **`fedimint` (opt-in).** The float is a wallet in Afribit's Fedi federation (fedi.xyz); payouts spend federation ecash / Lightning to the collector's address.

Common to all: the float is topped up from the Trezor 2-of-3 cold reserve (§9 `treasury_topups`); provider API keys and the LNbits admin key live in the environment, never in the client, never logged (Code Style Guide §9.6); the low-balance alert and pending-payout accrual (FR-7.2, FR-7.4) are provider-agnostic.

---

## 8. Weighing and collection workflow (FR-2.x, US-2.x)

### 8.1 The flow (one continuous screen sequence in the PWA)

```
Tap tag ─► resolve collector (offline: from cached collector list;
          fallback: manual search by alias — a first-class path, G2)
   │
   ▼
Select material  (chips, icon + Swahili/Sheng/English label,
                  only materials with an active rate for this session)
   │
   ▼
Enter weight  (numeric pad, kg, NUMERIC(6,3); BLE auto-fill in M8)
   │
   ▼
Capture photo  (mandatory — scale reading + waste in frame;
                SHA-256 computed on-device now, per D-12)
   │
   ▼
Review  (collector alias, material, weight, indicative sats at today's rate)
   │
   ▼
Confirm ─► write CollectionEvent to IndexedDB immediately (no network wait)
        ─► enqueue in the sync Outbox
        ─► show SyncStatusIndicator: "queued"
```

### 8.2 Captured per event (FR-2.3)

`id` (client UUID v4, the idempotency key) · `collector_id` · `supervisor_id` (non-nullable, from session token) · `session_id` · `material` · `weight_kg` · `rate_id` (the versioned rate active at capture) · `indicative_sats` · `photo_url` · `photo_sha256` · `gps_lat` / `gps_lng` (+ `gps_accuracy_m`) · `recorded_at` (device-local) · `registration_type` (`tap` \| `walk_in` \| `pending_self_serve`) · `weight_source` (`manual` \| `ble_scale` \| `serial_scale` \| `industrial_scale`; default `manual`) + optional `scale_id` / `scale_reading_raw` (D-27) · `content_hash` (client-computed, deterministic serialisation over all of the above that are signed).

If GPS is unavailable, the PWA **warns before allowing save** and records `gps_lat/lng = NULL` with `gps_unavailable_reason` (US-2.3).

### 8.3 Rates (FR-2.2, US-2.2, D-14)

`material_rates` is versioned and never overwritten. A rate row: `material`, `rate_fiat_minor` (e.g. KES cents per kg), `fiat_currency`, `effective_from`, `effective_to` (NULL = active). Editing a rate inserts a new row and closes the old one. A historical event always displays the rate that was active when it was recorded, never the current rate. Only `admin` can change rates.

`indicative_sats` shown at capture = `rate_fiat_minor × weight_kg` converted at the latest cached exchange snapshot. The **binding** sats amount is computed at payout time (§10.4, US-7.3).

---

## 9. Data model (implementation-level)

Extends Tech Arch §8. `snake_case` columns; Drizzle maps to camelCase in app code (Code Style Guide §4). New or changed tables are marked **NEW** / **CHANGED**.

```sql
-- ── IDENTITY ─────────────────────────────────────────────────────────
collectors (
  id                UUID PRIMARY KEY,
  alias             TEXT NOT NULL,
  nfc_tag_id        TEXT UNIQUE,                 -- current active tag
  address_source    TEXT NOT NULL DEFAULT 'byo', -- NEW: byo | provisioned  (D-05/D-22)
  lightning_address TEXT,                        -- CHANGED: nullable until scanned/provisioned
  lnurl_pay_raw     TEXT,                        -- NEW: original scanned payload (byo), for re-write/audit
  lnbits_wallet_id  TEXT,                        -- NEW: set only when address_source = 'provisioned'
  enrolled_at       TIMESTAMPTZ NOT NULL,
  status            TEXT NOT NULL DEFAULT 'active'  -- active | revoked
)

tag_history (
  id           UUID PRIMARY KEY,
  collector_id UUID NOT NULL REFERENCES collectors(id),
  tag_id       TEXT NOT NULL,
  issued_at    TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ
)

supervisors (                                    -- CHANGED: now the staff-user table
  id             UUID PRIMARY KEY,
  name           TEXT NOT NULL,
  phone          TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'supervisor',  -- supervisor | hub_lead | admin
  password_hash  TEXT NOT NULL,                  -- NEW (Auth.js credentials)
  locale         TEXT NOT NULL DEFAULT 'en',     -- NEW
  active         BOOLEAN NOT NULL DEFAULT true,
  last_login_at  TIMESTAMPTZ                     -- NEW
)

partners (                                       -- NEW
  id         UUID PRIMARY KEY,
  name       TEXT NOT NULL,
  contact    TEXT,
  login_email TEXT UNIQUE,
  password_hash TEXT,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL
)

api_keys (                                       -- NEW
  id           UUID PRIMARY KEY,
  label        TEXT NOT NULL,
  key_hash     TEXT NOT NULL,                    -- sha256 of the token; token shown once
  scopes       TEXT[] NOT NULL DEFAULT '{public:read}',
  partner_id   UUID REFERENCES partners(id),    -- nullable
  created_by   UUID NOT NULL REFERENCES supervisors(id),
  created_at   TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ
)

-- ── SESSIONS & RATES ─────────────────────────────────────────────────
sessions (
  id                UUID PRIMARY KEY,
  location          TEXT NOT NULL,
  geo_bounds        JSONB,                       -- NEW: optional polygon for scope
  scheduled_start   TIMESTAMPTZ NOT NULL,
  scheduled_end     TIMESTAMPTZ NOT NULL,
  status            TEXT NOT NULL,               -- scheduled | active | closed
  sponsor_partner_id UUID REFERENCES partners(id) -- NEW
)

session_supervisors (
  session_id    UUID REFERENCES sessions(id),
  supervisor_id UUID REFERENCES supervisors(id),
  PRIMARY KEY (session_id, supervisor_id)
)

material_rates (                                 -- CHANGED
  id              UUID PRIMARY KEY,
  material        TEXT NOT NULL,
  rate_fiat_minor BIGINT NOT NULL,               -- CHANGED from rate_sats_per_kg
  fiat_currency   TEXT NOT NULL DEFAULT 'KES',   -- NEW
  effective_from  TIMESTAMPTZ NOT NULL,
  effective_to    TIMESTAMPTZ
)

supervisor_rotations (                           -- NEW (FR-3.7 / FR-6.1)
  id            UUID PRIMARY KEY,
  supervisor_id UUID NOT NULL REFERENCES supervisors(id),
  location      TEXT NOT NULL,
  window_start  TIMESTAMPTZ NOT NULL,
  window_end    TIMESTAMPTZ NOT NULL
)

-- ── COLLECTION EVENTS (detail; canonical chain is ledger_entries) ────
collection_events (
  id                 UUID PRIMARY KEY,           -- client-generated idempotency key
  ledger_entry_id    UUID UNIQUE REFERENCES ledger_entries(id),  -- NEW link
  collector_id       UUID NOT NULL REFERENCES collectors(id),
  supervisor_id      UUID NOT NULL REFERENCES supervisors(id),
  session_id         UUID REFERENCES sessions(id),
  material           TEXT NOT NULL,
  weight_kg          NUMERIC(6,3) NOT NULL,
  rate_id            UUID NOT NULL REFERENCES material_rates(id),
  indicative_sats    BIGINT NOT NULL,            -- CHANGED name (was computed_sats)
  photo_url          TEXT NOT NULL,
  photo_sha256       TEXT NOT NULL,              -- CHANGED name
  gps_lat            NUMERIC, gps_lng NUMERIC,
  gps_accuracy_m     NUMERIC,                    -- NEW
  gps_unavailable_reason TEXT,                   -- NEW
  recorded_at        TIMESTAMPTZ NOT NULL,       -- device-local capture time
  synced_at          TIMESTAMPTZ,
  registration_type  TEXT NOT NULL DEFAULT 'tap',-- tap | walk_in | pending_self_serve
  verification_status TEXT NOT NULL DEFAULT 'verified'
      -- verified | pending_supervisor_review (for pending_self_serve)
)

-- ── PAYOUTS (detail) ────────────────────────────────────────────────
payouts (
  id                  UUID PRIMARY KEY,
  ledger_entry_id     UUID UNIQUE REFERENCES ledger_entries(id),  -- NEW link
  collection_event_id UUID UNIQUE REFERENCES collection_events(id),
  amount_sats         BIGINT NOT NULL,
  amount_fiat_minor   BIGINT NOT NULL,           -- CHANGED (minor units)
  fiat_currency       TEXT NOT NULL,
  exchange_snapshot_id UUID REFERENCES exchange_rate_snapshots(id), -- NEW
  status              TEXT NOT NULL,
      -- pending_approval | pending_float | paid | failed
  approved_by         UUID REFERENCES supervisors(id),
  provider            TEXT NOT NULL,            -- NEW: blink | lnbits | fedimint (which rail paid it)
  provider_payment_ref TEXT,                    -- CHANGED: was blink_transaction_id; provider-specific id
  attempted_at        TIMESTAMPTZ,
  settled_at          TIMESTAMPTZ,
  error_message       TEXT
)

-- ── TREASURY ────────────────────────────────────────────────────────
treasury_snapshots (
  id                   UUID PRIMARY KEY,
  taken_at             TIMESTAMPTZ NOT NULL,
  hot_balance_sats     BIGINT NOT NULL,
  cold_balance_sats    BIGINT NOT NULL,
  pending_payouts_sats BIGINT NOT NULL
)

treasury_topups (                                -- NEW (FR-7.2, D-28, ADR-0020; migration 0011)
  id                UUID PRIMARY KEY,
  ledger_entry_id   UUID UNIQUE NOT NULL REFERENCES ledger_entries(id),   -- the proposal
  amount_sats       BIGINT NOT NULL CHECK (amount_sats > 0),
  note              TEXT,
  status            TEXT NOT NULL,               -- proposed | approved | transferred | confirmed | rejected | cancelled
  proposed_by       UUID NOT NULL REFERENCES supervisors(id),
  approvals_required INT NOT NULL,               -- snapshot of treasury.topup_approvals_required
  float_baseline_sats BIGINT, float_baseline_at TIMESTAMPTZ,   -- hot-wallet float when the quorum was reached
  transfer_reference TEXT UNIQUE,                -- the pool transfer's txid or reference (one transfer, one proposal)
  transferred_by UUID, transferred_at TIMESTAMPTZ, transfer_ledger_entry_id UUID UNIQUE,
  outcome_at TIMESTAMPTZ, outcome_by UUID, outcome_reason TEXT, outcome_ledger_entry_id UUID UNIQUE,  -- confirmed | rejected | cancelled
  created_at        TIMESTAMPTZ NOT NULL
)

treasury_topup_signoffs (                        -- NEW (M5-7): one steward's approval; append-only
  id UUID PRIMARY KEY,
  topup_id UUID NOT NULL REFERENCES treasury_topups(id),
  supervisor_id UUID NOT NULL REFERENCES supervisors(id),   -- trigger: never the proposer
  ledger_entry_id UUID UNIQUE NOT NULL REFERENCES ledger_entries(id),
  approved_at TIMESTAMPTZ NOT NULL,
  UNIQUE (topup_id, supervisor_id)
)

exchange_rate_snapshots (                        -- NEW (US-7.3, D-18)
  id          UUID PRIMARY KEY,
  base        TEXT NOT NULL,                     -- 'BTC'
  quote       TEXT NOT NULL,                     -- 'KES'
  rate        NUMERIC NOT NULL,
  sources     JSONB NOT NULL,                    -- [{source, rate}]
  fetched_at  TIMESTAMPTZ NOT NULL
)

-- ── RECONCILIATION & FRAUD ─────────────────────────────────────────
recycler_sales (
  id         UUID PRIMARY KEY,
  material   TEXT NOT NULL,
  weight_kg  NUMERIC NOT NULL,
  sold_at    TIMESTAMPTZ NOT NULL,
  buyer      TEXT NOT NULL,
  entered_by UUID REFERENCES supervisors(id)     -- NEW (audit; feeds G3)
)

reconciliation_reports (
  id            UUID PRIMARY KEY,
  period_start  TIMESTAMPTZ, period_end TIMESTAMPTZ,
  material      TEXT,
  paid_kg       NUMERIC, sold_kg NUMERIC,
  variance_pct  NUMERIC,
  flagged       BOOLEAN NOT NULL DEFAULT false,
  generated_at  TIMESTAMPTZ NOT NULL
)

anomaly_flags (
  id                  UUID PRIMARY KEY,
  collection_event_id UUID REFERENCES collection_events(id),  -- nullable (a revoked_tag_tap has no event)
  flag_type           TEXT NOT NULL,
      -- identical_weight_repeat | payout_concentration | off_hours
      -- | revoked_tag_tap | gps_outlier | rate_change_during_queue
  context             JSONB,                      -- NEW (M1-9): investigation detail, e.g. { tag_id }
  detected_at         TIMESTAMPTZ NOT NULL,
  reviewed_by         UUID REFERENCES supervisors(id),
  review_outcome      TEXT                        -- confirmed | dismissed
)

> Created early (minimal) at M1-9 for `revoked_tag_tap`: the
> `collection_event_id` FK is added with `collection_events` (M3/M4); the
> detectors that populate the other `flag_type`s are M6-4.

-- ── LEDGER (canonical append-only chain, D-13) ─────────────────────
ledger_entries (                                 -- NEW
  id               UUID PRIMARY KEY,             -- = detail row's client UUID where applicable
  seq              BIGSERIAL UNIQUE,             -- server-assigned monotonic order
  entry_type       TEXT NOT NULL,
      -- collection_event | payout | correction | treasury_topup
      -- | rate_change | tag_revocation
  payload_hash     TEXT NOT NULL,               -- sha256 of canonical payload
  prev_entry_hash  TEXT,                        -- hash of seq-1's entry_hash (NULL at genesis)
  entry_hash       TEXT NOT NULL,               -- sha256(seq || entry_type || payload_hash || prev_entry_hash)
  references_id    UUID,                         -- for corrections: the entry being corrected
  created_at       TIMESTAMPTZ NOT NULL,        -- server ingestion time
  device_recorded_at TIMESTAMPTZ                 -- original device-local time, if offline-origin
)
-- UPDATE and DELETE on ledger_entries are revoked at the DB role level.
-- Corrections are new rows with entry_type = 'correction', references_id set.

ledger_checkpoints (                             -- NEW (D-19, external verification)
  id             UUID PRIMARY KEY,
  through_seq     BIGINT NOT NULL,
  entry_hash      TEXT NOT NULL,                 -- entry_hash at through_seq
  signature       TEXT NOT NULL,                 -- programme key signature over (through_seq || entry_hash)
  nostr_event_id  TEXT,                          -- optional public anchor
  opentimestamps  TEXT,                          -- optional OTS proof
  created_at      TIMESTAMPTZ NOT NULL
)

-- ── PUBLIC ATTESTATIONS ───────────────────────────────────────────
attestations (
  collection_event_id UUID PRIMARY KEY REFERENCES collection_events(id),
  nostr_event_id      TEXT NOT NULL,
  amount_disclosure   TEXT NOT NULL DEFAULT 'bucketed',  -- exact | bucketed | omitted
  published_at        TIMESTAMPTZ NOT NULL
)
```

`pg-boss` manages its own tables in a dedicated `pgboss` schema — not modelled here.

---

## 10. API surface (`/api/v1`)

D-01 makes this a product. All routes are Zod-validated, versioned, and documented in `docs/openapi.yaml` (generated from the Zod schemas; served at `/api/v1/openapi.json` with a Scalar docs page at `/api/v1/docs`).

### 10.1 Conventions

- **Base path** `/api/v1`. Breaking changes → `/api/v2`; v1 stays supported for a deprecation window.
- **Auth:** `Authorization: Bearer <token>` — an Auth.js session token (humans, via the app) or an API key (third parties). Public endpoints need no token.
- **Idempotency:** every write endpoint requires a client-supplied UUID (`id` in the body, or an `Idempotency-Key` header). Re-sending a completed write is a no-op that returns the original result (FR-4.2, Code Style Guide §7).
- **Errors:** typed, structured — `{ error: { code, message, details? } }`. Never a bare string. HTTP status matches the class.
- **Rate limits:** per-key and per-IP token bucket; limits returned in `RateLimit-*` headers.
- **Pagination:** cursor-based (`?cursor=&limit=`).
- **No PII in any response available to `partner` or `public:read` scope** — aliases, phone numbers, individual payout amounts, and precise GPS are filtered server-side for those scopes.

### 10.2 Endpoint groups

| Group | Endpoints (representative) | Scope / role |
|---|---|---|
| **Sync** | `POST /api/v1/sync/events` (batch upsert by UUID), `GET /api/v1/sync/cursor` | `supervisor` |
| **Collectors** | `POST /collectors`, `GET /collectors/:id`, `POST /collectors/:id/tags` (reissue), `POST /collectors/:id/tags/revoke` | `supervisor` (create/reissue), `admin` (revoke) |
| **Sessions** | `POST /sessions`, `PATCH /sessions/:id`, `GET /sessions`, `GET /sessions/:id/live` (SSE stream) | `admin` (write), `supervisor`/`partner` (scoped read) |
| **Rates** | `GET /rates`, `POST /rates` (new version), `GET /rates/history` | `admin` (write), `supervisor` (read) |
| **Collection events** | `GET /events`, `GET /events/:id`, `POST /events/:id/verify` (pending_self_serve → verified) | `supervisor`/`admin` |
| **Payouts** | `GET /payouts`, `POST /payouts/:id/approve` (second sign-off) | `hub_lead`/`admin`. **No execute endpoint exists** (Code Style Guide §9.3). |
| **Treasury** | `GET /treasury`, `GET`/`POST /treasury/topups`, `GET /treasury/topups/:id`, `POST /treasury/topups/:id/{signoff,transfer,cancel,reject,confirm}` (the funding vote, ADR-0020; detail in `docs/BACKEND.md` §5.3) | `admin` (`treasury:read` / `treasury:propose` / `treasury:approve`; approvers are distinct and never the proposer) |
| **Reconciliation** | `GET /reconciliation`, `POST /recycler-sales` | `admin` |
| **Anomalies** | `GET /anomalies`, `POST /anomalies/:id/review` | `admin` |
| **Reports** | `POST /reports` (partner/funder, aggregate, branded), `GET /reports/:id` | `admin`, `partner` (own scope) |
| **Map** | `GET /map/points?from=&to=&material=` (clustered, jittered for `public`) | `admin` (precise), `public:read` (aggregated) |
| **Ledger / transparency** | `GET /ledger?from_seq=&limit=` (stream chain), `GET /ledger/checkpoints`, `GET /ledger/verify` | `public:read` |
| **Open dataset** | `GET /dataset` (pseudonymised kg / sats / retention / reconciliation status; JSON + CSV), `GET /dataset/versions` | `public:read` (FR-9.2) |
| **Stats** | `GET /stats/summary` (cumulative kg, sats, unique collectors, cost per kg) | `public:read` |
| **API keys** | `POST /api-keys`, `GET /api-keys`, `POST /api-keys/:id/revoke` | `admin` |
| **Health / meta** | `GET /health`, `GET /api/v1/openapi.json` | public |

### 10.3 Sync endpoint contract (FR-4.2, ADR-004)

```
POST /api/v1/sync/events
Body: { events: CollectionEventInput[] }   // each carries its client UUID + content_hash
For each event:
  • upsert by id (idempotent — already-synced id returns its stored result, no dup)
  • validate: rate_id active at recorded_at, supervisor assigned to session,
              photo_sha256 matches uploaded bytes, weight/GPS within sane bounds
  • on success: create a ledger_entries row (server assigns seq, links prev hash),
                link collection_events.ledger_entry_id, return { id, status: 'confirmed', seq }
  • on validation failure: return { id, status: 'needs_attention', reason } — never a silent drop
Response: { results: SyncResult[] }   // one per submitted event, same order
```

Conflict on genuinely mutable shared state (a collector profile edited on two devices, a rate changed while events were queued against it): **last-write-wins by timestamp + an `anomaly_flags` row** if the two writes were suspiciously close (ADR-004). No CRDT.

### 10.4 Payout execution (internal, not an HTTP endpoint — FR-7.3, US-7.3)

Runs in the `worker`, triggered when a collection event is confirmed:

```
1. computePayout(weight_kg, rate)            // lib/money.ts — the ONLY sats arithmetic
2. exchange snapshot fresh? (age < TTL, D-18) — else defer, alert
3. amount_sats = fiat_equivalent(rate, weight) / snapshot.rate
4. above settings.payouts.second_signoff_threshold?  ── yes ─► payouts.status = 'pending_approval', stop
5. operating float ≥ amount_sats?    ── no  ─► payouts.status = 'pending_float', stop (FR-7.4)
6. destination = collector.lightning_address  // resolved server-side ONLY (§12.3 style guide §9.3)
                                              // NEVER from the request body
7. provider = LightningProvider.fromConfig()  // Blink | LNbits | Fedimint, per settings.toml (D-22)
   provider.pay(destination, amount_sats)      // same call regardless of which one
8. record payouts row + ledger_entries row (entry_type='payout')
9. enqueue Nostr attestation (M7)
```

Step 6 is the separation-of-duties keystone and does not change with the provider or custody mode: the destination is always the address on the collector row (put there at enrolment from the tag, §7.1), never client input. A `pending_float` payout is retried by the worker after a top-up **without re-verifying** the collection event (FR-7.4). A `pending_approval` payout resumes at step 5 once a distinct `hub_lead`/`admin` approves (FR-3.2).

---

## 11. Ledger and tamper-evidence (FR-3.3, US-3.3, D-13, D-19)

### 11.1 Chain construction

- Every money- or trust-relevant fact becomes a `ledger_entries` row: collection events, payouts, corrections, treasury top-ups, rate changes, tag revocations.
- The client computes a **content hash** (`payload_hash`) over a canonical JSON serialisation of the fact at capture time. This binds the record to its content from the moment of creation, before it ever reaches the server.
- On ingestion the server assigns `seq` (monotonic), sets `prev_entry_hash` to the previous entry's `entry_hash`, and computes `entry_hash = sha256(seq || entry_type || payload_hash || prev_entry_hash)`. Ordering is by **server ingestion**, not device clock — offline events slot in when they arrive, which is honest about what the server can actually attest.
- `UPDATE` and `DELETE` on `ledger_entries` are revoked at the database role level (Code Style Guide §8, Tech Arch §7). A correction is a new `entry_type = 'correction'` row whose `references_id` points at the entry it supersedes.

### 11.2 Checkpoints and external verification

- The worker periodically writes a `ledger_checkpoints` row: `through_seq`, the `entry_hash` at that seq, and a signature from the programme key. Optionally it publishes the checkpoint hash as a Nostr event and/or an OpenTimestamps proof so the state at time _T_ is anchored in a way Afribit cannot backdate.
- `GET /api/v1/ledger` streams the chain; `GET /api/v1/ledger/verify` recomputes it server-side and reports the first broken link, if any.
- `scripts/verify-ledger.ts` does the same offline from a downloaded dump — a skeptical funder runs one command, or reads `docs/LEDGER.md` and checks a checkpoint signature by hand (D-19, Tech Arch Open Q 3).

---

## 12. Money-handling rules (binding — Code Style Guide §9)

Restated here because they constrain the schema and API above. The Code Style Guide is authoritative; this is a pointer, not a replacement.

1. Sats are always integers, always a branded type (`type Sats = number & { readonly __brand: 'Sats' }`), constructed only through a validated helper.
2. **Exactly one** function computes a payout amount: `lib/money.ts:computePayout`. `weight * rate` anywhere else is a bug.
3. Payout **destination is never client input** — always resolved server-side from the tag mapping. An API body field named `destination` in a payout context is a security defect (§10.2 has no such field by construction).
4. No payout code path is reachable by a `supervisor` token — enforced by RBAC middleware *and* a redundant unit test on the role's scope set.
5. Every money-affecting function has ≥1 adversarial test (negative weight, zero rate, payout > operating float, duplicate idempotency key).
6. No `console.log` of a full payout object, API key, Lightning address, or LNbits key in any production-reachable path. Logging is structured with an explicit safe-field allow-list.
7. Money columns are `BIGINT` (sats) or `NUMERIC` with fixed precision (weights, fiat minor units) — never `FLOAT`/`DOUBLE` (Code Style Guide §8).

---

## 13. Configuration and settings (nothing hardcoded — D-21)

Every operational value lives in configuration, not in source. This is what lets a programme in another city run this codebase by editing one file.

### 13.1 Layering

1. **`config/settings.default.toml`** — committed to the repo, every key present, every value documented with a comment. This is the reference and the fallback.
2. **`config/settings.toml`** — git-ignored; the operator's overrides. Only the keys they change.
3. **Environment variables** — override any key (`TAKASATS__PAYOUTS__SECOND_SIGNOFF_THRESHOLD=...`), for platforms where a file is awkward (Vercel).
4. **Secrets are never in TOML.** `DATABASE_URL`, `BLINK_API_KEY`, `LNBITS_ADMIN_KEY`, `NOSTR_PRIVATE_KEY`, `AUTH_SECRET`, object-storage credentials → environment only. `settings.toml` may name *which* provider, never a key.

`lib/config/` loads the three layers, merges them, validates the result with a Zod schema, and exports a frozen typed object. **A missing or out-of-range value fails the boot**, loudly — the app never starts on a half-valid config. `docs/CONFIGURATION.md` is the annotated walk-through.

### 13.2 The settings surface (v1)

```toml
[programme]
name            = "Taka Sats by Afribit Africa"
timezone        = "Africa/Nairobi"
fiat_currency   = "KES"                 # rate table + reporting currency
locales         = ["en", "sw", "sheng"]
default_locale  = "en"

[custody]
# 'byo'         = collector brings their own wallet (Blink Paycode / Lightning Address)
# 'provisioned' = server mints an LNbits wallet per collector (custodial — needs G1)
default_address_source = "byo"
provisioning_enabled   = false          # must be explicitly true to allow 'provisioned'
provisioning_ack       = ""             # operator must paste the G1 acknowledgement string

[lightning]
float_provider  = "blink"               # blink | lnbits | fedimint
# per-provider non-secret settings (hosts, wallet ids, federation invite code) below
[lightning.blink]
api_url         = "https://api.blink.sv/graphql"
float_wallet_id = ""
[lightning.lnbits]
base_url        = "http://lnbits:5000"
float_wallet_id = ""
[lightning.fedimint]
federation_invite = ""                  # Afribit's federation (fedi.xyz)

[money]
rate_staleness_ttl_seconds = 900        # payout will not run against an older BTC rate (D-18)
exchange_sources = ["kraken", "yadio"]  # ≥2 independent; order = preference

[rates]
# seed values for material_rates on first migration; edited afterwards via the admin UI,
# which writes new versioned rows (FR-2.2). Units: fiat minor (e.g. KES cents) per kg.
seed = [
  { material = "PET",       rate_fiat_minor_per_kg = 2000 },
  { material = "HDPE",      rate_fiat_minor_per_kg = 1500 },
  { material = "aluminium", rate_fiat_minor_per_kg = 8000 },
]

[payouts]
second_signoff_threshold_sats = 50000   # above this, a distinct approver is required (FR-3.2)
float_low_balance_alert_sats  = 200000   # worker alerts admin below this (FR-7.2)
auto_topup_enabled            = false

[treasury]
topup_approvals_required = 2             # distinct stewards who approve a pool-to-hot-wallet refill; never counting the proposer (D-28)
hot_wallet_cap_sats      = 0             # a proposal that would take the hot wallet above this (float + funding in flight + amount) is refused; 0 = no cap

[reconciliation]
variance_tolerance_pct = 5              # above this, the report is flagged (FR-3.5)

[anomaly]
identical_weight_repeat_count = 4       # N identical weights from one supervisor → flag
payout_concentration_gini     = 0.6     # skew above this over a session → flag
off_hours_grace_minutes       = 30

[scheduling]
coverage_gap_lead_time_hours  = 12      # unstaffed session within this window → alert (FR-6.2)

[transparency]
amount_disclosure = "bucketed"          # exact | bucketed | omitted (OQ-3)
weight_bucket_kg  = 0.5
public_map_jitter_metres = 50           # for public:read map points
nostr_relays = ["wss://relay.damus.io", "wss://nos.lol"]

[ledger]
checkpoint_interval_entries = 500
opentimestamps_enabled      = true
```

Values above are **illustrative defaults**, not policy — every one is the team's to set. The point is that changing any of them is a config edit and a restart, never a code change or a redeploy of forked source.

### 13.3 What is *not* in the settings file

Operational data that changes while the system runs — rate *versions* over time, sessions, supervisor rotations, API keys, collectors — lives in the database and is edited through the admin UI / API, because it needs history, audit, and per-row authorisation. The settings file only seeds the initial rate table (`[rates].seed`) on first migration.

---

## 14. Non-functional requirements — consolidated

| NFR | Requirement | How v1 meets it |
|---|---|---|
| 7.1 | Collector interaction requires zero reading; supervisor app one-handed, sunlight-readable, sub-$150 Android | Tap-first flow; large hit targets; high-contrast Brand palette (Ink on white/cream, orange as fill only); no text in the collector critical path; Swahili/Sheng labels where text is unavoidable |
| 7.2 | Core supervisor actions succeed with zero connectivity; graceful degradation, never fail-closed | IndexedDB-first writes; Service Worker app shell; every backend dependency (the Lightning provider, map tiles, rate feed, Nostr) is optional at capture time |
| 7.3 | No collector credential carries spend risk; cold reserve is multisig; API creds least-privilege, never plaintext-logged | Receive-only tags (ADR-001); Trezor 2-of-3 cold reserve; scoped API keys hashed at rest; structured logging allow-list |
| 7.4 | PII minimised; public attestations & partner/funder reports aggregate + pseudonymous | Data model stores alias + Lightning address only; `partner`/`public:read` scopes filter PII server-side; attestations exclude collector id |
| 7.5 | Weigh-to-payout-authorisation < 30s supervisor interaction under normal connectivity; instant offline | Local-first writes never block on network; payout authorisation is a server/worker step, off the supervisor's interaction path |
| 7.6 | Default to non-custodial rails; custodial components need legal review | Shipped default is BYO collector wallet + Blink float — Afribit holds no collector-designated balance; the custodial LNbits provisioning mode is off by default and behind gate G1 (§1.3, D-05/D-22) |
| 7.7 | All collector/supervisor UI text supports Swahili + Sheng alongside English | `next-intl`, three locale files; English authored, `sw`/`sheng` filled by Afribit |
| 7.8 | Maintainable by a one-lead team, no exotic infra | Vercel/Neon/R2 **or** one Docker Compose file; no Redis, no Kafka, no k8s; pg-boss uses the DB already present |

Performance budgets (targets, tracked in CI where measurable): PWA Time-to-Interactive < 3s on a mid-tier Android over 3G for the cached shell; a single weigh event persisted to IndexedDB in < 100ms; sync batch of 50 events processed server-side in < 2s.

---

## 15. Localisation (NFR 7.7, D-15)

- `messages/en.json` authored in-repo and kept complete; `messages/sw.json`, `messages/sheng.json` stubbed with the same keys and a `// TODO(afribit)` marker on untranslated values.
- Locale resolution: supervisor's `locale` column → `Accept-Language` → `en`.
- Collector-facing surfaces (the physical tag, the "tap here" moment) use icons and colour, not sentences. Sheng in particular has no standard orthography — treat Afribit's training materials as the reference and let staff iterate on the strings.
- Numbers, sat amounts, weights, timestamps, tag IDs render in **JetBrains Mono** (Brand Guidelines §3) and are never localised into non-Latin digits.

---

## 16. Security and threat model (summary)

Full model in `docs/THREAT_MODEL.md` (Milestone 0). Headlines:

| Threat | Control |
|---|---|
| Supervisor pays themselves | Payout scope absent from every human role; destination server-derived; redundant unit test (§12.3–12.4) |
| Supervisor + collector collude on inflated weights | Reconciliation vs recycler tonnage (FR-3.5); rotation (FR-3.7); anomaly flags for identical weights (FR-3.6) |
| Phantom collectors | Enrolment + community re-verification; reconciliation surfaces divergence; payout concentration flag |
| Records edited to hide fraud | Append-only `ledger_entries`, DB-level UPDATE/DELETE revoked, hash chain, signed checkpoints, external verifier |
| Lost/stolen tag | Receive-only — no spend path; revoke + reissue; revoked-tap logged |
| Stolen device with queued events | Opportunistic frequent sync; end-of-session sync drill; accepted residual risk (Tech Arch §5.4) |
| Lightning provider key compromise (Blink API key / LNbits admin key) | Key in the environment only, never client or logs; operating float deliberately small; cold reserve multisig unaffected; worker alerts on abnormal outflow |
| API key leak | Scoped (default `public:read`, no PII, no writes); hashed at rest; revocable; `last_used_at` visible |
| Exchange-rate oracle manipulation | ≥2 independent sources; staleness TTL blocks payout on stale data (D-18) |
| Regulatory (VASP Act) | Non-custodial by default (BYO wallet + Blink float); custodial LNbits provisioning is opt-in behind gate G1 with an explicit operator acknowledgement |
| Malicious collector address at enrolment (e.g. a withdraw code) | BYO QR is validated as receive-capable and resolvable before it is stored or written to the tag (§7.1 Path A step 2) |

---

## 17. Open questions still outstanding

Carried from the source documents; each has an owner and a gate, not a code blocker.

| # | Question | Owner | Status / Gate |
|---|---|---|---|
| OQ-1 | Per-kg rate methodology and how collector input factors in | Afribit team | Open — no gate; `[rates].seed` + admin UI take any values |
| OQ-2 | Which BLE scale model(s) to standardise on | Eddie + field | **Resolved approach** — BLE built behind a `WeightSource` interface, model plugged in at M8; spike picks the model |
| OQ-3 | Public transparency granularity — per-event amounts published, or aggregate only | Afribit team | Open — exposed as `settings.transparency.amount_disclosure` (`exact`\|`bucketed`\|`omitted`, default `bucketed`); team confirms before M7 ships |
| OQ-4 | Fedimint federation guardianship (M-of-N, who) | Afribit team | **Resolved** — Afribit's federation already exists (Fedi, fedi.xyz); `FedimintProvider` is a supported v1 rail (D-23) |
| OQ-5 | Custodial-mode legal exposure (VASP Act) if an operator enables LNbits provisioning | Legal | **G1** — blocks turning on `custody.provisioning_enabled` in production; does not block the default non-custodial build |
| OQ-6 | Web NFC coverage on supervisors' actual devices | Eddie + field | **G2** — blocks tap-first as the sole primary flow; manual search + BYO QR scan ship regardless |
| OQ-7 | Lightning-provider day-to-day operator/monitor (Blink account owner, or LNbits host operator if custodial mode is enabled) | Ronnie | Named before M5 production |
| OQ-8 | Recycler-sales data pipeline (who enters, cadence, or integration) | Ronnie + recycler | **G3** — blocks reconciliation being shown to funders as authoritative |

---

## 18. Glossary delta

Additions to the PRD §15 glossary:

- **Ledger entry** — one row in the global append-only `ledger_entries` chain; the canonical, hash-linked record of a money- or trust-relevant fact.
- **Checkpoint** — a periodically signed `(through_seq, entry_hash)` pair that anchors ledger state at a point in time for external verification.
- **Indicative sats** — the sats figure shown to a supervisor at capture, computed from a cached exchange rate. Not binding; the payout amount is set at disbursement.
- **BYO wallet / `address_source = 'byo'`** — the collector's tag points at a wallet the collector already controls (e.g. their Blink account, presented as a Paycode QR at enrolment). Afribit never holds a balance for them. The shipped default.
- **Program-provisioned wallet / `address_source = 'provisioned'`** — Afribit's self-hosted LNbits mints a wallet + address for the collector. Custodial; off by default; gated on G1.
- **Operating float** — Afribit's own wallet that payouts are sent *from*; not a per-collector balance. Its provider is `blink` (default), `lnbits`, or `fedimint`, set in `settings.toml`.
- **Cold reserve** — the Trezor 2-of-3 multisig holding the bulk of programme funds; tops up the operating float.
- **`LightningProvider`** — the interface every payout goes through; implementations are `BlinkProvider`, `LNbitsProvider`, `FedimintProvider`, and `FakeLightningProvider` (tests).
- **Settings file** — `config/settings.default.toml` (committed defaults) merged with `config/settings.toml` (operator overrides) and env vars; Zod-validated at boot. Holds every operational tunable; holds no secrets.
- **Scope** (API) — a capability string on an API key (`public:read`, …) that gates which endpoints and fields a third-party consumer may read.
- **DCO** — Developer Certificate of Origin; a `Signed-off-by` line certifying a contributor has the right to submit the code. Used instead of a CLA.

---

*This document consolidates and is subordinate to the five source documents in `Initial assets/`. Where it changes them, §4 says so; those edits land in Milestone 0.*
