# Taka Sats

**Waste-to-Bitcoin, earn-first — an open, offline-first collection and payout system.**
Built for Afribit Africa; self-hostable by any programme.

Taka Sats turns verified recycling work into traceable Lightning payouts. A supervisor
records a collection event offline — tap the collector's NFC tag, pick the material,
enter the weight, take a photo — and the event syncs later into a single hash-chained
ledger. Once verified, the collector is paid in sats at the disbursement-time rate, to
a receive-only address they control. Every verified collection can be publicly attested;
the aggregate dataset is open.

**Earn-first principle:** the collector never installs an app, never logs in, and never
holds a spend credential. The tag is receive-only. The programme holds no balance
designated to a collector in the default (non-custodial) configuration.

## Status

Phase: **Implementation — M0 (foundation & OSS scaffold)**. No domain features yet.
See [`AGENTS.md`](AGENTS.md) for the live build state and [`docs/ROADMAP.md`](docs/ROADMAP.md)
for the milestone plan.

## Quickstart

Requires Node 24, [pnpm](https://pnpm.io) 11, and Git.

```bash
pnpm install
cp config/settings.default.toml config/settings.toml   # optional: your overrides
pnpm dev                                                # http://localhost:3000
```

Checks:

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

### Deploy path A — Docker Compose (self-hosted)

Brings up the app, Postgres, MinIO (R2-compatible), a worker, and a Nostr relay.

```bash
cp .env.example .env      # change every password before exposing the stack
docker compose up --build --wait
```

Full guide: [`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md).

### Deploy path B — Vercel + Neon + Cloudflare R2

Both deploy paths run the same code and are CI-tested (D-03).
Full guide: [`docs/DEPLOY_VERCEL.md`](docs/DEPLOY_VERCEL.md).

## Configuration

Nothing operational is hardcoded (D-21). `config/settings.default.toml` holds every
tunable with a documented default; override it with a git-ignored `config/settings.toml`
or `TAKASATS__SECTION__KEY` environment variables. Secrets stay in the environment,
never in TOML. The merged config is Zod-validated at boot — an invalid value stops the
process. Walk-through: [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md).

## Documentation

| Doc                                                                                               | What it is                                                            |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| [`AGENTS.md`](AGENTS.md)                                                                          | Live build state, task ledger, and working protocol — **read first**  |
| [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md)                                                    | Canonical v1 requirements, decisions, data model, API, ledger, config |
| [`docs/ROADMAP.md`](docs/ROADMAP.md)                                                              | Milestones M0–M8, dependencies, phase gates                           |
| [`docs/DESIGN.md`](docs/DESIGN.md)                                                                | Design system: tokens, components, motion, accessibility              |
| [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md)                                                  | Annotated settings surface                                            |
| [`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md) · [`docs/DEPLOY_VERCEL.md`](docs/DEPLOY_VERCEL.md) | The two deploy paths                                                  |

## Licence

[AGPL-3.0-only](LICENSE). Every source file carries an SPDX header. Contributions are
accepted under the [Developer Certificate of Origin](https://developercertificate.org/) —
every commit needs a `Signed-off-by` trailer. There is no CLA. See [`NOTICE`](NOTICE).
