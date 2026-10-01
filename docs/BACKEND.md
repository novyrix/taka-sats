# Backend contract — what the frontend builds against

**Audience:** anyone building or changing UI for Taka Sats (the supervisor PWA, the admin
console, public pages). **Source of truth:** the code; this file is its map. If they disagree the
code is right and this file is stale. Fix it in the same change: updating this file is part of
the definition of done for any API change.

**Last updated:** 2026-10-01 · **Status key:** ✅ built and tested · 🚧 being built · 📋 planned

- [1. Orientation](#1-orientation) · [2. Roles and scopes](#2-roles-and-scopes) · [3. The domain in one page](#3-the-domain-in-one-page)
- [4. Offline contract](#4-offline-contract) · [5. Endpoint reference](#5-endpoint-reference) · [6. Things that happen in the background](#6-things-that-happen-in-the-background)
- [7. Configuration that changes the UI](#7-configuration-that-changes-the-ui) · [8. Changelog](#8-changelog-for-the-frontend) · [9. Status, gaps and decisions](#9-status-gaps-and-decisions)

---

## 1. Orientation

| | |
|---|---|
| Production URL | `https://taka.afribit.africa` (programme setting `programme.public_base_url`) |
| API base | `/api/v1` — same origin as the app, no CORS to configure |
| Format | JSON in, JSON out. UUIDs are lower-case strings; timestamps are ISO-8601 UTC strings; sats are integers; kilograms are numbers with ≤ 3 decimals; fiat is **minor units** (KES cents) |
| Validation | Every body/query is Zod-validated server-side. A bad request is always `400 invalid_request` with the Zod issues in `error.details` |
| Idempotency | Writes that a device may resend carry a client-generated UUID (`id`) — a resend returns the original result, never a duplicate |

### Authentication

Auth.js v5, **credentials** provider, **JWT session in a cookie** (no server session table).
Staff sign in with a **phone number**; partners with an **email**. The session survives
`auth.session_max_age_days` (30) so a supervisor stays signed in through long offline stretches.

```ts
import { signIn } from 'next-auth/react';
await signIn('credentials', { identifier: '+2547…', password, redirect: false });
```

Raw HTTP: `GET /api/auth/csrf`, then `POST /api/auth/callback/credentials` (form-encoded
`csrfToken`, `identifier`, `password`); `GET /api/auth/session` returns
`{ user: { id, role, locale }, expires }` or `null`.

A `401` from any `/api/v1` call means the session is gone → send the user to `/login`. **Never
clear the offline queue on a 401** — the queued events are still valid and drain after sign-in.

There is no self-service sign-up. Accounts are created by an operator
(`pnpm db:create-supervisor`, `pnpm db:create-partner`). Collectors never log in.

### Errors

Always `{ "error": { "code": string, "message": string, "details"?: unknown } }`; the HTTP status
matches the class. **Switch on `code`, never on `message`** (the message is English, for logs).

| HTTP | `code` | Meaning |
|---|---|---|
| 400 | `invalid_request` | Zod validation failed; `details` is the issue list |
| 401 | `unauthorized` | no/expired session |
| 403 | `forbidden` | your role lacks the scope (`message` names it) |
| 403 | `no_active_session` | a supervisor with no active assigned session tried to act (§3.4) |
| 403 | `destination_replace_forbidden` | a supervisor tried to change a payout destination after it was verified or the collector was authorized (§3.2) |
| 403 | `self_approval` | you recorded this collection, so you cannot approve its payout (a second person must); or you proposed this treasury top-up, so you cannot approve or reject it (§5.3.1) |
| 403 | `not_your_collector` | a supervisor tried to manage the wallet of a collector they did not register (§3.2) |
| 404 | `not_found` | collector / destination / session / … does not exist |
| 409 | `collector_not_authorized` | the collector is `pending` or `revoked`; `details: { status }` (§3.1) |
| 409 | `destination_in_use` | that wallet already belongs to another collector (deliberately does not say whose) |
| 409 | `conflict` | a tag is already mapped to another collector; a treasury `id` or transfer `reference` is already used by a different proposal (§5.3.1) |
| 400 | `invalid_cursor` | a `cursor` that is not a previous response's `nextCursor` |
| 409 | `review_final` | the same admin tried to change their own anomaly verdict (§5.9) |
| 409 | `invalid_state` | the action does not apply to the payout's (or treasury proposal's) current status; `details.status` says what it is |
| 410 | `tag_revoked` | a revoked tag was tapped (the attempt is logged server-side) |
| 413 / 415 | `payload_too_large` / `unsupported_media_type` | photo upload limits — only JPEG, PNG, WebP and HEIC are accepted (**never SVG**) |
| 422 | `spend_credential_rejected` | **a wallet card's Pay QR was scanned** — show "flip the card, scan Receive" (§3.2) |
| 422 | `not_receive_capable` | a withdraw (LNURL-w) code, or anything that cannot receive |
| 422 | `unsafe_lnurl_target` | the code points somewhere unsafe (non-https / private address) |
| 422 | `invalid_lightning_address` | not a Lightning address / LNURL, or it does not resolve |
| 422 | `photo_hash_mismatch` | uploaded bytes ≠ `X-Photo-Sha256` |
| 422 | `unprocessable` | a business rule (bad rate window, session window, rotation, …) |
| 422 | `hot_wallet_cap_exceeded` | a treasury top-up would take the hot wallet above `treasury.hot_wallet_cap_sats`; `details: { capSats, headroomSats }` (§5.3.1) |
| 502 | `lightning_endpoint_unreachable` / `exchange_feed_error` | an upstream is down — retry later |
| 503 | `provider_misconfigured` | the payment rail is configured unsafely (e.g. the demo `fake` rail in production without the explicit opt-in) — an operator problem, not a user one |
| 503 | `stale_exchange_rate` / `storage_unconfigured` / `ledger_key_invalid` / `float_unavailable` | server-side configuration / freshness / the payment rail is unreachable (`float_unavailable` also from the treasury endpoints that must read the hot-wallet balance) |
| 500 | `internal_error` | a bug; nothing about it is exposed |

### Conventions

- **Pagination:** cursor-based, `?cursor=&limit=` (see each endpoint for the cursor's meaning).
- **Never trust the client for money.** The UI may show an *indicative* amount; the binding amount
  is computed server-side at payout time. No endpoint accepts a payout destination or amount.
- **No PII for `partner`:** partners only ever see aggregates (and have no `collector:*` access).

---

## 2. Roles and scopes

Four roles. Every route calls `requireScope(<scope>)`; a missing scope is `403 forbidden`.
Source: `lib/auth/permissions.ts` (the matrix test `lib/auth/rbac-matrix.test.ts` pins every cell).

| Scope | supervisor | hub_lead | admin | partner |
|---|:--:|:--:|:--:|:--:|
| `collector:enrol` — register a collector, attach a destination, issue a tag | ✅ | ✅ | ✅ | |
| `collector:read` — search / read collectors | ✅ | ✅ | ✅ | |
| **`collector:authorize`** — authorize/revoke a collector; replace a verified destination | | ✅ | ✅ | |
| `collection:record` — weigh, sync events, upload photos, bootstrap the PWA | ✅ | ✅ | ✅ | |
| `rates:read` / `session:read` | ✅ | ✅ | ✅ | |
| `tag:revoke` — revoke an NFC tag | | | ✅ | |
| `session:configure` — sessions, rates, rotations, the staff roster | | | ✅ | |
| `payout:read` — see payouts (a supervisor only those of events **they** recorded) | ✅ | ✅ | ✅ | |
| `payout:approve` — approve / retry a payout (never your own collection) | | ✅ | ✅ | |
| `ledger:read` — stream the ledger, checkpoints, verify | | | ✅ | |
| `reconciliation:write` — enter recycler sales, run reconciliation reports | | | ✅ | |
| `report:generate:all` — read reconciliation reports and recycler sales | | | ✅ | |
| `anomaly:review` — the anomaly queue and verdicts | | | ✅ | |
| **`treasury:read`**: the treasury view and funding proposals | | | ✅ | |
| **`treasury:propose`**: propose a pool→hot-wallet refill, cancel your own proposal, record the transfer reference | | | ✅ | |
| **`treasury:approve`**: approve or reject a refill proposed by someone else, check that the funds arrived | | | ✅ | |
| `treasury:topup:initiate`: read the hot-wallet float (`GET /treasury/float`) | | | ✅ | |
| `session:metrics:read:*`, `report:generate:own`, `apikey:manage` | per role, see the file; most are for milestones not built yet | | | |

`payout:execute` exists in **no** role — paying is a system function. There is no endpoint that
executes a payout and none will be added.

The treasury scopes are **admin only**. `hub_lead` (a field-side role that authorizes collectors and
approves payouts) deliberately holds none of them, so nobody who vets collectors also approves the
money that pays them (ADR-0020). Treasury stewards should be separate people from those who record weights.

A plain **`supervisor` may act only inside an active session they are assigned to** (`403
no_active_session` otherwise); `hub_lead` and `admin` are not shift-bound.

---

## 3. The domain in one page

### 3.1 A collector — three states, one gate

```
register ──► pending ──authorize──► active ◄──authorize── revoked
                │                    │  ▲                   ▲
                └───────revoke───────┴──┴──────revoke───────┘
```

- **`pending`** — registered by a supervisor, not yet vetted. Cannot be weighed, cannot be issued an
  NFC tag, is not in the offline cache, cannot be paid.
- **`active`** — *authorized*. Everything works. (Same word the API has always used for "usable".)
- **`revoked`** — switched off. Events for them are rejected at sync (`collector_not_authorized`).

Who lands where: a **supervisor** registers → `pending`; a **hub_lead/admin** registers →
`active` immediately. Setting `collectors.authorization_required = false` makes everyone `active`
(self-hosters who don't want the gate). Every decision is a ledger-anchored row, so *who authorized
whom* is provable. Pre-existing collectors were grandfathered `active`.

**UI consequences:** the enrol flow ends in "Registered — waiting for authorization" for a
supervisor (show the `publicCode`); there should be a **pending queue** for hub_lead/admin
(`GET /collectors?status=pending`) with the collector's destination visible so they can eyeball it
before approving; a supervisor can list *their own* pending registrations.

### 3.2 Identity, credentials and payment — three separate things

| Thing | What it is | Where |
|---|---|---|
| **Collector** | permanent record; `id` (UUID, client-generatable) + `alias` + `publicCode` | `collectors` |
| **Credential** | a lookup shortcut: manual code, **QR**, or **NFC tag**. Carries `takasats:<publicCode>` — *identity only, never a payment target* | `publicCode`, `reference`, `tag_history` |
| **Payment destination** | where sats go: a Lightning Address / LNURL-pay | `collector_payment_destinations` |

- `publicCode` looks like `TS-KBR-0042` (`TS` = `collectors.code_prefix`, `KBR` = optional site, `0042` =
  a global sequence). Search finds it by the full code or any substring (`0042`).
- `reference.payload` = `takasats:TS-KBR-0042` — put exactly this in a QR code or an NFC text record.
  `reference.url` = `https://taka.afribit.africa/c/TS-KBR-0042` (the same thing as a link; **there is no page
  at `/c/…` yet** — if you want phones to open something when they tap a tag, build a minimal public
  page that reveals nothing).
- **Parsing a scan:** import `parseCollectorRef` from `@/lib/collectors/reference` (pure, safe in the
  browser — do **not** import the `@/lib/collectors` barrel, it pulls in the database). It accepts
  `takasats:…`, a `…/c/<code>` link, or a bare code and returns the normalised code or `null`. On
  `null`, fall back to alias search.
- **A found card pays nobody and reveals nothing** — it is only a pointer.

**Payment destinations** have a status: `pending_validation` → `verified` | `invalid`, or `revoked`.

- A collector has **at most one live** (`pending_validation`/`verified`) destination; the same wallet
  cannot be live for two collectors (`409 destination_in_use`) **however it is written** — `me@blink.sv`,
  `ME@Blink.SV`, its `…/.well-known/lnurlp/me` URL and its `lnurl1…` bech32 are all one wallet. An LNURL
  with a `?query` or `#fragment` is refused (`422`); ask for the wallet's Lightning Address instead.
- **Who may write a destination:** staff (`collector:authorize`) always. A **supervisor only for a collector
  they registered, only while it is `pending`, and only inside an active session** (`403 not_your_collector`
  / `destination_replace_forbidden` / `no_active_session` otherwise). Once staff authorize, the wallet is
  what they vouched for — a supervisor can no longer change it, and a collector authorized with *no* wallet
  can still receive its first one from its registrar (the first payout then waits for approval).
- **Who sees the address:** staff and the registering supervisor. Any other supervisor gets
  `destination.address = null` (and `collector.lightningAddress/lnurlPayRaw = null`) but still sees the
  `status` and `providerHint` — enough for a "wallet ✓ verified (Paybee)" badge.
- If the wallet host is unreachable at attach time the destination is stored `pending_validation`
  (HTTP **202**) and a background job re-checks it; **payouts only use `verified`**.
- **Paybee cards:** a card has two QR codes. **Receive** is a Lightning Address
  (`sample-card@flow.paybee.buzz`) — that is the one to scan. **Pay** is
  `https://card.paybee.buzz/<name>`, a *spending* page. Scanning Pay is rejected with
  `422 spend_credential_rejected` **before any network call**, and the payload is never stored,
  logged or echoed. Tell the user to flip the card. Do not try to "convert" a Pay link into a
  receive address in the client either.
- A Paybee/Blink/Fedi label is available as `destination.providerHint` (display only; configured in
  `lightning.provider_hints`).

### 3.3 A collection event

Captured offline on the supervisor's phone, signed (`contentHash`), queued, synced. Server states
(`SyncResult`): `confirmed` (+ ledger `seq`) or `needs_attention` (+ `code` + English `reason`).
`code` is stable — **translate from `code`**:

| `code` | Cause |
|---|---|
| `content_hash_mismatch` | the fields were altered after signing (or the client/server serialisation drifted) |
| `invalid_timestamp` | `recordedAt` is not a timestamp |
| `collector_not_found` | the collector id does not exist on the server |
| `collector_not_authorized` | the collector is `pending` or `revoked` |
| `no_rate` / `rate_mismatch` | no rate active for that material at `recordedAt`, or a different one than signed |
| `supervisor_not_assigned` | the supervisor is not assigned to the session |
| `event_not_yours` | a plain supervisor tried to sync another supervisor's event |
| `invalid_event` | this one event is malformed (the `reason` names the field, never its value) — e.g. `weightKg` over 999.999 or with more than 3 decimals. The rest of the batch is unaffected |
| `session_not_found` | the `sessionId` does not exist |
| `outside_session_window` | `recordedAt` is outside the session window (± the configured grace). Widen the session, then **re-queue the event** — it is re-validated on every resend |
| `future_timestamp` | `recordedAt` is in the future (a wrong phone clock) |
| `invalid_data` | the database refused the values (a data error) — report it; resending will not help |

Local UI states (`SyncStatus.state`): `queued` → `syncing` → `confirmed` | `needs_attention` | `failed`.
Map to the shared `DisplayStatus` vocabulary in `lib/status.ts`.

**Weight provenance (signed into the event):** `weightSource` ∈ `manual` (default) | `ble_scale` |
`serial_scale` | `industrial_scale`, plus optional `scaleId` and `scaleReadingRaw`. The pilot only
produces `manual`. These are part of the hash — see §4.3. **Verification** (OCR/AI/mass-balance) is
*derived*, never part of the signed event: `collection_events.verification_level` (`V0` manual … `V4`
audited) is independent of payout state. 🚧 (the verification pipeline is a later slice; `V0` today).

### 3.4 Sessions, rates, exchange

A **session** = a place + time window with assigned supervisors (`scheduled` → `active` → `closed`).
A supervisor can only record inside an active assigned session. **Rotations** pre-assign a supervisor
to a location for a window; a new session picks them up automatically. **Rates** are versioned,
never overwritten (fiat minor per kg, per material); an event is paid at the rate that was active
when it was **recorded**, not the current one.

### 3.5 Payouts ✅

A payout is created **automatically** when a collection event is confirmed — nobody creates one, and **nobody pays
one through the API**: only the worker pays, and only after the checks below. The amount is computed once, on the
server, in integer sats, at *that day's* BTC/KES rate and at the material rate that was active **when the event was
recorded**. No request field anywhere carries a destination or an address; the wallet is always the collector's
`verified` one.

```
 awaiting_rate ─► awaiting_destination ─► pending_approval ─► pending_float ─► queued ─► sending ─► paid
      │                  │                      │                  │                        │
   (stale rate)    (no verified wallet)   (a second person)   (float too low)           failed ◄─┘ (staff may retry)
```

| status | meaning | `lastError` | UI |
|---|---|---|---|
| `awaiting_rate` | no fresh BTC price yet | `stale_exchange_rate` | wait — retried automatically |
| `awaiting_destination` | the collector has no **verified** wallet | `no_destination`, `destination_not_verified` | prompt to attach/verify a wallet |
| `pending_approval` | held for a second person | — | **Approve** button (hub_lead/admin, **not** the person who recorded it) |
| `pending_float` | the operating float is too low or unreadable | `insufficient_float`, `float_unavailable` | top up — resumes by itself |
| `queued` | approved/retried, waiting for the worker | — | wait |
| `sending` | being paid right now | `outcome_unknown` = **a human must check the wallet** | none; if it sits long it is flagged for an admin |
| `paid` | done — `providerPaymentRef` and `settledAt` are the proof | — | show the proof |
| `failed` | not paid | `collector_not_authorized`, `amount_not_payable`, `payment_failed`, `destination_rejected` | staff may **Retry** — confirm with the provider first |

- **Pilot mode:** with `payouts.second_signoff_threshold_sats = 0` *every* payout stops at `pending_approval`, so the
  approval queue is the main admin screen. By default the **first payout to any new wallet always needs approval**
  (`payouts.require_approval_first_payout`). Approval is bound to the wallet: if the wallet changes after approval, the
  approval is voided and the payout asks again.
- `amountSats` / `amountFiatMinor` are `null` until the payout has been priced (integers; KES cents).
- After approval the payout is re-priced at a fresh rate, so the sats can differ slightly from what the approver saw.
- A payout in **`sending` for longer than `payouts.sending_stale_minutes`** is never retried automatically — it may have
  gone out. It raises a flag for an admin. **There is no admin "resolve" tool yet** (known gap): the admin checks the
  wallet and resolves it in the database.
- Supervisor view: a supervisor sees only the payouts of events they recorded (others return `404`) — enough to show
  "paid ✓" next to each event. `hub_lead`/`admin` see everything. Partners see nothing here.

---

## 4. Offline contract

### 4.1 Prime the cache — `GET /api/v1/weigh/bootstrap`

Call while online (the weigh screen does on mount). Scope `collection:record`.
`403 no_active_session` if the caller has no active assigned session.

```json
{
  "session": { "sessionId": "…", "location": "Kibera Hub", "scheduledStart": "…", "scheduledEnd": "…" },
  "rates": [ { "rateId": "…", "material": "PET", "rateFiatMinor": 2200, "fiatCurrency": "KES" } ],
  "exchangeRate": 5000000,
  "collectors": [
    { "id": "…", "alias": "Akinyi", "publicCode": "TS-KBR-0042", "nfcTagId": null, "status": "active" }
  ]
}
```

- `collectors` contains **only `active` collectors** — the gate holds offline. A collector authorized
  later appears after the next bootstrap, so prime again when the supervisor taps "Sync now".
- `publicCode` is new (2026-10-01): a cache primed earlier lacks it (`CachedCollector.publicCode` is
  optional). **Add a `by_code` index** to the IndexedDB `collectors` store and search on it so
  `0042` / `TS-KBR-0042` / a scanned QR resolve offline; `exchangeRate` may be `null` (hide the
  indicative amount).
- `exchangeRate` is KES (major units) per 1 BTC. The indicative sats figure is **display only**.

### 4.2 Sync — `POST /api/v1/sync/events`

Scope `collection:record`. A plain `supervisor` may sync only events they recorded.

```json
// request                                   // response — one result per event, same order
{ "events": [ {                              { "results": [
  "id": "uuid-v4",                             { "id": "…", "status": "confirmed", "seq": 17 },
  "collectorId": "…", "supervisorId": "…",     { "id": "…", "status": "needs_attention",
  "sessionId": "…", "material": "PET",           "code": "collector_not_authorized",
  "weightKg": 4.8, "rateId": "…",                "reason": "collector is not authorized (status: pending)" }
  "rateFiatMinor": 2200, "exchangeRate": 5000000, ] }
  "indicativeSats": 1056, "photoSha256": "<64 hex>",
  "geo": { "kind": "fix", "lat": -1.29, "lng": 36.82, "accuracyM": 8 },
  "registrationType": "tap",
  "weightSource": "manual",
  "recordedAt": "2026-10-03T09:30:00.000Z",
  "contentHash": "<64 hex>" } ] }            // 1..200 events per batch
```

- **Idempotent by `id`.** Resend freely; a stored event returns its stored result.
- A whole batch is never failed by one bad event — each is validated and answered on its own, **even a malformed one**
  (it comes back `invalid_event`; the request only fails with `400` if the envelope itself is broken: no `events`
  array, empty, or over 200). A `needs_attention` event
  is *not* retried automatically (its inputs are wrong); surface it to a human.
- `geo` is either a fix or `{ "kind": "unavailable", "reason": "…" }` (reason required — US-2.3).
- Limits: `weightKg` ∈ [0.001, 999.999] with **at most 3 decimals** (the database column is `numeric(6,3)`; a 4th decimal
  would be silently rounded, so it is refused); `recordedAt` must fall inside the session window (± grace) and not be in
  the future; `photoSha256`/`contentHash` are 64 lowercase hex.
- Send `weightSource`, `scaleId`, `scaleReadingRaw` **exactly as hashed** (omit what you didn't hash).
- **Order matters for new collectors:** a collector registered offline must reach the server
  (`POST /collectors` with its client `id`) **before** its events sync, or they come back
  `collector_not_found`. Drain a `collector` outbox kind before `collection_event`. 🚧 (offline enrol
  and its outbox kind are frontend work — see §9.)
- A collector registered offline is `pending`; the gate means its events will come back
  `collector_not_authorized` until staff authorize — so the PWA should not offer to weigh a
  `pending` collector at all (it is not in the cache).

### 4.3 The content hash — a frozen contract

`contentHash = sha256(canonicalJSON(payload))` where canonical JSON has sorted keys at every level, no
whitespace, and drops `undefined`. The signed payload is exactly:

`id, collectorId, supervisorId, sessionId, material, weightKg, rateId, rateFiatMinor, exchangeRate,
indicativeSats, photoSha256, geo, registrationType, recordedAt, weightSource, scaleId, scaleReadingRaw`

(`scaleId`/`scaleReadingRaw` only when set.) `lib/sync/events.ts:collectionEventPayload` builds it on
both sides; **do not hand-roll it**. It is pinned by fixed-vector tests
(`lib/sync/events.test.ts`) whose pre-images were hashed by an independent implementation. An event
queued before 2026-10-01 has no weight fields and still verifies — the server hashes only what it
receives. **Never rename or reshape a field; only add.**

`recordedAt` is the device clock, honestly labelled; the server orders by ingestion (`seq`).

### 4.4 Photos — `POST` and `GET /api/v1/photos`

Raw image bytes as the body, `Content-Type: image/*`, header `X-Photo-Sha256: <hex>` (computed on-device
from the same bytes). The server re-hashes and rejects a mismatch. `201 { photoUrl, sha256 }`. Stored
content-addressed at `photos/<sha256>`, so resending is harmless. ≤ 8 MiB. Photos upload **independently**
of event sync; the event's `photoUrl` is back-filled when both have arrived. Capture guidance for the
pilot: **the photo must show the waste, the scale and the scale's display** (the verification slice reads it).

**Showing a photo:** `GET /api/v1/photos/<sha256>` (scope `collector:read` — staff only) streams the stored image
with `Cache-Control: private, max-age=31536000, immutable` (it is content-addressed, so it never changes).
`404` until the upload queue has delivered the bytes. **Never render `collection_events.photo_url`** — it is an
internal storage address a browser cannot reach and the bucket is private.

---

## 5. Endpoint reference

All paths are under `/api/v1`. "Scope" is what the caller needs.

### 5.1 Collectors ✅

#### `POST /collectors` — register · scope `collector:enrol`

Plus `requireActiveSession` for a plain supervisor.

```json
// request                                       // 201
{ "id": "optional client uuid",                  { "collector": {
  "alias": "Akinyi",                               "id": "…", "alias": "Akinyi",
  "siteCode": "KBR" }                              "publicCode": "TS-KBR-0042",
                                                   "status": "pending",            // or "active" for hub_lead/admin
                                                   "reference": { "payload": "takasats:TS-KBR-0042",
                                                                  "url": "https://taka.afribit.africa/c/TS-KBR-0042" },
                                                   "nfcTagId": null, "addressSource": "byo",
                                                   "lightningAddress": null,        // deprecated, see §8
                                                   "lnurlPayRaw": null,             // deprecated, see §8
                                                   "enrolledAt": "…", "registeredBy": "…",
                                                   "authorizedBy": null, "authorizedAt": null } }
```

Only `alias` is required. `siteCode` (2–6 letters) is optional; falls back to `collectors.default_site_code`.
Resending the same `id` returns the original row (and the same code).

#### `GET /collectors` — search / queue · scope `collector:read`

| Query | |
|---|---|
| `q` | alias **or** public code, case-insensitive substring. **Required** when `status=active` |
| `status` | `active` (default) · `pending` · `revoked` · `all` |
| `limit` | 1–100 (default 20) |

- A **supervisor** may use `active` (needs `q`) or `pending` (**only their own** registrations). `revoked`/`all` → 403.
- **hub_lead/admin** (`collector:authorize`) may use any status; each item then also has
  `destination` (`null` or a destination view) so the pending queue can show the wallet.

```json
{ "collectors": [ { "id": "…", "alias": "Akinyi", "publicCode": "TS-KBR-0042",
                    "nfcTagId": null, "status": "active" } ] }
```

#### `GET /collectors/:id` — one collector + its live destination · scope `collector:read`

```json
{ "collector": { …as above… },
  "destination": { "id": "…", "type": "lightning_address", "address": "sample-card@flow.paybee.buzz",
                   "providerHint": "paybee", "status": "verified", "validationError": null,
                   "verifiedAt": "…", "createdAt": "…", "revokedAt": null } }   // or "destination": null
```

#### `POST /collectors/:id/authorization` — authorize / revoke · scope `collector:authorize`

```json
{ "decision": "authorize" | "revoke", "reason": "optional, ≤ 500 chars" }
→ 200 { "collector": { … }, "changed": true }      // changed:false = it was already in that state; nothing written
```

#### `POST /collectors/:id/destinations` — attach or replace the payout destination · scope `collector:enrol`

```json
{ "rawCode": "sample-card@flow.paybee.buzz" }   // a Lightning Address, an lnurl1… string, or the scanned Receive QR text
→ 201 { "destination": { … }, "collector": { … } }       // verified
→ 202 { "destination": { …"status":"pending_validation" }, "collector": { … } }   // wallet host unreachable; a job retries
→ 422 spend_credential_rejected | not_receive_capable | unsafe_lnurl_target | invalid_lightning_address
→ 409 destination_in_use · 403 destination_replace_forbidden · 409 collector_not_authorized (revoked)
```

Sending the same address again is a no-op that returns the existing destination. A `pending` collector
**can** receive a destination (so staff can review it before authorizing). See §3.2 for who may write one. The address is normalised
(trimmed, lower-cased, `lightning:` prefix stripped). The scanned payload itself is never stored.

#### `GET /collectors/:id/destinations` — history, newest first · scope `collector:read`
`{ "destinations": [ …destination views… ] }` — staff and the registering supervisor only (`403 not_your_collector` for any other supervisor).

#### `POST /collectors/:id/destinations/:destinationId/revoke` · scope `collector:authorize`
`→ 200 { "destination": { …"status":"revoked" } }`. Idempotent. The collector then has no live destination.

#### `POST /collectors/:id/address` — **deprecated alias** · scope `collector:enrol`
Body `{ "rawCode" }`; same as `…/destinations` but always `200`, response `{ collector, destination }`.
Kept so the current enrol screen works. Migrate to `…/destinations`.

#### `POST /collectors/:id/tags` — issue/replace an NFC tag · scope `collector:enrol`
`{ "newTagId": "<NFC serial>" }` → `201 { tag }`. **`409 collector_not_authorized` unless the collector is `active`.**
The tag *content* should be `reference.payload`; `newTagId` is the chip's serial, used only for revocation.

#### `POST /collectors/:id/tags/revoke` · scope `tag:revoke` (admin)
`{ "tagId"?: "…" }` (defaults to the collector's current tag) → `200 { tag }`; `404` if none is active.

#### `GET /tags/:tagId` — resolve a tapped tag · scope `collector:read`
`200 { collector, tag }` · `410 tag_revoked` · `409 collector_not_authorized` · `404` never issued.

### 5.2 Sessions, rates, roster ✅

| Endpoint | Scope | Notes |
|---|---|---|
| `GET /sessions/current` | any staff | `{ "session": SessionView \| null }` — the session the caller may act in **now** |
| `GET /sessions` | staff/partner (scoped) | admin: all · staff: assigned · partner: sponsored. `{ sessions }` |
| `POST /sessions` | `session:configure` | `{ location, scheduledStart, scheduledEnd, geoBounds?, sponsorPartnerId?, supervisorIds[] }` → `201 { session }`. Supervisors rostered via rotations at that location/window are **added automatically** |
| `GET /sessions/:id` | assigned staff / admin | `{ session }` (includes `supervisorIds`); `403` if not yours |
| `PATCH /sessions/:id` | `session:configure` | any of `location, scheduledStart, scheduledEnd, status, geoBounds, sponsorPartnerId, supervisorIds` |
| `GET /rates` | `rates:read` | `{ rates: [{ id, material, rateFiatMinor, fiatCurrency, effectiveFrom, effectiveTo }] }` current only |
| `GET /rates/history?material=` | `rates:read` | full versioned history |
| `POST /rates` | `session:configure` | `{ material, rateFiatMinor, effectiveFrom? }` → `201 { rate }`; closes the previous version. A start not after the current one → `422` |
| `GET /supervisors?role=&includeInactive=1` | `session:configure` | `{ supervisors: [{ id, name, role, active }] }` — pickers |
| `GET /rotations` · `POST /rotations` · `DELETE /rotations/:id` | `session:configure` | `{ location, supervisorId, windowStart, windowEnd }`; rotations apply at **session creation** only |

`SessionView` = `{ id, location, geoBounds, scheduledStart, scheduledEnd, status, sponsorPartnerId, supervisorIds }`.

### 5.3 Payouts and treasury ✅

#### `GET /payouts` · scope `payout:read`

Query: `status`, `collectorId`, `sessionId`, `eventId` (all optional; uuids), `cursor`, `limit` (1–100, default 50).
Newest first; pass `nextCursor` back as `cursor`. A supervisor only ever gets payouts of events they recorded.

```json
{ "payouts": [ {
    "id": "…", "status": "paid",
    "amountSats": 1056, "amountFiatMinor": 144, "fiatCurrency": "KES",
    "collectionEventId": "…", "collectorId": "…",
    "collectorAlias": "Akinyi", "collectorPublicCode": "TS-KBR-0042",
    "provider": "blink", "providerPaymentRef": "…",
    "approvedBy": "…", "approvedAt": "…", "lastError": null,
    "attempts": 1, "createdAt": "…", "settledAt": "…",
    "openFlags": 0 } ],
  "nextCursor": null }
```

`openFlags` = unreviewed anomaly flags on the payout's event (§5.9) — warn the approver; a flag never blocks.
There is **no address field**. Errors: `400 invalid_request` (bad filter), `400 invalid_cursor`.

#### `GET /payouts/:id` · scope `payout:read`
`{ "payout": { …as above… } }` · `404 not_found` (also when it is another supervisor's).

#### `GET /payouts/summary` · scope `payout:read`
`{ "byStatus": [{ "status": "paid", "count": 12, "totalSats": 12480 }, …all 8 statuses, zero-filled…], "total": { "count": 20, "totalSats": 21100 } }`
— `totalSats` sums priced payouts only. A supervisor's numbers cover only their own events.

#### `POST /payouts/:id/approve` · scope `payout:approve` (hub_lead, admin) — no body
`200 { "payout": { … }, "changed": true }` · `403 self_approval` (you recorded this collection) · `403 forbidden` ·
`404 not_found` · `409 invalid_state` (not awaiting approval; `details.status`). Idempotent (`changed: false`).

#### `POST /payouts/:id/retry` · scope `payout:approve` — no body
`failed → queued`. `200 { payout, changed }` · `409 invalid_state` for any other status. **Check the wallet first:**
a retry fetches a fresh invoice, so nothing but you stops it paying twice if the first attempt actually landed.

#### `GET /treasury/float` · scope `treasury:topup:initiate` (admin)
`200 { "available": 482000, "asOf": "…", "lowBalance": false }` · `503 float_unavailable` (the rail is unreachable; no
detail is leaked). `lowBalance` is true below `payouts.float_low_balance_alert_sats`.

#### 5.3.1 The treasury funding vote ✅ (admin only)

How the programme's pool refills the capped hot wallet (`docs/TREASURY.md`, ADR-0020). **Taka Sats only
records the vote.** The transfer is signed in the pool's own wallet; there is no endpoint that moves pool
funds and no field that carries a key, a seed or an address. Every state change below appends a
`treasury_topup` entry to the ledger chain, in the same transaction.

```
 proposed ──(N distinct approvers, never the proposer)──► approved ──(txid recorded)──► transferred ──(float rose)──► confirmed
    │                                                         │
    └──────────────── rejected | cancelled ◄──────────────────┘   (only before a transfer is recorded)
```

| status | meaning | UI |
|---|---|---|
| `proposed` | open for approval | Approve / Reject (not for the proposer), Cancel (proposer only) |
| `approved` | `approvalsRequired` distinct stewards approved | "Sign the transfer in the pool wallet", then **record its txid** |
| `transferred` | the txid is recorded, the funds are not yet seen | wait; **Check arrival** (the worker also checks every `payouts.sweep_cron`) |
| `confirmed` | the hot-wallet balance showed the funds; waiting payouts were woken | done |
| `rejected` / `cancelled` | the vote ended without a transfer | done |

**`TopupView`** (every action returns `{ topup, changed }`; `changed: false` = it was already so, nothing written):

```json
{ "id": "…", "status": "approved", "amountSats": 50000, "note": "two weeks of payouts",
  "createdAt": "…", "approvalsRequired": 2,
  "proposedBy": { "id": "…", "name": "Wanjiru" },
  "approvals": [ { "by": { "id": "…", "name": "Otieno" }, "at": "…" } ],
  "floatBaselineSats": 4200,                 // hot-wallet float when the quorum was reached; null if it could not be read
  "transfer": { "reference": "abc123…", "by": { "id": "…", "name": "…" }, "at": "…" },   // or null
  "outcome": { "at": "…", "by": { "id": "…", "name": "…" } /* null = confirmed by the worker */, "reason": null } }  // or null
```

**`GET /treasury`** · scope `treasury:read`: one payload for the treasury panel:

```json
{ "hotWallet": { "available": 482000, "asOf": "…", "lowBalance": false, "error": null },
  "cap": { "sats": 1000000, "headroomSats": 440000 },          // both null when no cap is set
  "approvalsRequired": 2,
  "inFlightSats": 78000,                                        // proposed + approved + transferred (counts against the cap)
  "pendingTopups": [ …TopupView… ],                             // not yet confirmed, rejected or cancelled
  "pendingPayouts": { "count": 3, "totalSats": 3100 },          // payouts waiting in pending_float
  "pool": { "configured": false, "balanceSats": null } }        // a read-only pool balance is not built: show "not configured", never 0
```

If the hot wallet cannot be read the call is still `200`, with `hotWallet: { available: null, asOf: null, lowBalance: null, error: "float_unavailable" }` and `cap.headroomSats: null`.

**`GET /treasury/topups`** · scope `treasury:read`: newest first. Query `status`, `cursor` (the previous `nextCursor`), `limit` 1-100 (default 50). `{ "topups": [ …TopupView… ], "nextCursor": … }`.
**`GET /treasury/topups/:id`** · `treasury:read`: `{ "topup": TopupView }`, `404 not_found`.

**`POST /treasury/topups`** · scope `treasury:propose`: `{ "id"?: uuid, "amountSats": 50000, "note"?: "≤ 500 chars" }` → `201 { topup, changed: true }`.

- `amountSats` must be a positive whole number (`400 invalid_request` otherwise: 0, negative, fractional, a string, an extra field).
- `id` is an optional client UUID: resending the same proposal returns `200 { changed: false }`; the same `id` with a different amount or proposer is `409 conflict`.
- `422 hot_wallet_cap_exceeded` when `float + inFlightSats + amountSats > cap` (only when `treasury.hot_wallet_cap_sats > 0`); `503 float_unavailable` when a cap is set and the float cannot be read. Nothing is guessed.

**`POST /treasury/topups/:id/signoff`** · scope `treasury:approve`: no body. Records the caller's approval.
`403 self_approval` for the proposer · `409 invalid_state` for a cancelled, rejected or already-approved proposal ·
a resend by the same steward is `200 { changed: false }` and counts once. The approval that completes the quorum
moves the status to `approved` and notes the hot-wallet float (the baseline arrival is judged against).

**`POST /treasury/topups/:id/transfer`** · scope `treasury:propose`: `{ "reference": "<txid or other reference>" }` (1-200 printable characters,
no spaces; stored lower-case). Only on an `approved` proposal (`409 invalid_state` otherwise). The same reference again is
`200 { changed: false }`; a different reference on the same proposal, or one already used by another proposal, is `409 conflict`.
`503 float_unavailable` if no baseline was taken at quorum and the float cannot be read now.

**`POST /treasury/topups/:id/confirm`** · scope `treasury:approve`: no body. Checks the hot-wallet balance:
`200 { topup, changed, arrived }`. `arrived: false` is **not** an error (the funds have not shown up; nothing changed). The proposal is
confirmed only when `float + sats paid out since the baseline ≥ baseline + amount`; a person's say-so is never enough. On confirmation
the payouts parked in `pending_float` are woken at once. `409 invalid_state` unless `transferred`; `503 float_unavailable`.

**`POST /treasury/topups/:id/cancel`** · scope `treasury:propose`: optional `{ "reason" }`. The proposer withdraws their own proposal (`403` for anyone else). Only before a transfer is recorded.
**`POST /treasury/topups/:id/reject`** · scope `treasury:approve`: optional `{ "reason" }`. Another steward refuses it (a single veto; `403 self_approval` for the proposer). Only before a transfer is recorded.
Both are idempotent and return `409 invalid_state` once a transfer is recorded or the vote has otherwise ended.

### 5.4 Ledger ✅ (admin only)

All need `ledger:read`. Rows carry only ids, hashes and timestamps — never collector PII.

**`GET /ledger`** — keyset-paginated chain. Query `order=asc|desc` (default `asc`), `cursor=<seq>`
(`asc` → `seq > cursor`; `desc` → `seq < cursor`), `limit` (default 100, clamped to 500).

```json
{ "entries": [ { "id": "…", "seq": 1,
    "entryType": "collection_event",
    "payloadHash": "…64 hex", "prevEntryHash": null, "entryHash": "…64 hex",
    "referencesId": null, "createdAt": "…", "deviceRecordedAt": null } ],
  "nextCursor": 2, "order": "asc" }          // nextCursor:null = last page
```

`entryType` ∈ `collection_event` · `payout` · `correction` · `treasury_topup` · `rate_change` · `tag_revocation` ·
`collector_authorization` · `recycler_sale`. A funding vote writes one `treasury_topup` entry per state change (proposed, each approval, transfer recorded, confirmed, rejected, cancelled). `prevEntryHash` is `null` only at `seq` 1.

**`GET /ledger/checkpoints`** — signed anchors, newest first. `cursor=<throughSeq>`, `limit`.
`{ "checkpoints": [{ id, throughSeq, entryHash, signature, nostrEventId, opentimestamps, createdAt }], "nextCursor", "publicKey": "<base64 Ed25519>" | null }`

**`GET /ledger/verify?mode=full|windowed`** — recompute the chain server-side. Always `200`; check `ok`:

```json
{ "ok": true,  "mode": "full", "count": 4, "throughSeq": 4, "headHash": "…", "checkpoints": { "verified": 1, "signaturesChecked": true } }
{ "ok": false, "mode": "full", "brokenAt": 2, "reason": "entry_hash mismatch (payload or link altered)" }
```

How the chain works and how an outsider verifies it: `docs/LEDGER.md` and `scripts/verify-ledger.ts`.

### 5.5 Weigh, photos ✅ — see §4.

### 5.6 Meta and health ✅ (public)

- `GET /api/v1/health` → `200 { "ok": true, "database": "up" }` or `503 { "ok": false, "database": "down" }`.
- `GET /api/v1/meta` → see §7.

### 5.7 Not endpoints, but worth knowing

`/api/v1/internal/jobs/enqueue` is a `CRON_SECRET`-bearer bridge for Vercel Cron — not for the UI.

### 5.8 Collection events list ✅

#### `GET /events` — review screens and session logs · scope `collector:read`

A plain **supervisor sees only the events they recorded**; `hub_lead`/`admin` see all. Newest
`recordedAt` first.

| Query | |
|---|---|
| `sessionId`, `collectorId` | uuid filters |
| `material` | exact match, e.g. `PET` |
| `from` / `to` | ISO timestamps on `recordedAt`; `from` inclusive, `to` exclusive |
| `cursor`, `limit` | cursor = the previous `nextCursor` (opaque); `limit` 1–100, default 50. A bad cursor is `400 invalid_cursor` |

```json
{ "events": [ {
    "id": "…", "seq": 17,
    "collector": { "id": "…", "alias": "Akinyi", "publicCode": "TS-KBR-0042" },
    "supervisorId": "…", "sessionId": "…",
    "material": "PET", "weightKg": 4.8, "weightSource": "manual", "scaleId": null,
    "indicativeSats": 1056,
    "photoSha256": "…64 hex", "photoPath": "/api/v1/photos/…64 hex",
    "recordedAt": "…", "syncedAt": "…",
    "verificationLevel": "V0", "verificationStatus": "verified",
    "geo": { "kind": "fix", "lat": -1.29, "lng": 36.82, "accuracyM": 8 },
    "payout": { "id": "…", "status": "paid", "amountSats": 1056 },
    "openFlags": 0 } ],
  "nextCursor": "…" }                       // null = last page
```

- `geo` for a **supervisor** is only `{ "kind": "fix" }` or `{ "kind": "unavailable" }` — no
  coordinates, no reason. `hub_lead`/`admin` get `lat/lng/accuracyM` or `reason`.
- Render the photo with `photoPath` (`<img src>`); there is no `photoUrl` field. `payout` is `null`
  until a payout exists. `openFlags` = unreviewed anomaly flags on the event — show a warning badge.

### 5.9 Anomalies ✅ (admin)

A flag is a **note for a human**; it never blocked the sync or the payout. Detectors run right
after an event is confirmed, so a flag may appear a moment after the event.

| `type` | Raised when | `context` (shape) |
|---|---|---|
| `duplicate_photo` | the same photo bytes were already filed on an earlier event (any collector or supervisor) | `{ duplicateOfEventId, sameCollector }` |
| `identical_weight_repeat` | one supervisor records the same weight `anomaly.identical_weight_repeat_count` (4) times in a row for a material | `{ weightKg, repeatCount }` |
| `gps_outlier` | the GPS fix is outside the session's `geoBounds` (on the edge counts as inside) | `{ lat, lng, accuracyM }` |
| `weight_outlier` | the weight is further than `anomaly.weight_outlier_mad_k` (6) scaled-MADs from the material's median, once ≥ `weight_outlier_min_events` (20) earlier events exist | `{ material, weightKg, median, scaledMad, k, history }` |
| `payout_concentration` | paid sats in a session are concentrated (Gini ≥ `anomaly.payout_concentration_gini`, ≥ 5 collectors) — raised by a reconciliation run | `{ gini, collectors, threshold }` |
| `mass_balance_variance` | a reconciliation run found a material over tolerance | `{ reportId, material, periodStart, periodEnd, collectedKg, recyclerKg, varianceKg, variancePct, tolerancePct }` |
| `revoked_tag_tap`, `payout_uncertain` | older flags (a revoked tag was tapped; a payout's outcome is unknown) | `{ tagId }` / `{ payoutId, reason }` |

#### `GET /anomalies` · scope `anomaly:review`

Query: `status=open|confirmed|dismissed|all` (default `open`), `type`, `eventId`, `cursor`, `limit` (≤ 100).

```json
{ "anomalies": [ {
    "id": "…", "type": "duplicate_photo", "status": "open",
    "eventId": "…" /* null for mass_balance_variance / payout_concentration / revoked_tag_tap */,
    "sessionId": "…" /* or null */, "detectedAt": "…",
    "context": { "duplicateOfEventId": "…", "sameCollector": false },
    "collector": { "id": "…", "alias": "Akinyi", "publicCode": "TS-KBR-0042" } /* or null */,
    "supervisor": { "id": "…", "name": "Brian" } /* or null */,
    "reviewedBy": null, "reviewedAt": null, "reviewNote": null } ],
  "nextCursor": null }
```

#### `POST /anomalies/:id/review` · scope `anomaly:review`

```json
{ "outcome": "confirmed" | "dismissed", "note": "optional, ≤ 1000 chars" }
→ 200 { "anomaly": { …as above, status = the outcome… }, "changed": true }
→ 404 not_found · 400 invalid_request
→ 409 review_final      // the SAME admin trying to change their own verdict
```

Repeating the same outcome is a no-op (`changed: false`). A **different admin** may overturn a
verdict; the superseded one is kept in `anomaly.context.history[]` as
`{ outcome, reviewedBy, reviewedAt, note }` — show it as an audit trail.

### 5.10 Recycler sales and reconciliation ✅ (admin)

Reconciliation is the programme's main fraud control: kilograms **collected** vs what the
**recycler accepted**. Weights are exact (3 decimals); the response numbers are safe to display
as-is.

#### `POST /recycler-sales` · scope `reconciliation:write`

```json
{ "id": "optional client uuid", "material": "PET", "grossKg": 10.5, "tareKg": 0.25,
  "buyer": "Kibera Recyclers", "soldAt": "2026-06-10T12:00:00Z",
  "pricePerKgFiatMinor": 2000, "totalFiatMinor": 21000, "receiptSha256": "<64 hex>" }
→ 201 { "sale": { "id": "…", "material": "PET", "grossKg": 10.5, "tareKg": 0.25, "weightKg": 10.25,
                  "buyer": "…", "pricePerKgFiatMinor": 2000, "totalFiatMinor": 21000,
                  "soldAt": "…", "receiptSha256": "…", "receiptPath": "/api/v1/photos/…",
                  "enteredBy": "…", "ledgerSeq": 42, "createdAt": "…" } }
→ 400 invalid_request   // tareKg > grossKg, grossKg ≤ 0, more than 3 decimals, bad hash
```

Only `material`, `grossKg`, `buyer`, `soldAt` are required; `tareKg` defaults to 0. `weightKg`
is the **net accepted weight** (gross − tare), computed by the server and the figure
reconciliation uses. `totalFiatMinor` is what the receipt says — it is never computed. Upload
the receipt photo with `POST /photos` first and send its `receiptSha256`. Resending the same
`id` returns the original sale (still `201`), never a second one.

#### `GET /recycler-sales` · scope `report:generate:all`
`?cursor=&limit=` → `{ "sales": [ …as above… ], "nextCursor": … }`, newest `soldAt` first.

#### `GET /reconciliation?from=&to=&material=` · scope `report:generate:all`

Computed live for `[from, to)`; nothing is saved. `from` and `to` are required.

```json
{ "period": { "from": "…", "to": "…", "material": null },
  "rows": [ { "material": "PET", "collectedKg": 100, "paidKg": 96.5, "recyclerKg": 97.2,
              "varianceKg": 2.8, "variancePct": 2.8, "tolerancePct": 5,
              "status": "within_tolerance" } ] }
```

`varianceKg = collectedKg − recyclerKg` (negative = the recycler took **more** than was collected —
also a problem); `variancePct = varianceKg / collectedKg × 100`. `paidKg` counts events whose
payout is `paid`. `status`:

| `status` | Meaning |
|---|---|
| `within_tolerance` | `\|variancePct\| ≤ tolerancePct` (exactly at the tolerance passes) |
| `flagged` | over the tolerance, **or** kilograms were sold that were never collected |
| `no_recycler_data` | no recycler sale recorded for that material in the period — *not* a pass; prompt for data entry |

#### `POST /reconciliation/runs` · scope `reconciliation:write`
Body `{ "from", "to", "material"? }` → `201 { "reports": [ { "id", "periodStart", "periodEnd", "material",
"collectedKg", "paidKg", "recyclerKg", "varianceKg", "variancePct", "tolerancePct", "status", "createdBy",
"createdAt" } ] }`. Saves one report per material (never edited afterwards — a new run is new rows;
`tolerancePct` is the setting at run time) and raises a `mass_balance_variance` anomaly for each
`flagged` row. Also checks each session in the period for `payout_concentration`.

#### `GET /reconciliation/reports` · scope `report:generate:all`
`?material=&cursor=&limit=` → `{ "reports": [ …as above… ], "nextCursor": … }`, newest first.

### 5.11 Public summary ✅ (no session)

#### `GET /stats/summary` — public, aggregate-only, cacheable

`Cache-Control: public, max-age=60`. Safe for a public page: no alias, no per-person figure, no
GPS, no wallet, no photo. Precision follows `transparency.amount_disclosure` (`exact` | `bucketed`
| `omitted`) and `transparency.weight_bucket_kg`.

```json
{ "events": 1204, "collectors": 187,
  "kgByMaterial": [ { "material": "HDPE", "kg": 310 }, { "material": "PET", "kg": 1520.5 } ],
  "satsPaid": 4200            // exact → number
           /* bucketed → { "bucket": { "min": 1000, "max": 10000 } } · omitted → null */,
  "firstEventAt": "…", "lastEventAt": "…",
  "ledger": { "entries": 1391, "headHash": "…64 hex", "lastCheckpointAt": "…" } }
```

When disclosure is not `exact`, `kg` is rounded **down** to a multiple of `weight_bucket_kg`
(0.5), so do not display it with more precision than that. An empty programme returns zeros and
`null` dates.

---

## 6. Things that happen in the background

The **worker** (`pnpm worker`, pg-boss) runs these; the UI never calls them, but their effects show up:

| Job | Effect the UI sees |
|---|---|
| `validate-collector-destination` | a `pending_validation` destination becomes `verified` or `invalid` (poll `GET /collectors/:id`) |
| `refresh-exchange-rate` | `bootstrap.exchangeRate` stays fresh; payouts refuse a stale snapshot |
| `create-ledger-checkpoint` | new rows in `GET /ledger/checkpoints` |
| anomaly detectors (inline, right after a sync confirms an event) | new flags in `GET /anomalies`; `openFlags` on events and payouts (§5.8, §5.9) |
| `provision-collector-wallet` | custodial path only (off by default, gate G1) |
| `process-payout` / `sweep-payouts` | a payout moves through its states (§3.5); the sweep (every 5 min) resumes anything parked — a stale rate, a missing wallet, a low float |
| `confirm-treasury-topups` | a `transferred` funding proposal becomes `confirmed` once the hot-wallet balance shows the funds (same cadence as the sweep); waiting payouts are then woken (§5.3.1) |

---

## 7. Configuration that changes the UI

Read from `config/settings.toml` (see `docs/CONFIGURATION.md`). **`GET /api/v1/meta`** (public, no session, ✅)
exposes the non-sensitive ones so the UI never guesses:

```json
{ "programme": { "name": "…", "timezone": "Africa/Nairobi", "fiatCurrency": "KES",
                 "locales": ["en","sw","sheng"], "defaultLocale": "en",
                 "publicBaseUrl": "https://taka.afribit.africa" },
  "collectors": { "authorizationRequired": true, "codePrefix": "TS", "defaultSiteCode": "KBR" },
  "lightning": { "floatProvider": "blink", "demo": false },
  "build": "<git sha or null>" }
```

`lightning.demo: true` means payouts are **simulated** (the `fake` provider) — show a persistent "Demo mode —
no real sats are sent" banner. Fetch it once on load; it does not change while the app runs.

| Setting | UI effect |
|---|---|
| `collectors.authorization_required` | `false` → no pending state; hide the queue |
| `collectors.code_prefix` / `default_site_code` | shape of `publicCode` |
| `programme.public_base_url` | base of `reference.url` |
| `programme.fiat_currency`, `locales`, `default_locale` | currency and language options |
| `lightning.provider_hints` | which wallet labels exist |
| `treasury.topup_approvals_required` / `treasury.hot_wallet_cap_sats` | the same values arrive on `GET /treasury` (`approvalsRequired`, `cap`); read them there, not from `/meta` |

---

## 8. Changelog for the frontend

Newest first. Anything here may need a UI change.

**2026-10-01 (treasury): the pool→hot-wallet funding vote (M5-7)**
- **New endpoints:** `GET /treasury`, `GET`/`POST /treasury/topups`, `GET /treasury/topups/:id`,
  `POST /treasury/topups/:id/{signoff,transfer,cancel,reject,confirm}` (§5.3.1). `GET /treasury/float` is unchanged.
- **New scopes** `treasury:read`, `treasury:propose`, `treasury:approve`, **admin only** (a `hub_lead` has none).
- **New state enum** `TopupStatus`: `proposed` · `approved` · `transferred` · `confirmed` · `rejected` · `cancelled`.
- **New error codes:** `422 hot_wallet_cap_exceeded` (with `details.capSats` / `headroomSats`). Existing codes reused:
  `403 self_approval` (now also for a proposer), `409 invalid_state`, `409 conflict`, `503 float_unavailable`.
- **New config:** `[treasury] topup_approvals_required` (default 2, never counting the proposer) and `hot_wallet_cap_sats` (default `0` = no cap).
- **Behaviour:** `treasury_topup` ledger entries now appear in `GET /ledger`; a confirmed refill wakes payouts parked in `pending_float`.
- **UI to build:** a steward panel (float, cap and headroom, pending proposals with approve / reject / cancel, "record the transfer txid",
  "check arrival"), and a "waiting for funds" count from `pendingPayouts`. Show the pool as **not configured**, never as zero.

**2026-10-01 (reconciliation) — anomalies, recycler sales, reconciliation, events list, public summary**
- **New endpoints:** `GET /events`, `GET /anomalies`, `POST /anomalies/:id/review`, `POST`/`GET /recycler-sales`,
  `GET /reconciliation`, `POST /reconciliation/runs`, `GET /reconciliation/reports`, `GET /stats/summary` (§5.8–5.11).
- **New scope** `reconciliation:write` (admin). Payout items gain `openFlags` (unreviewed anomaly flags on the payout's
  event) — show a warning on the approval screen.
- **Behaviour:** after a sync confirms an event, detectors may write anomaly flags. The sync result is unchanged.
- New lists use an opaque `nextCursor`; `limit` ≤ 100.

**2026-10-01 (payouts) — the payout engine**
- **New:** `GET /payouts`, `/payouts/:id`, `/payouts/summary`, `POST /payouts/:id/approve|retry`, `GET /treasury/float`;
  scope `payout:read`; `GET /meta` now reports `lightning.demo`. A payout appears for every confirmed event. See §3.5 and §5.3.
- **UI to build:** an **approval queue** (the main admin screen in pilot mode), a per-event "paid ✓ / waiting / failed"
  badge for supervisors, a float widget for admins, and a visible **Demo mode** banner when `lightning.demo` is true.

**2026-10-01 (review pass) — security hardening that changes behaviour**
- **Destinations:** supervisors can now write a wallet only for a collector they registered, while it is pending
  and inside an active session (see §3.2). The enrol flow already fits this (the registrar attaches the wallet
  right after registering); an "add a wallet later" screen for an *authorized* collector is now **staff-only**.
  New error `403 not_your_collector`. Addresses are hidden (`null`) from other supervisors.
- **Photos:** upload accepts only JPEG/PNG/WebP/HEIC (`415` otherwise); `GET /photos/:sha256` now sends a
  sandboxing CSP — render it in an `<img>`, never as a navigated page.
- **Invoices:** a payout whose destination answers with an invoice for a different amount now **fails** (the
  payout shows `failed`, `lastError: payment_failed`) instead of paying it. A rail answering "pending" or a server
  error is **not** a failure — the payout stays `sending` with `outcome_unknown` and is flagged for a human.
- **Sync:** a malformed event is now an `invalid_event` *result*, not a failed request; weights are limited to
  [0.001, 999.999] with 3 decimals; `recordedAt` must be inside the session window; new `needs_attention` codes (§3.3).
- **Exchange rate:** an outlier source is now set aside (as long as two others agree); two sources must agree
  within the tolerance of each other. No client change.

**2026-10-01 (later) — photos, meta, a corrected exchange feed**
- **New:** `GET /api/v1/photos/:sha256` (render evidence photos through this, not `photo_url`); `GET /api/v1/meta`;
  `GET /api/v1/health`.
- **Fixed:** the BTC/KES exchange feed was wrong in two ways when first run against the real services (an inverted
  Yadio endpoint; CoinGecko has no KES). Defaults are now `yadio` + `coinbase` + `kraken_fx` and the indicative
  figure in `bootstrap.exchangeRate` is now trustworthy. No client change needed.
- **Behaviour:** a wallet written in different spellings (`ME@Blink.sv`, its `.well-known` URL, its `lnurl1…`
  bech32) is one wallet — the same collision rule applies (`409 destination_in_use`).

**2026-10-01 — cardless identity, the authorization gate, payment destinations, weight provenance**
- **New:** `publicCode` + `reference` on every collector; search by code. `collectors.status` gains `pending`.
- **New endpoints:** `POST /collectors/:id/authorization`; `POST|GET /collectors/:id/destinations`;
  `POST …/destinations/:id/revoke`; `GET /collectors?status=…`; `GET /ledger`, `/ledger/checkpoints`, `/ledger/verify`.
- **Behaviour change:** `POST /collectors` now returns `pending` for a supervisor. The current `EnrolFlow`
  assumes the collector is usable immediately and **forces a tag step** — it must be changed: show the
  `publicCode`, make the tag step optional (and unavailable until authorized), end in "waiting for authorization".
- **Behaviour change:** `POST /collectors/:id/tags` → `409 collector_not_authorized` for a non-`active` collector.
  `GET /tags/:tagId` → `409` likewise.
- **Behaviour change:** ingest returns `code` on every `needs_attention`; a missing collector is now a
  `needs_attention` result (`collector_not_found`) instead of a 500 for the whole batch.
- **Behaviour change:** scanning a wallet card's **Pay** QR → `422 spend_credential_rejected` (was: the server
  fetched the page). Add a clear message and an illustration of flipping the card.
- **Signed payload gains** `weightSource` (+ optional `scaleId`, `scaleReadingRaw`). `assembleCollectionEvent`
  defaults `weightSource: 'manual'`, so the weigh flow needs no change; `lib/sync/syncLoop.ts` already sends them.
- **Deprecated:** `collector.lightningAddress`, `collector.lnurlPayRaw`, and `POST …/address` — use
  `destination` from `GET /collectors/:id` and `…/destinations`. `EnrolFlow` currently writes
  `collector.lnurlPayRaw ?? collector.lightningAddress` **onto the NFC tag**; per D-24 a tag must carry
  `reference.payload` instead — change `writeTagAndReadSerial(...)`'s argument.
- **Bootstrap:** `collectors[].publicCode` added; only `active` collectors are returned (as before, but now
  `pending` exists, so it matters).
- The collector response no longer includes `lnbitsWalletId`.

---

## 9. Status, gaps and decisions

**Built and tested:** everything marked ✅ above (544 tests at the time of writing).

**Frontend work these changes create** (none of it is blocked on the backend):
1. Enrol flow: public code, optional tag step, "waiting for authorization", scan **Receive** (reject Pay nicely).
2. Authorization queue for hub_lead/admin (`GET /collectors?status=pending` + `POST …/authorization`).
3. Weigh flow: search by `publicCode`; QR scan of `takasats:` references; add the `by_code` index (IndexedDB v3).
4. Offline enrolment (`collector` outbox kind drained before `collection_event`) — still online-only today.
5. The sync loop (`lib/sync/syncLoop.ts`, uncommitted) and the SyncStatus UI states (M4-4/5).
6. Scale-photo capture guidance (waste + scale + display in frame) for the verification slice.
7. A public `/c/<code>` landing page (optional; must reveal nothing).

**Known gaps (backend):** a read-only balance view of the multisig pool (📋; `GET /treasury` reports `pool.configured: false`), an admin tool to resolve a payout stuck in `sending` (📋), OCR/AI verification of the scale
photo (📋), Nostr/OpenTimestamps anchoring (📋), a scheduled (periodic) reconciliation run and hub_lead read access to reconciliation (📋), a minimum-n suppression on the public summary (📋). The real Blink/LNbits `pay()` has never been exercised against a
live account — `docs/PILOT.md §6` makes the first real payment a deliberate, tiny, supervised step.

**Decisions this contract rests on:** D-24 cardless identity · D-25 authorization gate · D-26 payment
destinations · D-27 weight provenance — `docs/REQUIREMENTS.md §2`, `docs/adr/0017..0019`.
