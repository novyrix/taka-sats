# ADR-0010: Rate table stores fiat-per-kg, not sats-per-kg

**Status:** Accepted (records D-14)

## Context

Technical Architecture v1.0 had `rate_sats_per_kg BIGINT`. US-7.3 requires the collector to be
paid a stable *fiat-equivalent* value for their work; a sats-denominated rate would swing with
the exchange rate between rate-setting and payout.

## Decision

`material_rates` stores `rate_fiat_minor_per_kg` (e.g. KES cents per kg). Sats are computed
**only** at disbursement, by `lib/money.ts:computePayout`, from a BTC exchange-rate snapshot
(`exchange_rate_snapshots`) that must be newer than `money.rate_staleness_ttl_seconds`.

## Consequences

The collector's quoted value is stable in the currency they buy food in. Adds a dependency on
a fresh, multi-source exchange feed with a staleness guard (ADR references D-18). `[rates].seed`
in config seeds the first migration only; later versions are DB rows.

## Related

REQUIREMENTS D-14/D-18, §13.2 `[rates]`/`[money]`.
