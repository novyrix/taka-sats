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

| Property                                                                                                                                | Where enforced                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| No human role (`supervisor`, `hub_lead`, `admin`) can execute or direct a payout                                                        | `lib/auth/permissions.ts` — `payout:execute` in no role; `permissions.test.ts` |
| A payout destination is never taken from client input — always resolved server-side from the tag mapping                                | payout worker (M5-3); API has no `destination` field by construction           |
| Exactly one function does sats arithmetic for a payout                                                                                  | `lib/money.ts:computePayout`                                                   |
| A BYO address is validated receive-capable before it is stored or written to a tag; a withdraw (`LNURLw`) code is rejected              | `LightningProvider.resolveReceiveAddress` (M1-2, M1-10)                        |
| `ledger_entries` is append-only — `UPDATE`/`DELETE` revoked at the DB role level; corrections are new linked rows                       | migration (M4-1), `lib/ledger/`                                                |
| Above-threshold payouts require a second, distinct approver; self-approval is refused                                                   | M5-4                                                                           |
| A payout will not run against an exchange rate older than the configured TTL                                                            | `lib/money` + rate feed (D-18)                                                 |
| Secrets (DB URL, provider keys, `AUTH_SECRET`, Nostr key) live in the environment only — never in `config/*.toml`, client code, or logs | `lib/config/` (schema rejects them), structured-logging allow-list             |
| `partner` / `public:read` responses carry no collector PII or individual payout amounts                                                 | central response serialiser (M7-4) + contract tests (M7-12)                    |

## Notes

Chronological log of changes to money-handling or RBAC-enforcement code and the property
each preserves or alters (Code Style Guide §12). Newest first.

- 2026-09-04 — `lib/auth/permissions.ts` introduced. Establishes: `payout:execute` exists
  as a scope but is in no role's set; `permissions.test.ts` fails the build if any human
  role gains it. Preserves separation of duties (ADR-003).
- 2026-09-04 — `lib/money.ts` introduced. `Sats` is a branded integer built only via
  `sats()`; `computePayout` is the sole payout-arithmetic entry point and currently throws
  `NotYetImplemented`. No destination parameter exists on its signature.
