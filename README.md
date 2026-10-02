# Taka Sats

**Verified recycling work, paid in Bitcoin.**

Open source software that lets a recycling programme weigh what collectors bring in, check it,
and pay them over Bitcoin Lightning. Every collection and every payment goes into a record that
anyone can verify.

[![Licence: AGPL-3.0](https://img.shields.io/badge/licence-AGPL--3.0-blue.svg)](LICENSE)
[![Status: pilot ready, demo mode](<https://img.shields.io/badge/status-pilot%20ready%20(demo%20mode)-orange.svg>)](#status)

[About](https://taka.afribit.africa/about) ·
[Run it for your community](docs/GETTING_STARTED.md) ·
[How it stays honest](docs/VERIFICATION.md) ·
[Source](https://github.com/novyrix/taka-sats)

## What is Taka Sats?

Taka Sats (Swahili for "waste sats") is the software behind a waste to Bitcoin programme. It was
built for [Afribit Africa](https://afribit.africa) and is designed so that any recycling or
circular economy programme can run its own copy.

A supervisor identifies a collector, weighs the material and takes a photo of the scale, all on a
phone that works without internet. When the phone reconnects, the record is checked and sealed.
A second person approves the payment, and the collector receives sats in a wallet they control.

## The problem

Collecting recyclables is real work, but it is rarely recorded properly. Weights are written on
paper or remembered. Payment comes late, in cash, or is disputed. Collectors have no proof of what
they delivered. The people who fund a programme have no proof that it happened.

Taka Sats gives each side something to check: the collector gets paid for a recorded weight, the
programme gets a record that cannot be quietly changed, and a funder can verify the numbers
without trusting anyone's word.

## How it works

1. **Identify.** Staff find the collector by name, code or QR. Every collector is approved by a
   staff member before they can be paid.
2. **Weigh and photograph.** The weight comes from a scale. A photo shows the material, the scale
   and its display. The phone saves everything locally, even with no signal.
3. **Check and seal.** On reconnecting, each record is sealed so edits are visible. The system
   checks the rate, the session and the supervisor, and flags anything unusual.
4. **Pay.** A second person approves the payment. The system calculates the amount once, on the
   server, and sends it to the collector's own verified wallet.

## Built on open tools

- **Bitcoin and Lightning.** A collector needs no bank account, no ID document and no special
  app. Payments arrive in seconds and cost very little.
- **Collectors keep their own keys.** By default the programme never holds money that belongs to a
  collector. A QR code or NFC tag is only a pointer to an identity. It cannot spend or receive
  anything.
- **Any wallet provider.** The hot wallet that pays collectors, and the multisig pool that funds
  it, are both pluggable. [`docs/providers/`](docs/providers/README.md) states what a provider
  must offer, and [`docs/TREASURY.md`](docs/TREASURY.md) explains how funds are held and approved.
- **Open source, self hostable.** The code is free to read, copy and run under the AGPL licence.
  Every setting lives in a configuration file, so a programme in another city changes a file, not
  the code.
- **Private by design.** No ID numbers are collected. Partners and funders see totals, not people.
- **A record anyone can verify.** Important facts go into an append only ledger with signed
  checkpoints. A free script lets anyone check that nothing was altered.

## Run it for your community

You need a small Linux server with Docker, a domain name, and a few staff. The short version:

```bash
git clone https://github.com/novyrix/taka-sats.git && cd taka-sats
cp .env.example .env            # set your secrets and domain
# create config/settings.toml with your programme's name, currency and timezone
docker compose -f docker/docker-compose.yml -f docker/docker-compose.https.yml --env-file .env up -d --build
```

The full walkthrough, from secrets to your first collector and your first payout, is
[`docs/GETTING_STARTED.md`](docs/GETTING_STARTED.md). To try it on your own computer or work on the
code, see [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).

## How it stays honest

Seven layers, from approving collectors to comparing our totals with what the recycler actually
received. No single layer is trusted alone, and the protocol states plainly what it cannot prove.
Read it in full in [`docs/VERIFICATION.md`](docs/VERIFICATION.md).

## Status

Taka Sats is **ready for a supervised pilot**. It runs in **demo mode** by default: payments are
simulated and no real money moves.

|                        |                                                                                                                                                                                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Working and tested** | Collector approval, offline capture, sync, the ledger and its public verifier, payments with second person approval, the treasury funding vote (a recorded vote that refills the hot wallet), reconciliation against recycler sales, anomaly flags, public totals               |
| **Not yet verified**   | Real Lightning payments through Blink or LNbits, and a real Blink balance read. The code is checked against Blink's published schema and a tool (`pnpm provider:check`) exists for the first supervised test with a tiny amount, but it has not been run against a live account |
| **Not built**          | Connected scales, automatic reading of the scale display, a read only view of the pool's own balance, offline enrolment of new collectors, Swahili and Sheng translations (placeholders today)                                                                                  |

## Get involved

- **Ask a question or report a bug.** Open an [issue](https://github.com/novyrix/taka-sats/issues).
- **Contribute.** Read [`CONTRIBUTING.md`](CONTRIBUTING.md). We use Conventional Commits and the
  Developer Certificate of Origin, and we welcome translations into Swahili and Sheng.
- **Report a security problem.** Follow [`SECURITY.md`](SECURITY.md). Please do not open a public
  issue for vulnerabilities.
- **Community standards.** See [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

## Documentation

| Understand                                    | Operate                                              | Build                                             |
| --------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------- |
| [Verification protocol](docs/VERIFICATION.md) | [Run it for your community](docs/GETTING_STARTED.md) | [Development](docs/DEVELOPMENT.md)                |
| [The ledger](docs/LEDGER.md)                  | [Pilot runbook](docs/PILOT.md)                       | [Backend contract](docs/BACKEND.md)               |
| [Threat model](docs/THREAT_MODEL.md)          | [Self hosting](docs/SELF_HOSTING.md)                 | [Requirements](docs/REQUIREMENTS.md)              |
| [Treasury](docs/TREASURY.md)                  | [Configuration](docs/CONFIGURATION.md)               | [Design system](docs/DESIGN.md)                   |
| [Decisions](docs/adr/README.md)               | [Hardware](docs/HARDWARE.md)                         | [Provider requirements](docs/providers/README.md) |
|                                               |                                                      | [Continuous integration](docs/CI.md)              |

## Licence

[AGPL-3.0-only](LICENSE). Every source file carries an SPDX header. Contributions are accepted
under the [Developer Certificate of Origin](https://developercertificate.org/), with no
contributor licence agreement.
