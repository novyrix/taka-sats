# Taka Sats — Code Style Guide

**Waste-to-Bitcoin Earn-First Programme**
Afribit Africa

Version 1.1 — Companion to the Taka Sats Technical Architecture and CONTRIBUTING Guide

**Revision 1.1 (2026-09):** reconciled with `docs/REQUIREMENTS.md` for implementation. Added: `config/`, `worker/`, `db/`, `ledger/`, `e2e/`, `docker/`, `scripts/`, `messages/` and `app/api/v1/` to the project structure (§3); the **config-first rule** (new §7A — nothing operational is hardcoded); the CONTRIBUTING Guide is a v1 (Milestone 0) deliverable, not "forthcoming". Section 9 (Money-Handling Code) is unchanged and remains binding.

---

## 1. Purpose and Scope

This guide governs how code is written across Taka Sats: the Supervisor PWA, the Admin Dashboard (inside Afribit Console), and the Node.js backend. It exists so that code reviews argue about logic and correctness, not tabs versus spaces — every formatting question below is settled by tooling, not by opinion, and every naming or structural question has one answer, not several acceptable ones.

**One rule sits above all the others in this document:** Taka Sats moves real money. Section 9 (Money-Handling Code) is not a normal style-guide section — it is a set of hard constraints, and a pull request that violates it does not merge regardless of how clean the rest of the code is.

---

## 2. Language and Tooling Baseline

| Tool | Choice | Notes |
|---|---|---|
| Language | TypeScript, `strict: true` | No exceptions, no `// @ts-ignore` without a linked issue explaining why |
| Formatter | Prettier | The only source of truth for formatting. ESLint's own formatting rules are disabled — ESLint checks correctness, Prettier checks style, and they never fight each other |
| Linter | ESLint (flat config, `eslint.config.js`) | `typescript-eslint`, `eslint-plugin-react`, `eslint-plugin-react-hooks` |
| Package manager | pnpm | Faster installs, strict dependency resolution — fewer "works on my machine" bugs from phantom dependencies |
| Testing | Vitest + React Testing Library (unit/integration), Playwright (end-to-end) | Vitest shares Vite's transform pipeline, so tests run fast and use the same TypeScript config as the app — no separate Jest config to keep in sync |

### 2.1 tsconfig baseline
```jsonc
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,   // arr[i] is T | undefined, not T — catches
                                          // real bugs at array/object boundaries
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "moduleResolution": "bundler",
    "target": "ES2022"
  }
}
```
`noUncheckedIndexedAccess` in particular is worth the friction it adds: a payment system reading `payouts[i]` and assuming it exists is exactly the kind of bug that becomes a production incident involving someone's money.

### 2.2 Prettier baseline
```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```
No project-specific debate on these values — they are Prettier's own well-tested defaults with `singleQuote` and `printWidth: 100` as the only deviations, chosen for consistency with the existing Console codebase.

---

## 3. Project Structure

### 3.1 Next.js App Router conventions
```
app/
├── (supervisor)/              — route group: supervisor PWA pages
│   ├── weigh/page.tsx
│   └── session/[id]/page.tsx
├── (admin)/                   — route group: admin dashboard pages
│   └── sessions/page.tsx
├── (public)/                  — route group: public transparency site
├── api/v1/                    — versioned, documented HTTP API (OpenAPI 3.1)
│   ├── sync/events/route.ts
│   ├── collectors/route.ts
│   ├── payouts/route.ts
│   └── ledger/route.ts
└── layout.tsx

components/
├── ui/                          — shared primitives (shadcn/ui-sourced, per docs/DESIGN.md §6)
├── weigh/                       — feature-specific components, colocated
│   ├── CollectorLookup.tsx
│   ├── WeighEvent.tsx
│   └── SyncStatusIndicator.tsx
└── admin/

lib/
├── config/                     — layered settings loader + Zod schema (see §8.1)
├── db/                          — Drizzle schema access, one file per table cluster
├── lightning/                   — LightningProvider: LNbits | Blink | Fedimint | Fake
├── sync/                        — offline sync logic, conflict resolution
├── ledger/                      — the append-only hash chain + checkpoints
├── fraud/                       — reconciliation, anomaly detection
├── auth/                        — Auth.js config + RBAC permission matrix
└── money.ts                     — the ONLY place sats arithmetic happens (Section 9)

worker/                          — pg-boss jobs: reconciliation, anomaly, payouts, checkpoints, alerts
db/                              — drizzle-kit migrations (every one has a `down`)
config/                          — settings.default.toml (committed) + schema; settings.toml is git-ignored
messages/                        — en.json (authored) + sw.json + sheng.json (next-intl)
e2e/                             — Playwright specs
docker/                          — docker-compose.yml (+ .custodial.yml overlay), Dockerfiles
scripts/                         — one-off tooling, incl. verify-ledger.ts
types/
└── domain.ts                    — CollectionEvent, Payout, Collector, LedgerEntry, etc.
```

**Rule:** a component that is only used by one feature lives inside that feature's folder (`components/weigh/`), not in the shared `components/ui/` directory. Something only gets promoted to `ui/` when a second, unrelated feature needs it.

### 3.2 File naming
| Type | Convention | Example |
|---|---|---|
| React components | PascalCase | `WeighEvent.tsx` |
| Next.js route files | lowercase (framework convention) | `page.tsx`, `layout.tsx`, `route.ts` |
| Utility/lib modules | camelCase | `computePayout.ts` |
| Type-only files | camelCase | `domain.ts` |
| Test files | same name + `.test.ts(x)` | `computePayout.test.ts` |

---

## 4. Naming Conventions

- **Components**: PascalCase, named for what they show, not how they're built — `WeighEvent`, not `WeighEventComponent` or `WeighEventContainer`.
- **Functions**: camelCase, verb-first — `computePayout`, `resolveCollectorFromTag`, `flagAnomaly`.
- **Booleans**: prefixed `is`, `has`, `can`, or `should` — `isSynced`, `hasSecondApproval`, `canApprove`.
- **Types and interfaces**: PascalCase, no `I` prefix (`Collector`, not `ICollector` — TypeScript's structural typing makes the Hungarian-notation prefix redundant noise).
- **Constants**: `SCREAMING_SNAKE_CASE` only for true module-level constants (`MAX_SYNC_RETRY_ATTEMPTS`), camelCase for everything else, including config objects.
- **Database columns**: `snake_case`, matching the schema in the Technical Architecture document exactly — no translation layer that renames columns between SQL and application code beyond the ORM's standard camelCase mapping.

---

## 5. React and Component Conventions

- **Function components only.** No class components anywhere in this codebase.
- **One component per file**, matching the filename.
- **Props typed explicitly**, never inferred from usage:
```typescript
type WeighEventProps = {
  collectorId: string;
  sessionId: string;
  onComplete: (event: CollectionEvent) => void;
};

export function WeighEvent({ collectorId, sessionId, onComplete }: WeighEventProps) {
  // ...
}
```
- **Hooks**: custom hooks are named `useX` and live in `lib/hooks/` if shared across features, or colocated with the single component that uses them otherwise.
- **No prop drilling past two levels.** If a value needs to pass through more than two component layers, it belongs in context or a state store, not threaded through props by hand.
- **Server Components by default** (Next.js App Router convention); a component is only marked `'use client'` when it genuinely needs interactivity, browser APIs (Web NFC, camera, geolocation), or local state.

---

## 6. TypeScript Conventions

- **No `any`, ever.** Use `unknown` and narrow it, or fix the underlying type. A linter rule (`@typescript-eslint/no-explicit-any`) enforces this at error level, not warning level.
- **Prefer `type` over `interface`** for consistency, except when defining a shape meant to be extended by consumers (rare in this codebase — most domain types are closed shapes).
- **Discriminated unions for state**, not boolean flag soup:
```typescript
// Good — impossible states are unrepresentable
type SyncStatus =
  | { state: 'queued' }
  | { state: 'syncing' }
  | { state: 'confirmed'; syncedAt: string }
  | { state: 'failed'; reason: string };

// Avoid — allows nonsensical combinations like isSyncing && isConfirmed
type SyncStatus = {
  isQueued: boolean;
  isSyncing: boolean;
  isConfirmed: boolean;
  isFailed: boolean;
};
```
This matters more here than in a typical app: sync status (per PRD FR-4.3 and User Story US-4.3) is something a supervisor relies on to know whether their work was saved. A type that can represent an impossible state is a bug waiting to surface exactly when someone's earnings are on the line.

---

## 7. Backend / API Conventions

- **Every API route validates its input against a schema before touching the database** (Zod is the standard choice — it pairs cleanly with TypeScript and gives runtime validation with inferred static types from one definition, not two to keep in sync).
- **Idempotency keys are mandatory on every write endpoint that can be retried** — this is not optional for this codebase, since the offline sync architecture (Technical Architecture, Section 5) depends on the server safely handling a resent event as a no-op, per FR-4.2.
- **Errors are typed, not thrown as bare strings**:
```typescript
class InsufficientFloatError extends Error {
  constructor(public readonly requiredSats: number, public readonly availableSats: number) {
    super(`Insufficient hot float: need ${requiredSats}, have ${availableSats}`);
  }
}
```
- **No business logic in route handlers.** A route handler validates input, calls a function in `lib/`, and shapes the response. The actual payout logic, reconciliation logic, and fraud detection logic live in `lib/`, are independently testable, and have no knowledge of HTTP.
- **Every write endpoint under `/api/v1` is versioned and documented.** The OpenAPI 3.1 spec is generated from the Zod schemas and committed; a CI check fails if it drifts. Breaking changes go to `/api/v2`.

---

## 7A. Configuration — nothing operational is hardcoded

This is a hard rule (decision D-21 in `docs/REQUIREMENTS.md`). It exists so another programme can adopt this codebase by editing one file, not forking it.

1. **A literal operational value in domain code is a review-blocking defect.** Per-kg rates, sign-off thresholds, reconciliation tolerance, TTLs, anomaly parameters, the amount-disclosure mode, the custody model, the Lightning provider — none of these are literals in `lib/` or components.
2. **Defaults live in `config/settings.default.toml`**, committed, every key commented. An operator overrides via a git-ignored `config/settings.toml` and/or environment variables (`TAKASATS__SECTION__KEY=...`).
3. **`lib/config/` loads the layers, merges them, and validates the result with a Zod schema.** A missing or out-of-range value **fails the boot**, loudly. Components and `lib/` import the frozen typed config object — never `process.env` directly, never a raw file read.
4. **Secrets are never in TOML.** `DATABASE_URL`, `BLINK_API_KEY`, `LNBITS_ADMIN_KEY`, `NOSTR_PRIVATE_KEY`, `AUTH_SECRET`, object-storage creds → environment only. `settings.toml` may name *which* provider, never a key.
5. **A new tunable** adds a key to `settings.default.toml` (commented) + the Zod schema + a line in `docs/CONFIGURATION.md`, in the same PR.
6. Operational *data* that changes at runtime (rate versions over time, sessions, API keys, collectors) stays in the database — the settings file only *seeds* the initial rate table.

---

## 8. Database and SQL Conventions

- **Every migration is reversible.** A migration that can't be cleanly rolled back is a migration that gets rewritten before merge.
- **No destructive migrations against production data without an explicit, reviewed backup step documented in the PR description.**
- **Money and weight columns are never `FLOAT` or `DOUBLE`.** Sats are `BIGINT` (they're already an integer atomic unit — there is no such thing as a fractional satoshi). Weights are `NUMERIC` with a fixed, documented precision, never floating point, to avoid the classic rounding-error class of bugs in anything that gets summed and reconciled (Technical Architecture, Section 7).
- **Foreign keys are enforced at the database level**, not just assumed at the application level — `collection_events.supervisor_id` is `NOT NULL REFERENCES supervisors(id)`, exactly as specified in the Technical Architecture's schema, because the audit trail requirement (User Story US-3.7) is worthless if the database allows an orphaned event.

---

## 9. Money-Handling Code — Hard Constraints

This section overrides anything above it if the two ever conflict. These are not style preferences; they are the code-level enforcement of decisions already made in the Technical Architecture document (ADR-001, ADR-003, Section 7).

1. **All sat amounts are integers, always.** `type Sats = number` is banned in favor of a branded type (`type Sats = number & { readonly __brand: 'Sats' }`) constructed only through a validated helper, so a raw, unvalidated number can never silently be passed where a sats amount is expected.

2. **Exactly one function computes a payout amount** (`lib/money.ts:computePayout`). No other file in the codebase performs sats arithmetic for a payout. If you find yourself writing `weight * rate` anywhere else, that is a bug — call the shared function instead.

3. **Payout destination is never accepted as client input.** Per the Technical Architecture's fraud-prevention mapping (Section 7): the server resolves a payout's destination Lightning Address exclusively from the tapped tag's server-side mapping. An API route that accepts a `destination` field in a payout request body is a security defect, not a feature — reject it in code review on sight.

4. **No payout code path may be reached by a `supervisor`-scoped auth token.** This is enforced both by RBAC middleware and, redundantly, by a unit test that asserts the supervisor role's permission set does not include the payout-execution scope — a deliberately duplicated check, because this specific rule (ADR-003, separation of duties) is the single most important security property in the entire system, and one enforcement layer failing silently should never be the only thing standing between a supervisor and the treasury.

5. **Every money-affecting function has a corresponding test with at least one adversarial case** — a negative weight, a zero rate, a payout exceeding the hot float, a duplicate idempotency key — not just the happy path.

6. **No `console.log` of a full payout object, API key, or Lightning Address in any code path that could run in production.** Logging is structured and explicitly allow-lists which fields are safe to log; it does not default to logging everything and hoping no one greps the logs for a secret later.

---

## 10. Testing Conventions

- **Unit tests** (Vitest) for anything in `lib/` — pure functions, especially `computePayout`, reconciliation logic, and anomaly detection, target high coverage here specifically since this is the money-critical layer.
- **Integration tests** (Vitest + a test database) for API routes — verify idempotency, RBAC enforcement, and validation failure paths, not just success paths.
- **End-to-end tests** (Playwright) for the two flows that must never break silently: a full offline-to-sync weigh event, and a full payout from verified event to confirmed Lightning payment (against a testnet/regtest Lightning setup, never real funds).
- **Test naming**: `describe` blocks name the unit under test; `it` blocks state the expected behavior in plain language — `it('rejects a payout destination supplied by the client')`, not `it('test 3')`.

---

## 11. Commit and PR Conventions

- **Conventional Commits**, enforced by a commit-msg hook: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`. A scope is encouraged where it adds clarity: `fix(payouts): reject client-supplied destination`.
- **PRs touching `lib/money.ts`, `lib/lightning/`, or anything in the payout path require two reviewers, not one** — a project-level branch protection rule, not just a convention people are trusted to remember.
- **PR descriptions state what changed and why**, not just what changed — a diff already shows what changed.

---

## 12. Comments and Documentation

- **Comment the why, not the what.** `// subtract 1 because the API is 1-indexed` is useful; `// increment i` is noise.
- **Every exported function in `lib/` has a docstring** stating its contract — what it assumes about its inputs, and what it guarantees about its output — since these functions are called from multiple places and their contracts need to be legible without reading the implementation.
- **A `SECURITY.md` note is required alongside any change to Section 9's enforcement code**, briefly stating what property the change preserves or alters — this is a small, cheap habit that makes a future security review dramatically faster.

---

## 13. What This Guide Deliberately Does Not Cover

License choice, contribution workflow for external contributors, issue templates, and release/versioning strategy belong in the companion **CONTRIBUTING Guide**, not here — this document is about how code is written, not about how the project is governed as an open-source effort. The governance side lives in `CONTRIBUTING.md`.

---

*This document is a companion to the Taka Sats PRD, User Stories, Brand Guidelines, and Technical Architecture. Section 9 is the most important section in this document — if a reviewer has time to check only one thing on a pull request touching payment code, it should be that.*
