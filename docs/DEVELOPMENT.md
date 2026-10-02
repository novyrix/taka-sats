# Development

How to run Taka Sats on your own computer and check your changes. For contributing rules
(commits, reviews, licensing) see [`CONTRIBUTING.md`](../CONTRIBUTING.md).

## Requirements

Node 24, [pnpm](https://pnpm.io) 11, Git, and Docker if you want a local database.

## Run it

You need a Postgres database. The quickest way is a throwaway one in Docker:

```bash
docker run -d --name takasats-dev-pg -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=taka_sats   -p 55432:5432 postgres:17-alpine
```

Then, from a clean clone:

```bash
pnpm install
cp .env.example .env.local        # Next.js loads this file for `pnpm dev`
```

Edit `.env.local` and set these two lines (the `DATABASE_URL` in `.env.example` uses the host name
`postgres`, which only works inside Docker Compose):

```bash
DATABASE_URL=postgresql://postgres:dev@localhost:55432/taka_sats
AUTH_SECRET=any-long-random-string-for-local-use-only
```

The scripts below read `DATABASE_URL` from your shell, not from `.env.local`, so export it too
(PowerShell: `$env:DATABASE_URL = "postgresql://postgres:dev@localhost:55432/taka_sats"`):

```bash
export DATABASE_URL=postgresql://postgres:dev@localhost:55432/taka_sats
pnpm db:migrate                  # create the tables
pnpm db:seed                     # seed material rates
pnpm db:seed-team --out ./team-credentials.txt   # test staff accounts, passwords go to that file
pnpm dev                         # http://localhost:3000
```

The script refuses an `--out` file inside the repository unless git ignores it. A file named
`team-credentials*.txt` in the repository root is ignored; any other path should be outside the
repository. Sign in at `/login` with a staff code from that file (for example
`TESTADM01`). By default payouts use the demo rail, so no real money can move.

Photo upload needs an S3 compatible store. Without one the weigh flow still records, but the photo
upload waits. To run MinIO locally: `docker compose up -d minio` starts one on port 9000 with the
keys from `.env.example` (set the `S3_*` variables in `.env.local` to match). Everything else, the
console, the ledger, payouts on the demo rail, works without it.

The full Compose stack (app, worker, Postgres, storage) is described in
[`SELF_HOSTING.md`](SELF_HOSTING.md). The payout worker is a separate process: `pnpm worker`.
Without it payouts stay at "waiting for a rate".

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
