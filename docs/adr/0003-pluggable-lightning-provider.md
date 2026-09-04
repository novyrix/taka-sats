# ADR-0003: Pluggable `LightningProvider` + two-tier treasury

**Status:** Accepted, revised in Technical Architecture v1.1 (ports ADR-003)

## Context

v1.0 hard-wired Blink as the hot-float rail. Two things changed: (a) Afribit needs to
*provision* a wallet + address per collector in bulk, which Blink's one-account-one-address
model cannot do but a self-hosted LNbits can; (b) the project is open source and standalone,
so one hard-wired provider is wrong for other operators. Concentrating all funds in one
custodial account is a single point of failure to avoid.

## Decision

The payout rail is a `lib/lightning/LightningProvider` interface with four implementations —
`BlinkProvider` (shipped default float + BYO Paycode validation), `LNbitsProvider` (opt-in
per-collector provisioning + float), `FedimintProvider` (Fedi federation), `FakeLightningProvider`
(tests). The active one is chosen in `config/settings.toml` (`lightning.float_provider`).
The bulk of funds stays in a self-custodied Trezor 2-of-3 cold reserve, topped up to a small
operating float with two sign-offs. `computePayout` and separation-of-duties enforcement are
identical across providers.

## Consequences

One codebase serves a licensed custodial operator and an unlicensed non-custodial one with no
code difference. An operator enabling LNbits takes on its operational burden and must complete
gate G1 first. The float is deliberately small (a few days of payouts).

## Related

REQUIREMENTS D-05/D-11/D-22/D-23; ADR-0007; ROADMAP M1-2, M5.
