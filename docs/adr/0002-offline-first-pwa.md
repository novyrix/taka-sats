# ADR-0002: Offline-first PWA, not a native mobile app

**Status:** Accepted (ported from Technical Architecture §9 ADR-002)

## Context

Supervisors use low-cost Android devices in areas with poor connectivity. App-store
distribution adds review lag, update friction, and install-size sensitivity. Afribit's stack
is React/Next.js.

## Decision

Build the supervisor app as an installable, offline-capable PWA. Core actions write to
IndexedDB first and never block on the network; a Service Worker caches the app shell;
Background Sync drains the outbox.

## Consequences

One codebase, no app-store dependency, install via link or QR. Trade-off: Web NFC support
varies by browser/OS — verified against real devices (gate G2), with manual search + BYO QR
scan as first-class fallbacks. iOS is not an NFC target but the PWA still loads there for
admin use.

## Related

REQUIREMENTS §14 (NFR 7.2); ROADMAP M3; gate G2.
