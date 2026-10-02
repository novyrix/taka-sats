# ADR-0009: Single Next.js App Router project, monorepo-ready

**Status:** Accepted (records D-04)

## Context

A one-lead team needs the simplest thing that still keeps the money-critical logic portable
and independently testable.

## Decision

One Next.js App Router project. `lib/` subpackages (`money`, `sync`, `fraud`, `lightning`,
`ledger`, `db`, `config`, `auth`, `i18n`) contain **zero framework imports** so they lift into
`packages/*` later without a rewrite. Route handlers validate input, call a `lib/` function,
and shape the response - no business logic in handlers.

## Consequences

Fast to build now; a later monorepo split is mechanical. The "no framework imports in `lib/`"
rule is enforced by review and is why, e.g., `lib/config` reads the filesystem directly rather
than importing a Next helper.

## Related

REQUIREMENTS D-04; Code Style Guide §3; every `lib/` module.
