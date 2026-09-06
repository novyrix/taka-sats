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

| Property                                                                                                                                | Where enforced                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| No human role (`supervisor`, `hub_lead`, `admin`) can execute or direct a payout                                                        | `lib/auth/permissions.ts` — `payout:execute` in no role; `permissions.test.ts`   |
| A payout destination is never taken from client input — always resolved server-side from the tag mapping                                | payout worker (M5-3); API has no `destination` field by construction             |
| Exactly one function does sats arithmetic for a payout                                                                                  | `lib/money.ts:computePayout`                                                     |
| A BYO address is validated receive-capable before it is stored or written to a tag; a withdraw (`LNURLw`) code is rejected              | `LightningProvider.resolveReceiveAddress` (M1-2, M1-10)                          |
| `ledger_entries` is append-only — `UPDATE`/`DELETE` revoked at the DB role level; corrections are new linked rows                       | migration (M4-1), `lib/ledger/`                                                  |
| Above-threshold payouts require a second, distinct approver; self-approval is refused                                                   | M5-4                                                                             |
| A payout will not run against an exchange rate older than the configured TTL                                                            | `lib/money` + rate feed (D-18)                                                   |
| Secrets (DB URL, provider keys, `AUTH_SECRET`, Nostr key) live in the environment only — never in `config/*.toml`, client code, or logs | `lib/config/` (schema rejects them), structured-logging allow-list               |
| `partner` / `public:read` responses carry no collector PII or individual payout amounts                                                 | central response serialiser (M7-4) + contract tests (M7-12)                      |
| Every `/api/v1` route is deny-by-default: no session → 401, wrong role → 403, before the handler body runs                              | `lib/auth/session.ts:requireScope`; `session.test.ts`, `app/api/v1/**/*.test.ts` |
| Passwords are never stored or logged in plaintext                                                                                       | `lib/auth/password.ts` (`scrypt`, random salt, `timingSafeEqual`)                |

## Notes

Chronological log of changes to money-handling or RBAC-enforcement code and the property
each preserves or alters (Code Style Guide §12). Newest first.

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
