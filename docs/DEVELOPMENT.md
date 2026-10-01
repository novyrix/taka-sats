# Development

How to run Taka Sats on your own computer and check your changes. For contributing rules
(commits, reviews, licensing) see [`CONTRIBUTING.md`](../CONTRIBUTING.md). 

## Requirements

Node 24, [pnpm](https://pnpm.io) 11, Git, and Docker if you want a local database.

## Run it

```bash
pnpm install
cp config/settings.default.toml config/settings.toml   # optional: your overrides
pnpm dev                                                # http://localhost:3000
```

Most features need a database and object storage. The easiest way to get both is the Docker
Compose stack, described in [`SELF_HOSTING.md`](SELF_HOSTING.md). Then:

```bash
pnpm db:migrate      # create the tables
pnpm db:seed         # seed material rates
pnpm db:seed-pilot -- --location "Test Hub"   # staff accounts, a session, a rate snapshot
```

## Check your changes

```bash
pnpm lint && pnpm typecheck && pnpm check:design && pnpm test && pnpm build
```

Tests that need Postgres run when `DATABASE_URL` is set and are skipped otherwise. Several test
files empty the tables they use, so point `DATABASE_URL` at a throwaway database, never at one
that holds real or demo data.

`pnpm pilot:smoke` walks the whole backend over real HTTP (register, approve, weigh, sync, pay)
and is the quickest way to confirm a deployment works. See [`PILOT.md`](PILOT.md).

## Deploying

Both deploy paths run the same code.

- **Docker Compose**, self hosted: [`SELF_HOSTING.md`](SELF_HOSTING.md)
- **Vercel, Neon and Cloudflare R2**: [`DEPLOY_VERCEL.md`](DEPLOY_VERCEL.md). The background
  worker needs a host that can run a long process, which Vercel does not provide.

## Configuration

Nothing operational is hardcoded. `config/settings.default.toml` holds every tunable with a
documented default. Override it with a git-ignored `config/settings.toml` or with
`TAKASATS__SECTION__KEY` environment variables. Secrets stay in the environment and never in
the TOML file. The merged result is validated at start up, and an invalid value stops the
process. See [`CONFIGURATION.md`](CONFIGURATION.md).

## Where things are

| You want to | Read |
|---|---|
| Understand the product requirements | [`REQUIREMENTS.md`](REQUIREMENTS.md) |
| Build against the API | [`BACKEND.md`](BACKEND.md) |
| Follow the design system | [`DESIGN.md`](DESIGN.md) |
| Understand a past decision | [`adr/`](adr/README.md) |
