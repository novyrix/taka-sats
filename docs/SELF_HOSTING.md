# Self-hosting Taka Sats

The Docker Compose path runs the same Next.js code used by Vercel with local Postgres, MinIO, a worker process, and a Nostr relay.

## Prerequisites

- Docker Desktop with the Linux engine running
- Docker Compose v2 or newer
- Git

## Start the default stack

```powershell
Copy-Item .env.example .env
# Replace the AUTH_SECRET and CRON_SECRET placeholders with real random values —
# the app will not boot with the committed placeholder text:
#   AUTH_SECRET generated with: openssl rand -base64 32
docker compose up --build --wait
docker compose ps
```

Open `http://localhost:3000`. MinIO's console is available at `http://localhost:9001`.

The committed defaults are for local development only. Change every password in `.env` before exposing the stack outside the host. `.env` is ignored by Git.

No supervisor account exists until you create one (there is no public sign-up, §3.1). The
`app`/`worker` images are pruned production builds with no dev tooling, so admin scripts run
via the profile-gated `tools` service instead (built from the `builder` stage):

```powershell
docker compose --env-file .env run --rm tools scripts/create-supervisor.ts `
  --name "Your Name" --phone "+254700000000" --role admin --password "<a strong password>"
```

## Services

| Service | Purpose | Host port |
|---|---|---|
| `app` | Next.js application | `3000` |
| `postgres` | PostgreSQL data store | internal only |
| `minio` | R2-compatible object storage | `9000`, `9001` |
| `worker` | Background-worker process scaffold | internal only |
| `relay` | Local Nostr relay | `8080` |
| `tools` | One-off admin scripts (profile-gated, not started by `up`) | — |

## Serve it on a real domain (HTTPS)

A public deployment needs HTTPS — browsers disable the service worker, camera, GPS and Web NFC on plain
`http`. The overlay `docker/docker-compose.https.yml` puts Caddy (automatic certificates) in front of the app,
stops publishing the app and MinIO to the internet, and mounts `./config` so `config/settings.toml` is read by
the app and the worker. Set `TAKASATS_DOMAIN` in `.env`, point the domain's DNS at the host, then:

```bash
docker compose -f docker/docker-compose.yml -f docker/docker-compose.https.yml --env-file .env up -d --build
```

The full pilot procedure (migrations, seeding staff and a demo session, the smoke test, a field day) is in
[`docs/PILOT.md`](PILOT.md).

## Private Garage object storage

Cloudflare R2 is a managed service, not software that can be installed on a Proxmox guest. For a
fully self-hosted S3-compatible photo store, use the Garage overlay. Generate the three Garage
secrets shown in `.env.example`, then include the overlay in every Compose command:

```bash
docker compose -f docker/docker-compose.yml -f docker/docker-compose.garage.yml \
  --env-file .env up -d --build --wait
```

Garage's S3 endpoint is private to the Compose network and optionally bound to loopback for
diagnostics. Its metadata and objects live in the `garage-meta` and `garage-data` volumes. A
single-node deployment has no storage redundancy: back up both volumes off-host before collecting
real participant data. Managed R2 remains an option when a pre-created bucket and scoped S3 access
key pair are available.

## Check and stop the stack

```powershell
docker compose ps
docker compose logs --follow app
docker compose down
```

Use `docker compose down --volumes` only when local Postgres, MinIO, relay, and regtest data may be deleted.

## Custodial development overlay

The optional overlay adds LNbits and a Bitcoin regtest node. It does not enable custody in application settings. G1 requires Afribit Africa's recorded legal-review outcome before the mode may hold real collector funds.

```powershell
docker compose --env-file .env -f docker/docker-compose.yml -f docker/docker-compose.custodial.yml up --build --wait
```

The M0 overlay uses LNbits `FakeWallet` while the regtest node is available for later Lightning backend integration. The reproducible end-to-end regtest path is required by M5, not by the default M0 path.

## Configuration

- Copy `.env.example` to `.env` for deployment-specific infrastructure values.
- Operational programme settings will live in `config/settings.toml`, layered over the committed defaults introduced by M0-18.
- The default application posture remains bring-your-own receive address with Blink; custodial provisioning stays disabled until G1 is complete.
