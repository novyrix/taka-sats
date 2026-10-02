# ADR-0012: Dual deployment - Docker Compose and Vercel, equal priority

**Status:** Accepted (records D-03)

## Context

"Standalone, not locked to a system" applies to hosting too. A self-hoster and a
managed-platform user should both be first-class.

## Decision

Maintain and CI-test two deploy paths: a `docker compose` stack (app + Postgres + worker +
MinIO + Nostr relay; LNbits added only via the custodial overlay) and a Vercel + Neon +
Cloudflare R2 path. The same Next.js code runs on both. On Vercel, Vercel Cron calls an
authenticated internal route that enqueues the same pg-boss jobs the worker runs elsewhere.

## Consequences

Two paths to keep green (CI builds the Docker image and the Vercel-style build). No infra that
only works on one - no Redis, no k8s. `output: 'standalone'` is set off-Vercel only.

## Related

REQUIREMENTS D-03, §14 (NFR 7.8); `docker/`, `vercel.json`, `docs/SELF_HOSTING.md`,
`docs/DEPLOY_VERCEL.md`.
