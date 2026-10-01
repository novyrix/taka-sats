# Taka Sats — Technical Architecture

**Waste-to-Bitcoin Earn-First Programme**
Afribit Africa

Version 1.1 — Companion to the Taka Sats PRD, User Stories, Brand Guidelines, and the engineering set under `docs/`

**Revision 1.1 (2026-09):** reconciled with `docs/REQUIREMENTS.md` for implementation. Key changes: the payout rail is a configurable `LightningProvider` — **Blink** is the shipped default, self-hosted **LNbits** is the opt-in custodial provider, and **Fedimint/Fedi** is supported (ADR-003, ADR-006 revised); collectors may **bring their own** Lightning Address / Blink Paycode *or* be program-provisioned an LNbits wallet (§4, §8); the HTTP API is a first-class documented product (`/api/v1`, OpenAPI 3.1 — new C4 container); the canonical tamper-evident record is one global `ledger_entries` hash chain with signed checkpoints (§7, §8); `material_rates` stores fiat-per-kg; nothing operational is hardcoded (`config/settings.toml`, `docs/CONFIGURATION.md`). Where this document and `docs/REQUIREMENTS.md` differ, REQUIREMENTS is authoritative.

---

## 1. Purpose and Scope

This document specifies *how* Taka Sats is built, at the level of detail an engineer needs to start writing code. It assumes the Taka Sats PRD as ground truth for *what* the system must do and `docs/REQUIREMENTS.md` as the buildable consolidation — every architectural choice below exists to satisfy a specific `FR-x.y` or `NFR` from the PRD, referenced inline.

Diagrams follow the spirit of the **C4 model** (Context → Container → Component), rendered as plain-text diagrams since this document must remain readable in any markdown viewer without a diagramming tool. Key decisions are recorded as **Architecture Decision Records (ADRs)** in Section 9, using the standard lightweight format (Title, Status, Context, Decision, Consequences), so the reasoning behind a choice survives even after the choice itself feels obvious in hindsight.

---

## 2. System Context (C4 Level 1)

Who and what Taka Sats talks to, at the highest level:

```
                    ┌──────────────────┐
                    │     Collector      │
                    │  (NFC tag, no app)  │
                    └─────────┬─────────┘
                              │ physical tap
                              ▼
   ┌──────────────┐   ┌──────────────────┐   ┌──────────────────┐
   │  Admin/       │   │   TAKA SATS        │   │  Partner          │
   │  Ronnie/Eddie  │◄──┤   SYSTEM            ├──►│  (Trezor/Blink/    │
   │  (via /api/v1) │   │  (/api/v1 is a     │   │   Fedi, read-only) │
   └──────────────┘   │   public product)  │   └──────────────────┘
   ┌──────────────┐   └─────────┬────────┘   ┌──────────────────┐
   │ Third-party   │◄───────────┤             │  Afribit Console  │
   │ API consumers │  scoped    │             │  (one consumer of │
   │ (self-host)   │  API keys  │             │   /api/v1)        │
   └──────────────┘             │             └──────────────────┘
              ┌────────────────┼────────────────┬───────────────┐
              ▼                ▼                ▼               ▼
      ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌────────────┐
      │ LightningProv │ │  Nostr relay   │ │ OpenStreetMap │ │ Exchange   │
      │ LNbits/Blink/ │ │  (public         │ │ (mapping tile │ │ rate feeds │
      │ Fedimint      │ │   attestations)  │ │  layer)        │ │ (BTC/KES)  │
      └──────────────┘ └──────────────┘ └──────────────┘ └────────────┘
```

**Taka Sats is a standalone system** exposing a documented, versioned HTTP API (`/api/v1`, OpenAPI 3.1). Afribit Console is **one consumer** of that API for the admin surface — it does not host Taka Sats. Any third party can self-host the system and consume the API. Where it makes sense, the client shares design tokens and component conventions with Console (see `docs/DESIGN.md`), but there is no runtime dependency on Console.

---

## 3. Container Architecture (C4 Level 2)

```
┌─────────────────────────────────────────────────────────────────────┐
│                CLIENT LAYER  (one Next.js App Router project)           │
│  ┌────────────────────────┐ ┌───────────────┐ ┌──────────────────┐  │
│  │  Supervisor PWA          │ │ Admin dashboard │ │ Public transparency│  │
│  │  offline-first, IndexedDB │ │ session config, │ │ site: impact,      │  │
│  │  Service Worker (Serwist)  │ │ live monitoring, │ │ ledger explorer,  │  │
│  │  Web NFC / camera / geo     │ │ reports          │ │ open dataset      │  │
│  └────────────────────────┘ └───────────────┘ └──────────────────┘  │
└─────────────────────────────┼──────────────────────────────────────────┘
                                │ HTTPS · /api/v1  (sync on reconnect)
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│              API LAYER  (Next.js route handlers, /api/v1/*)             │
│  — Auth.js sessions (humans) · scoped API keys (third parties)          │
│  — Zod-validated input · idempotent writes (client UUID) · OpenAPI spec │
│  — no business logic in handlers; logic lives in lib/                    │
│  ┌────────────────────────┐          ┌────────────────────────┐        │
│  │  PostgreSQL (Neon/local) │          │  Object storage           │        │
│  │  — domain tables +        │          │  (Cloudflare R2 / MinIO)   │        │
│  │    ledger_entries chain    │          │  — evidence photos          │        │
│  └────────────────────────┘          └────────────────────────┘        │
└─────────────────────────────┼──────────────────────────────────────────┘
              ┌────────────────┼───────────────┬───────────────┐
              ▼                ▼               ▼               ▼
   ┌──────────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐
   │ worker (pg-boss)  │ │ Lightning-  │ │ Nostr relay │ │ Exchange   │
   │ reconciliation,   │ │ Provider:   │ │ (attestation)│ │ rate feeds │
   │ anomaly, payouts, │ │ LNbits |    │ └────────────┘ │ (≥2 sources)│
   │ checkpoints,      │ │ Blink |     │  Cold reserve:  └────────────┘
   │ alerts            │ │ Fedimint    │  Trezor 2-of-3 multisig → tops
   └──────────────────┘ └────────────┘  up the active float wallet
```

**Hosting** — two first-class paths (`docs/REQUIREMENTS.md` D-03):
- **Self-host:** `docker compose up` → app, Postgres, worker, MinIO, a Nostr relay; the custodial overlay adds LNbits + a regtest backend.
- **Managed:** Vercel (app + API), Cloudflare R2 (photos), Neon (serverless Postgres), Vercel Cron → authed internal enqueue routes. The same stack already used across Afribit's Console ecosystem; no new managed vendor is introduced.

---

## 4. Component Detail — Supervisor PWA (C4 Level 3)

The highest-risk, most operationally critical client. Internal structure:

```
Supervisor PWA
├── UI Layer
│   ├── CollectorLookup     — NFC tap handler, manual search fallback
│   ├── WeighEvent           — material select, weight entry, photo capture
│   ├── SyncStatusIndicator  — queued / syncing / confirmed (per US-4.3)
│   └── SessionSummary       — end-of-session totals, walk-in count
├── Local Data Layer
│   ├── IndexedDB store       — events, cached collector records, session config
│   ├── Outbox                — pending-sync queue (event log, not full state)
│   └── Conflict resolver     — applied on sync, see Section 5
├── Device Integration
│   ├── Web NFC API           — reads tag payload (Lightning Address / LNURL)
│   ├── Camera API             — evidence photo capture
│   └── Geolocation API         — GPS tagging per event
└── Service Worker
    ├── App shell caching       — works with zero connectivity (FR-4.1)
    └── Background sync trigger  — fires when connectivity returns
```

**Why a PWA and not a native app.** No app-store distribution friction, one codebase shared conceptually with Console's existing Next.js/React stack, and installable-from-browser behavior is sufficient for the offline requirements here. See ADR-002.

---

## 5. Offline Sync Architecture

Satisfies FR-4.1–4.3 (offline-first, no data loss on sync, visible sync status).

### 5.1 Write path
Every supervisor action writes to **IndexedDB first, always** — the UI never waits on a network call to reflect a successful save. This is the "local-first" principle: a write is complete the moment it's on-device.

### 5.2 The event log, not shared mutable state
Collection events are **append-only facts** ("Amina's waste was weighed at 4.2kg at 14:02"), not a mutable shared document. This matters architecturally: most Taka Sats data doesn't need full CRDT machinery, because two supervisors independently recording two different events never actually conflict — they're just two rows that both need to arrive at the server. An **operation log with idempotent, uniquely-keyed events** (each event gets a client-generated UUID at creation time) is sufficient and simpler to reason about than a general CRDT.

**Where real conflict is possible** — the same collector's *profile* being edited by two different supervisors, or a session's rate table changing while events are queued against it — is a smaller surface, and is handled with **last-write-wins by timestamp plus a manual review flag** if the two conflicting writes happened close enough together to be suspicious, rather than a full CRDT merge engine. This is a deliberate scope reduction: full CRDT (Automerge/Yjs) is the right tool if collaborative document editing emerges as a real need later (see ADR-004), but it is not justified for Phase 1.

### 5.3 Sync protocol
```
1. Device regains connectivity
2. Service worker triggers background sync
3. Client POSTs queued events in batches, each with its client UUID
4. Server upserts by UUID (idempotent — resending an already-synced
   event is a no-op, not a duplicate)
5. Server returns per-event confirmation
6. Client marks each confirmed event as "confirmed" and removes it
   from the outbox
7. Any event the server rejects (e.g. failed validation) returns to
   the client as "needs attention" with a reason, never silently dropped
```

### 5.4 What happens if sync never completes
If a device is lost or destroyed before syncing, queued events are lost — this is a real, accepted risk of any offline-first system, not something architecture alone can eliminate. Mitigations: (a) sync is attempted opportunistically and frequently, not just at session end, minimizing the exposure window; (b) supervisors are trained to sync explicitly at the end of every session while still on-site, where a connectivity check can be manually confirmed.

---

## 6. Lightning and Treasury Architecture

Satisfies FR-7.1–7.5 and the fraud-prevention separation-of-duties principle (FR-3.1).

### 6.1 Two-tier treasury

```
┌─────────────────────────────────────────────────────────┐
│  COLD RESERVE                                              │
│  Trezor hardware wallets, 2-of-3 multisig                  │
│  (Ronnie + Treasurer + Advisor)                             │
│  Holds: the large majority of programme funds                 │
└─────────────────────┬───────────────────────────────────┘
                       │ manual or threshold-triggered top-up (two sign-offs)
                       ▼
┌─────────────────────────────────────────────────────────┐
│  OPERATING FLOAT  — a few days of expected payouts          │
│  A wallet in the configured LightningProvider:               │
│    • Blink   (shipped default)                                │
│    • LNbits  (opt-in custodial provider — self-hosted)        │
│    • Fedimint (Fedi federation, fedi.xyz)                     │
│  Every per-collector payout executes from here               │
└─────────────────────┬───────────────────────────────────┘
                       │ LightningProvider.pay(destination, sats)
                       ▼
              Collector Lightning Address
              (resolved server-side from NFC tag mapping — never client input)
```

### 6.2 The `LightningProvider` interface — one code path, configurable rail
The payout path is provider-agnostic. `lib/lightning/LightningProvider` has four implementations: `BlinkProvider` (the default float, plus resolve/validate a collector's Blink Paycode for bring-your-own), `LNbitsProvider` (the opt-in custodial provider that provisions per-collector wallets and can run the float), `FedimintProvider` (Fedi federation), and `FakeLightningProvider` (dev/tests, never real funds). The active one is chosen in `config/settings.toml` (`lightning.float_provider`). Blink is already Afribit's established provider (`afribit@blink.sv`), proven in Kibera. Afribit may enable LNbits after G1 when it needs bulk program-provisioned wallets, which Blink's one-account-one-address model cannot create. The cold reserve is self-custodied on hardware wallets regardless of rail. See ADR-003, ADR-006, and `docs/REQUIREMENTS.md` D-05/D-22/D-23.

### 6.3 Collector address provisioning (two configurable paths)
- **Bring-your-own** (`collectors.address_source = 'byo'`, shipped default): the collector presents their own Lightning Address / Blink Paycode QR at enrolment; it is scanned, normalised, validated as receive-capable (a withdraw / `LNURLw` code is rejected), stored, and written to the tag. Afribit holds no balance for that collector.
- **Program-provisioned** (`address_source = 'provisioned'`, operator opt-in): the server calls LNbits to mint a wallet + LNURLp per collector. Custodial; `custody.provisioning_enabled` must be true (off by default) with an acknowledgement string; gated on G1 for real funds.

### 6.4 Payout execution
```
Verified collection event
        │
        ▼
computePayout(weight, rate)                    // lib/money.ts — the ONLY sats arithmetic
exchange snapshot fresh? (age < settings.money.rate_staleness_ttl) ──no──► defer, alert
        │
        ▼
Above settings.payouts.second_signoff_threshold_sats? ──yes──► pending_approval, stop (FR-3.2)
        │ no
        ▼
Operating float ≥ amount_sats? ──no──► pending_float, stop (FR-7.4)
        │ yes
        ▼
destination = collector.lightning_address       // server-resolved from tag mapping ONLY
LightningProvider.fromConfig().pay(destination, amount_sats)   // LNbits | Blink | Fedimint
        │
        ▼
Record payout row + append ledger_entries row (entry_type='payout')
        │
        ▼
Publish Nostr attestation (pseudonymous, FR-3.4; amount disclosure per settings.transparency)
```

### 6.5 Pool-depletion handling
If the operating float cannot cover a payout, the payout is marked `pending_float` rather than failing silently (FR-7.4). The worker retries pending payouts once the float is topped up, without requiring the original event to be re-verified.

---

## 7. Fraud Prevention — Architectural Enforcement

This section maps the PRD's layered fraud model (Section 6.3) to concrete system components, since "separation of duties" and "reconciliation" need to be enforced by the architecture, not just by policy.

| Control | Architectural mechanism |
|---|---|
| Supervisors cannot self-pay | RBAC: **no human role** (`supervisor`, `hub_lead`, `admin`) has an API scope that specifies a payout destination — payout execution is a worker/system function. Destination is *always* derived server-side from the tapped tag's mapping, never accepted as client input. Enforced by middleware *and* a redundant unit test on the role scope set. Identical across every `LightningProvider`. |
| Second sign-off on large payouts | A `pending_approval` payout status that only a distinct `admin`/`hub_lead` user (different user ID than the submitter) can transition to `approved`. Threshold is `settings.payouts.second_signoff_threshold_sats`. |
| Tamper-evident ledger | One global append-only `ledger_entries` chain covers collection events, payouts, corrections and treasury top-ups (server-assigned `seq`, `prev_entry_hash` → `entry_hash`). `UPDATE`/`DELETE` on it is revoked at the database role level; corrections are new `entry_type='correction'` rows referencing the original. Periodic `ledger_checkpoints` are signed and optionally anchored (Nostr / OpenTimestamps) so external verifiers have stable anchors. `collection_events` / `payouts` are detail tables linked by `ledger_entry_id`. |
| Reconciliation | A scheduled job compares `SUM(collection_events.weight)` by material/period against `recycler_sales.weight` (a table populated from recycler settlement records) and writes variance to a `reconciliation_reports` table, surfaced in the admin dashboard. |
| Anomaly detection | A background job flags: repeated identical weights from the same supervisor, payout concentration (Gini-style skew) among a small collector subset, and events outside a session's scheduled window — written to an `anomaly_flags` table for admin review, never auto-blocking. |
| Supervisor audit trail | Every event row carries a non-nullable `supervisor_id` foreign key; there is no code path that writes an event without one. |

---

## 8. Data Model

Expands the PRD's summary (Section 9) to implementation-level detail.

> **Revision 1.1 — `docs/REQUIREMENTS.md §9` is now the authoritative, implementation-level schema** (Drizzle + drizzle-kit; every migration has a `down`). The SQL below is kept as an orientation sketch; where it differs from `docs/REQUIREMENTS.md §9`, that document wins. Notable deltas since v1.0: `material_rates.rate_sats_per_kg` → `rate_fiat_minor` + `fiat_currency` (rates are fiat, converted to sats at disbursement — D-14); a single global `ledger_entries` chain + `ledger_checkpoints` replaces the per-row `prev_record_hash`/`record_hash` columns as the canonical chain (D-13); new tables `partners`, `api_keys`, `treasury_topups`, `exchange_rate_snapshots`, `supervisor_rotations`; `supervisors` gains credential + `locale` columns; `collectors` gains `address_source`; `payouts.blink_transaction_id` → `provider` + `provider_payment_ref`.

```sql
-- ── IDENTITY ──────────────────────────────────────────────────────────
collectors (
  id UUID PRIMARY KEY,
  alias TEXT NOT NULL,
  nfc_tag_id TEXT UNIQUE,              -- current active tag mapping
  address_source TEXT NOT NULL DEFAULT 'byo',  -- byo | provisioned  (D-05/D-22)
  lightning_address TEXT,              -- nullable until scanned (byo) or minted (provisioned)
  lnurl_pay_raw TEXT,                  -- original scanned payload for byo
  lnbits_wallet_id TEXT,              -- set only when address_source = 'provisioned'
  enrolled_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' -- active | revoked
)

tag_history (                            -- supports FR-1.3/1.4 reissue & revoke
  id UUID PRIMARY KEY,
  collector_id UUID REFERENCES collectors(id),
  tag_id TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ                 -- null while active
)

supervisors (                           -- the staff-user table (Auth.js credentials)
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'supervisor', -- supervisor | hub_lead | admin
  password_hash TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'en',
  last_login_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT true
)

partners (                              -- sponsors with a read-only scoped view
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  contact TEXT,
  login_email TEXT UNIQUE,
  password_hash TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL
)

api_keys (                              -- third-party /api/v1 access (D-07)
  id UUID PRIMARY KEY,
  label TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  scopes TEXT[] NOT NULL DEFAULT '{public:read}',
  partner_id UUID REFERENCES partners(id),
  created_by UUID NOT NULL REFERENCES supervisors(id),
  created_at TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
)

-- ── SESSIONS ──────────────────────────────────────────────────────────
sessions (
  id UUID PRIMARY KEY,
  location TEXT NOT NULL,
  geo_bounds JSONB,
  scheduled_start TIMESTAMPTZ NOT NULL,
  scheduled_end TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL,                   -- scheduled | active | closed
  sponsor_partner_id UUID REFERENCES partners(id)
)

session_supervisors (
  session_id UUID REFERENCES sessions(id),
  supervisor_id UUID REFERENCES supervisors(id),
  PRIMARY KEY (session_id, supervisor_id)
)

material_rates (                          -- versioned, never overwritten (FR-2.2)
  id UUID PRIMARY KEY,
  material TEXT NOT NULL,
  rate_fiat_minor BIGINT NOT NULL,        -- fiat minor units per kg (e.g. KES cents) — D-14
  fiat_currency TEXT NOT NULL DEFAULT 'KES',
  effective_from TIMESTAMPTZ NOT NULL,
  effective_to TIMESTAMPTZ                -- null = currently active
)                                        -- seeded from settings [rates].seed on first migration

supervisor_rotations (                    -- FR-3.7 / FR-6.1
  id UUID PRIMARY KEY,
  supervisor_id UUID NOT NULL REFERENCES supervisors(id),
  location TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL
)

exchange_rate_snapshots (                 -- US-7.3 / D-18 — payout won't run against a stale rate
  id UUID PRIMARY KEY,
  base TEXT NOT NULL, quote TEXT NOT NULL, -- 'BTC' / 'KES'
  rate NUMERIC NOT NULL,
  sources JSONB NOT NULL,                 -- [{source, rate}], ≥2 independent
  fetched_at TIMESTAMPTZ NOT NULL
)

-- ── COLLECTION EVENTS (append-only) ──────────────────────────────────
collection_events (
  id UUID PRIMARY KEY,                    -- client-generated, idempotency key
  collector_id UUID REFERENCES collectors(id),
  supervisor_id UUID NOT NULL REFERENCES supervisors(id),
  session_id UUID REFERENCES sessions(id),
  material TEXT NOT NULL,
  weight_kg NUMERIC(6,3) NOT NULL,
  rate_id UUID NOT NULL REFERENCES material_rates(id),
  indicative_sats BIGINT NOT NULL,       -- shown at capture; NOT binding (binding amount set at payout)
  photo_url TEXT NOT NULL,
  photo_sha256 TEXT NOT NULL,            -- computed on-device before upload (D-12)
  gps_lat NUMERIC, gps_lng NUMERIC, gps_accuracy_m NUMERIC,
  gps_unavailable_reason TEXT,
  recorded_at TIMESTAMPTZ NOT NULL,       -- device-local time of capture
  synced_at TIMESTAMPTZ,                  -- null until server confirms
  ledger_entry_id UUID UNIQUE REFERENCES ledger_entries(id),  -- canonical chain link (D-13)
  registration_type TEXT NOT NULL DEFAULT 'tap',  -- tap | walk_in | pending_self_serve
  verification_status TEXT NOT NULL DEFAULT 'verified' -- verified | pending_supervisor_review
)

-- ── PAYOUTS ───────────────────────────────────────────────────────────
payouts (
  id UUID PRIMARY KEY,
  collection_event_id UUID UNIQUE REFERENCES collection_events(id),
  ledger_entry_id UUID UNIQUE REFERENCES ledger_entries(id),
  amount_sats BIGINT NOT NULL,
  amount_fiat_minor BIGINT NOT NULL,
  fiat_currency TEXT NOT NULL,
  exchange_snapshot_id UUID REFERENCES exchange_rate_snapshots(id),
  status TEXT NOT NULL,                    -- pending_approval | pending_float | paid | failed
  approved_by UUID REFERENCES supervisors(id), -- null unless above threshold
  provider TEXT NOT NULL,                  -- blink | lnbits | fedimint
  provider_payment_ref TEXT,               -- provider-specific payment id / hash
  attempted_at TIMESTAMPTZ,
  settled_at TIMESTAMPTZ,
  error_message TEXT
)

-- ── TREASURY ──────────────────────────────────────────────────────────
treasury_snapshots (
  id UUID PRIMARY KEY,
  taken_at TIMESTAMPTZ NOT NULL,
  hot_balance_sats BIGINT NOT NULL,       -- the operating float, whichever provider
  cold_balance_sats BIGINT NOT NULL,
  pending_payouts_sats BIGINT NOT NULL
)

treasury_topups (                         -- cold → float, two distinct sign-offs (FR-7.2)
  id UUID PRIMARY KEY,
  ledger_entry_id UUID UNIQUE REFERENCES ledger_entries(id),
  amount_sats BIGINT NOT NULL,
  initiated_by UUID NOT NULL REFERENCES supervisors(id),
  second_signoff_by UUID REFERENCES supervisors(id),
  status TEXT NOT NULL,                    -- pending_signoff | broadcast | confirmed | failed
  onchain_txid TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  confirmed_at TIMESTAMPTZ
)

-- ── RECONCILIATION & FRAUD ───────────────────────────────────────────
recycler_sales (
  id UUID PRIMARY KEY,
  material TEXT NOT NULL,
  weight_kg NUMERIC NOT NULL,
  sold_at TIMESTAMPTZ NOT NULL,
  buyer TEXT NOT NULL
)

reconciliation_reports (
  id UUID PRIMARY KEY,
  period_start TIMESTAMPTZ, period_end TIMESTAMPTZ,
  material TEXT,
  paid_kg NUMERIC, sold_kg NUMERIC,
  variance_pct NUMERIC,
  flagged BOOLEAN NOT NULL DEFAULT false
)

anomaly_flags (
  id UUID PRIMARY KEY,
  collection_event_id UUID REFERENCES collection_events(id),
  flag_type TEXT NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL,
  reviewed_by UUID REFERENCES supervisors(id),
  review_outcome TEXT                       -- confirmed | dismissed
)

-- ── LEDGER (canonical append-only hash chain, D-13) ─────────────────
ledger_entries (
  id UUID PRIMARY KEY,                     -- = detail row's client UUID where applicable
  seq BIGSERIAL UNIQUE,                    -- server-assigned monotonic order
  entry_type TEXT NOT NULL,                -- collection_event | payout | correction |
                                             --   treasury_topup | rate_change | tag_revocation
  payload_hash TEXT NOT NULL,              -- sha256 of canonical payload (client-computed at capture)
  prev_entry_hash TEXT,                    -- entry_hash of seq-1 (null at genesis)
  entry_hash TEXT NOT NULL,                -- sha256(seq || entry_type || payload_hash || prev_entry_hash)
  references_id UUID,                      -- for corrections: the entry superseded
  created_at TIMESTAMPTZ NOT NULL,         -- server ingestion time
  device_recorded_at TIMESTAMPTZ
)   -- UPDATE/DELETE revoked at the DB role level; corrections are new rows

ledger_checkpoints (                       -- external-verification anchors (D-19)
  id UUID PRIMARY KEY,
  through_seq BIGINT NOT NULL,
  entry_hash TEXT NOT NULL,
  signature TEXT NOT NULL,                 -- programme key over (through_seq || entry_hash)
  nostr_event_id TEXT, opentimestamps TEXT,
  created_at TIMESTAMPTZ NOT NULL
)

-- ── PUBLIC ATTESTATIONS ──────────────────────────────────────────────
attestations (
  collection_event_id UUID PRIMARY KEY REFERENCES collection_events(id),
  nostr_event_id TEXT NOT NULL,
  amount_disclosure TEXT NOT NULL DEFAULT 'bucketed',  -- exact | bucketed | omitted (settings)
  published_at TIMESTAMPTZ NOT NULL
)
```

---

## 9. Architecture Decision Records

### ADR-001: NFC tags are receive-only (NTAG213/216 with LNURL-pay), not Bolt Cards
**Status:** Accepted
**Context:** Bolt Cards (NTAG424 DNA + LNURLw) are a spend/withdraw primitive — the merchant pulls funds from the cardholder. Collectors need the reverse: to receive.
**Decision:** Issue static NTAG213/216 tags encoding a Lightning Address / LNURL-pay link. No rolling-code cryptography is needed because a receive link carries no drain risk if exposed.
**Consequences:** Tags are cheaper (~$0.20–$1.00/unit vs. ~$0.90–$2.50 for NTAG424), simpler to provision in bulk, and safe to reissue on loss with zero fund-recovery risk. Trade-off: this design cannot be extended to a spend use case without issuing a different tag type — acceptable, since Taka Sats has no spend requirement.

### ADR-002: Offline-first PWA, not a native mobile app
**Status:** Accepted
**Context:** Supervisors use low-cost Android devices; app-store distribution adds friction (review time, update lag, install-size sensitivity on cheap devices); Afribit's existing technical stack is React/Next.js.
**Decision:** Build the supervisor app as an installable, offline-capable PWA.
**Consequences:** One codebase, no app-store dependency, works via a shared link or QR install. Trade-off: Web NFC API support varies by browser/OS version — must be verified against the actual devices supervisors carry (open question, Section 11) and a manual-entry fallback (already specified in the PRD) covers any gap.

### ADR-003: Pluggable `LightningProvider` + two-tier treasury (revised in 1.1)
**Status:** Accepted (revised)
**Context:** v1.0 hard-wired Blink as the hot-float rail. Two things changed: (a) Afribit needs to *provision* a wallet + Lightning Address per collector, which Blink's one-account-one-address model cannot do in bulk — a self-hosted LNbits instance can; (b) the project is open source and standalone, so a single hard-wired provider is wrong for other operators. Concentrating all funds in one custodial account remains a single point of failure to avoid.
**Decision:** The payout rail is a `LightningProvider` interface with four implementations — `BlinkProvider` (the shipped default float + bring-your-own Paycode validation), `LNbitsProvider` (opt-in per-collector provisioning + float), `FedimintProvider` (Fedi federation), and `FakeLightningProvider` (tests). The active one is chosen in `config/settings.toml`. The bulk of funds stays in a self-custodied Trezor 2-of-3 multisig cold reserve, topped up to the operating float with two sign-offs. `computePayout` and the separation-of-duties enforcement are identical across providers.
**Consequences:** One codebase serves a licensed custodial operator and an unlicensed non-custodial one with no code difference. An operator enabling LNbits takes on its operational burden and must complete G1 before real collector funds are held. The float — whichever provider — is deliberately kept small (a few days of payouts).

### ADR-003a: One global `ledger_entries` hash chain, not per-row hash columns
**Status:** Accepted
**Context:** v1.0 put `prev_record_hash`/`record_hash` on each event row. Multiple supervisors recording offline on separate devices cannot know the latest hash to chain onto, and payouts/top-ups also need to be in the tamper-evident record.
**Decision:** One append-only `ledger_entries` table is the canonical chain. The client computes a content hash per fact at capture; the server assigns `seq` and links `prev_entry_hash` at ingestion. `collection_events`/`payouts`/`treasury_topups` are detail tables linked by `ledger_entry_id`. Periodic `ledger_checkpoints` are signed (and optionally Nostr/OpenTimestamps-anchored). A standalone `scripts/verify-ledger.ts` and a public `GET /api/v1/ledger/verify` let any auditor check the chain (answers v1.0 Open Question 3).
**Consequences:** A single, simple artifact to hand a funder or auditor. Ordering is by server ingestion, not device clock — honest about what the server can attest.

### ADR-004: Operation log with idempotent events, not full CRDTs, for offline sync
**Status:** Accepted
**Context:** Collection events are append-only facts, not collaboratively-edited shared documents — the classic CRDT use case (concurrent edits to the same mutable object) barely applies here.
**Decision:** Use a client-generated UUID per event as an idempotency key, with simple last-write-wins-plus-flag for the smaller surface of genuinely mutable shared state (collector profiles, rate tables).
**Consequences:** Meaningfully simpler to build, test, and reason about than adopting Automerge/Yjs. Revisit if a future feature (e.g. collaborative session planning) introduces real concurrent-document-editing needs.

### ADR-005: Reconciliation against recycler sales is the primary fraud control, not biometrics
**Status:** Accepted
**Context:** Biometric verification measurably slowed comparable cash-transfer rollouts elsewhere and risks excluding undocumented residents — the exact population Taka Sats serves (per the PRD's Non-Goals, Section 3).
**Decision:** Lead with structural controls (separation of duties, dual sign-off, hash-chained ledger) and revenue-side reconciliation as the primary fraud detection mechanism. Biometrics are explicitly out of scope unless reconciliation data later reveals a phantom-collector problem these controls can't solve.
**Consequences:** Keeps enrollment frictionless (PRD's earn-first principle, Section 5). Trade-off: reconciliation is a *detective* control (catches fraud after the fact via variance) rather than a *preventive* one — accepted, because the alternative (biometric gatekeeping) trades a smaller fraud-detection gain for a larger exclusion cost.

### ADR-006: Custody is configurable; non-custodial is the shipped default, custodial is an operator opt-in (revised in 1.1)
**Status:** Accepted (revised)
**Context:** Kenya's VASP Act 2025 creates licensing obligations triggered by custodial activity (dual CBK/CMA regime). v1.0 framed self-hosted LNbits as a "future component". Afribit may enable per-collector LNbits wallets only after completing the corresponding legal review; other operators may have no licence.
**Decision:** Ship both models, selected in `config/settings.toml`:
- **Non-custodial (default):** `custody.default_address_source = 'byo'`, `provisioning_enabled = false`, `lightning.float_provider = 'blink'`. The collector's own wallet receives; Afribit/operator holds no collector-designated balance.
- **Custodial (operator opt-in):** `provisioning_enabled = true` (requires an explicit acknowledgement string), `float_provider = 'lnbits'`. Per-collector LNbits wallets. Gated on **G1** — a recorded jurisdiction legal review — before real funds.
**Consequences:** The collector-facing rail is Lightning-address resolution regardless of model. An unlicensed operator can run the whole system without ever custodying funds. A licensed operator (Afribit) enables provisioning deliberately, with the acknowledgement and G1 in place. The `provisioning_ack` mechanism makes accidental custody hard.

---

## 10. Non-Functional Requirements Mapping

| PRD NFR (Section 7) | How this architecture satisfies it |
|---|---|
| 7.1 Usability/Accessibility | Tap-only collector interaction (Section 4); no literacy requirement in the critical path |
| 7.2 Reliability/Offline | Sections 5.1–5.4 — local-first write path, idempotent sync, graceful degradation |
| 7.3 Security | Section 7 (fraud), Section 6 (treasury); full threat model is a companion security review, not duplicated here |
| 7.4 Privacy | Pseudonymous public attestations (Section 6.4); PII limited to alias + Lightning Address in the data model (Section 8); `partner`/`public:read` API scopes filter PII server-side |
| 7.5 Performance | Local-first writes mean the supervisor-facing interaction is never blocked on network latency |
| 7.6 Regulatory | ADR-006 (configurable custody; non-custodial default, custodial opt-in behind G1) |
| 7.7 Localization | next-intl, `messages/{en,sw,sheng}.json` |
| 7.8 Maintainability | Two first-class deploy paths (`docker compose` / Vercel+Neon+R2); pg-boss (no Redis); no k8s. Shares the Console managed stack. |
| 7.9 Configuration | `config/settings.toml` + Zod validation at boot; nothing operational hardcoded (`docs/CONFIGURATION.md`) |

---

## 11. Open Questions

Tracked with owners and gates in `docs/REQUIREMENTS.md §17`. Status at revision 1.1:

1. **Open (gate G2)** — Web NFC read/write coverage across the specific Android models supervisors carry. Manual search *and* the bring-your-own QR scan ship as first-class paths regardless.
2. **Open (gate G1)** — Self-hosted LNbits remains an opt-in custodial deployment. A legal-review owner and day-2 monitoring owner must be named before it holds real collector funds. Deployment/runbook: `docs/SELF_HOSTING.md` + `docs/TREASURY_RUNBOOK.md`.
3. **Resolved** — Hash-chain verification: `scripts/verify-ledger.ts` (offline, one command) + public `GET /api/v1/ledger` / `/ledger/verify` + a checkpoint-signature check documented in `docs/LEDGER.md` (ADR-003a).
4. **Open (gate G3)** — `recycler_sales` data source: manual entry by a named owner at a defined cadence, or a recycler-side integration.
5. **Resolved** — Fedimint federation guardianship: Afribit's federation exists (Fedi, fedi.xyz); `FedimintProvider` is a supported v1 rail.

---

*This document (revision 1.1) is a companion to the Taka Sats PRD, User Stories, and Brand Guidelines. `docs/REQUIREMENTS.md` is the buildable consolidation and wins where the two differ; `docs/ROADMAP.md` sequences the build; `docs/DESIGN.md` covers UI. The CONTRIBUTING Guide and Code Style Guide specify how the codebase is organized, styled, and opened to outside contributors.*
