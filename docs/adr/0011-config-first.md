# ADR-0011: Config-first - nothing operational is hardcoded

**Status:** Accepted (records D-21)

## Context

The project must be publishable so another programme adopts it by editing a file, not forking
source. A magic number buried in domain code defeats that.

## Decision

A committed `config/settings.default.toml` holds every tunable with a documented default. An
operator overrides via a git-ignored `config/settings.toml` and/or `TAKASATS__SECTION__KEY`
environment variables. `lib/config/` merges the layers, validates the result with a Zod
schema, and exports a frozen typed object; **a missing or out-of-range value fails the boot**.
Secrets never live in TOML - DB URL, provider keys, `AUTH_SECRET`, Nostr key are environment
only. A literal operational value in `lib/` or a component is a review-blocking defect. A new
tunable touches `settings.default.toml` + the schema + `docs/CONFIGURATION.md` in one change.

## Consequences

Boot is strict and loud, which is the intent. Contributors must route every threshold, TTL,
and toggle through config. Runtime *data* (rate versions, sessions, keys) stays in the DB.

## Related

REQUIREMENTS §13, D-21; Code Style Guide §7A; `lib/config/`, `docs/CONFIGURATION.md`.
