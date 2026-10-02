# ADR-0016: Three real `LightningProvider` implementations (+ a fake)

**Status:** Accepted (records D-23)

## Context

OQ-4 resolved: Afribit's Fedi federation already exists (fedi.xyz), so Fedimint is a real v1
rail, not a Phase-3 unknown. Blink is Afribit's established, Kibera-proven provider.

## Decision

`lib/lightning/LightningProvider` has three production implementations plus one for tests:

- `BlinkProvider` - default operating float; also resolves and validates a collector's Blink
  Paycode / Lightning Address for BYO enrolment.
- `LNbitsProvider` - custodial per-collector provisioning and float (opt-in, gate G1).
- `FedimintProvider` - pay via the Fedi federation.
- `FakeLightningProvider` - local dev and unit tests; never real funds. The Playwright payout
  e2e runs against a regtest backend.

Chosen from `settings.toml`. Each must pass one shared provider contract test suite.

## Consequences

Money-path code stays provider-agnostic and testable. Each new provider is a contract-test
target, not a special case in the payout worker.

## Related

REQUIREMENTS D-11/D-23; ADR-0003, ADR-0015.
