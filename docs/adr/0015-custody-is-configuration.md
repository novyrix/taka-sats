# ADR-0015: Custody/payout model is configuration, not a fork

**Status:** Accepted (records D-22; see ADR-0007, ADR-0003)

## Context

One licensed custodial operator and one unlicensed non-custodial operator should run the
**same** code with no diff - only settings.

## Decision

`settings.toml` selects the operating-float provider (`blink` | `lnbits` | `fedimint`) and
whether program-provisioned collector wallets are enabled. The payout code path is identical
across every combination: the destination is always resolved server-side from the tag mapping
(§12.3); only provisioning and the `LightningProvider` implementation differ. Proven by running
the payout e2e (M5-10) with the provider swapped.

## Consequences

No custody "edition" of the codebase. Any payout-path change must hold for all provider values.
Config, not branching, carries the operator's regulatory posture.

## Related

REQUIREMENTS D-22, §12; ADR-0003, ADR-0007.
