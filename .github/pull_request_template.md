<!--
  Conventional Commits title (feat:, fix:, docs:, …). PRs touching lib/money.ts,
  lib/lightning/, or the payout path need two reviewers (Code Style Guide §11).
-->

## What changed and why

<!-- The diff shows what. Explain the why, and the user story / FR / ROADMAP issue it maps to. -->

## Checklist

- [ ] Prettier + ESLint clean; `strict` TypeScript, no `any`; tests pass (`pnpm test`).
- [ ] Money/auth changes have adversarial tests (Code Style Guide §9.5).
- [ ] User-facing strings are i18n keys; operational values are `config/` keys, not literals (D-21).
- [ ] Migrations have a working `down` (`db/<tag>.down.sql`); no destructive prod migration without a reviewed backup step.
- [ ] Relevant `docs/` page updated in this PR; `SECURITY.md` note added if enforcement code changed.
- [ ] Every commit is a Conventional Commit and carries `Signed-off-by` (DCO — `git commit -s`).
- [ ] Any follow-up work you are deferring is written down in the PR description or an issue.
- [ ] New UI dependency/pattern recorded in `docs/DESIGN.md §7`/`§16`.
