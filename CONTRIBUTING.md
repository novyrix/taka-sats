# Contributing to Taka Sats

Thanks for helping build an open, offline-first waste-to-Bitcoin system. This document
covers how the project is run. How code is _written_ is [`Initial assets/Taka_Sats_Code_Style_Guide.md`](Initial%20assets/Taka_Sats_Code_Style_Guide.md);
how the UI is built is [`docs/DESIGN.md`](docs/DESIGN.md) (canonical — compose from its §6
inventory, don't hand-roll); what to build and in what order is [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Before you start

1. Read [`AGENTS.md`](AGENTS.md) — it holds the live build state and the task ledger.
   Human or agent, it is the resume point.
2. Find your milestone/issue in [`docs/ROADMAP.md`](docs/ROADMAP.md); read its dependencies
   and exit criteria, and the [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) sections it maps to.
3. Do not start a milestone whose ROADMAP dependencies are unmet.

## Development setup

Node 24, [pnpm](https://pnpm.io) 11, Git.

```bash
pnpm install                 # runs `husky` via the prepare script
cp config/settings.default.toml config/settings.toml   # optional overrides
pnpm dev
```

Before pushing, the same gate CI runs:

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

The `pre-commit` hook runs format/lint/typecheck; the `commit-msg` hook runs commitlint.

## Branches and PRs

- Branch off `main`: `feat/m2-rate-table`, `fix/sync-idempotency`.
- One PR = one ROADMAP issue or one focused change. Don't "also fix" unrelated things —
  log them in `AGENTS.md §10` instead.
- Keep PRs reviewable. Rebase on `main`; don't merge `main` into your branch.
- The PR template checklist is not decorative — every box must be true, including
  **"`AGENTS.md` updated in this PR"**.

### Two-reviewer paths

A PR that touches `lib/money.ts`, `lib/lightning/`, or any part of the payout path
**requires two reviewers** (Code Style Guide §11). This is a branch-protection rule.

## Commits: Conventional + signed off

- **Conventional Commits**, enforced: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`,
  `chore:`, `build:`, `ci:`, `perf:`, `revert:`. A scope helps: `fix(payouts): …`.
- **Every commit needs a `Signed-off-by` trailer** (Developer Certificate of Origin,
  <https://developercertificate.org/>). Use `git commit -s`. There is no CLA. CI rejects a
  PR with an unsigned commit.

By signing off you certify you wrote the change or have the right to submit it under the
project licence.

## Licence and headers

The project is [AGPL-3.0-only](LICENSE). Every source file starts with:

```
// SPDX-License-Identifier: AGPL-3.0-only
```

CI fails a source file without it.

## Tests

- Unit tests (Vitest) for everything in `lib/`; money and fraud logic target near-total
  coverage.
- Money- or auth-affecting functions carry at least one adversarial case — negative
  weight, zero rate, over-float, duplicate idempotency key (Code Style Guide §9.5).
- Integration tests for every API route include the failure and RBAC-denied paths.

## Security-sensitive changes

Any change to money-handling or RBAC-enforcement code carries a one-line note in
[`SECURITY.md`](SECURITY.md) stating which property it preserves or alters. To report a
vulnerability, see [`SECURITY.md`](SECURITY.md) — not a public issue.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).
