# ADR-0007: Configurable custody; non-custodial is the shipped default

**Status:** Accepted, revised in Technical Architecture v1.1 (ports ADR-006; records D-05, D-22)

## Context

Kenya's VASP Act 2025 creates licensing obligations triggered by custodial activity (dual
CBK/CMA regime). Afribit may enable per-collector LNbits wallets only after a recorded legal
review; other operators may have no licence and must be able to run the system without ever
custodying funds.

## Decision

Ship both models, selected in `config/settings.toml`:

- **Non-custodial (default):** `custody.default_address_source = "byo"`,
  `provisioning_enabled = false`, `lightning.float_provider = "blink"`. The collector's own
  wallet receives; the operator holds no collector-designated balance.
- **Custodial (operator opt-in):** `provisioning_enabled = true` - which requires pasting the
  exact `PROVISIONING_ACKNOWLEDGEMENT` string, checked at boot - plus `float_provider = "lnbits"`.
  Per-collector LNbits wallets. Gated on **G1** (a recorded jurisdiction legal review) before
  real funds.

## Consequences

The collector-facing rail is Lightning-address resolution regardless of model. The
`provisioning_ack` mechanism makes accidental custody hard. The default build ships without
waiting on G1.

## Related

REQUIREMENTS §7.1, D-05/D-22, §1.3 (G1); ADR-0003; `lib/config/schema.ts`.
