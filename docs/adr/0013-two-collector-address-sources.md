# ADR-0013: Two collector address sources, operator-selectable per collector

**Status:** Accepted (records D-05; see ADR-0007 for the custody framing)

## Context

Some operators can custody funds (and want bulk-provisioned wallets); some cannot and must
stay non-custodial. The collector-facing experience should be the same either way.

## Decision

- **Bring-your-own (default):** the collector submits their own Lightning Address or Blink
  POS/Paycode QR at enrolment. It is scanned, validated as receive-capable and resolvable
  (an `LNURLw` is rejected), stored on the collector row, and written to the tag. The operator
  never holds a balance designated to that collector.
- **Program-provisioned (opt-in, gate G1):** a self-hosted LNbits instance mints one wallet +
  LNURLp per collector on sync, with retry/backoff.

Both resolve to a Lightning-address string at payout time; `address_source` is a column.

## Consequences

Blink's one-account-one-address limit only bites for bulk minting — exactly what the LNbits
mode exists for. BYO is the default and the G2 mitigation, so its scan + manual-fallback paths
must be genuinely usable, not stubs.

## Related

REQUIREMENTS §7.1, D-05; ADR-0001, ADR-0007; ROADMAP M1-5, M1-6, M1-7.
