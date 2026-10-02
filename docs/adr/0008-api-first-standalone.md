# ADR-0008: API-first, standalone system

**Status:** Accepted (records D-01)

## Context

Taka Sats must be genuinely open and not locked to any one deployment. Afribit Console is one
consumer, not a host. Third parties must be able to self-host and integrate.

## Decision

Taka Sats is its own system exposing a documented, versioned HTTP API (`/api/v1`, OpenAPI
3.1, generated from the Zod schemas and CI-checked for drift). Every surface - the admin
dashboard included - is a client of that API. Breaking changes go to `/api/v2`.

## Consequences

Clear seam between core and consumers; the admin UI has no privileged backdoor. Cost: the API
contract and its docs are a first-class deliverable with their own CI gate (from M7).

## Related

REQUIREMENTS §10, D-01; Code Style Guide §7.
