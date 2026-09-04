# Taka Sats — Threat Model (first draft)

| | |
|---|---|
| Status | Draft — M0-14. Revised whenever a component is added (ROADMAP §12, "Security"). |
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
| T3 | Phantom collectors | Enrolment + community re-verification; reconciliation surfaces divergence; payout-concentration (Gini) flag | M1-3, M6-4 |
| T4 | Records edited to hide fraud (incl. by an admin) | Append-only `ledger_entries`; DB-level `UPDATE`/`DELETE` revoked; hash chain; signed checkpoints; external verifier | ADR-0004/0014, M4-1, `scripts/verify-ledger.ts` |
| T5 | Lost / stolen tag used to drain funds | Tags are receive-only — no spend path exists; revoke + reissue; revoked-tap logged as an anomaly | ADR-0001, M1-9 |
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
  covered by deployment hardening and the treasury runbook (M5-7).

## 6. Out of scope

Denial of service from unrealistic request volume (rate limits are best-effort), physical
attacks on a supervisor, vulnerabilities in third-party services (Blink, LNbits, Neon,
Vercel, relays) — reported upstream — and social engineering of Afribit staff.

## 7. Keeping this current

- A PR that adds a component or a data flow updates §1–§4 here in the same change
  (ROADMAP §12).
- A PR touching money-handling or RBAC-enforcement code adds a note to `SECURITY.md §Notes`.
- The M8-6 external review (gate G5) produces the authoritative assessment; its findings are
  tracked to closure and this document is reconciled against them.
