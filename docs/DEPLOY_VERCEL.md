# Deploying Taka Sats to Vercel

The Vercel path runs the same Next.js project as Docker Compose. Neon supplies PostgreSQL and Cloudflare R2 supplies object storage when those features land.

## Link and deploy

```powershell
vercel link --project taka-sats --scope novyrix-teams
vercel deploy --prod --scope novyrix-teams
```

The canonical production URL is `https://taka-sats.vercel.app`.

## Git deployments

Install the Vercel GitHub App for the `novyrix/taka-sats` repository, then connect it:

```powershell
vercel git connect https://github.com/novyrix/taka-sats --scope novyrix-teams
```

`main` is the production branch. Pull requests receive preview deployments after the Git integration is connected.

## Environment variables

Configure values in the Vercel project rather than committing them:

| Name | Purpose | Availability |
|---|---|---|
| `CRON_SECRET` | Authenticates Vercel Cron requests | configured in production |
| `DATABASE_URL` | Neon pooled PostgreSQL connection | required — `lib/db/`, M1's collectors tables |
| `AUTH_SECRET` | Auth.js JWT signing secret (`openssl rand -base64 32`) | required — supervisor login (M2-1) |
| `BLINK_API_KEY` / `LNBITS_ADMIN_KEY` | Lightning provider secret matching `lightning.float_provider` | required once M5 executes payouts |
| `LEDGER_SIGNING_KEY` | Base64 Ed25519 seed that signs ledger checkpoints (`openssl rand -base64 32`) | secret — required for the checkpoint job (M4-7), see `docs/LEDGER.md` |
| `S3_ENDPOINT` | Cloudflare R2 S3 endpoint | required when object uploads land |
| `S3_BUCKET` | R2 bucket name | required when object uploads land |
| `S3_REGION` | R2 region (`auto`) | required when object uploads land |
| `S3_ACCESS_KEY_ID` | R2 access key | secret |
| `S3_SECRET_ACCESS_KEY` | R2 secret key | secret |

Apply secrets through the Vercel dashboard or `vercel env add`; never put their values in `vercel.json` or source control.

## Cron bridge

`vercel.json` calls `GET /api/v1/internal/jobs/enqueue` daily, which is compatible with the current Vercel plan. Vercel supplies `Authorization: Bearer <CRON_SECRET>`. The M0 route authenticates the request and returns an accepted status; M4 will connect it to pg-boss and set the production cadence appropriate to the selected plan.

## Verify

```powershell
vercel inspect taka-sats --scope novyrix-teams
vercel curl https://taka-sats.vercel.app --scope novyrix-teams
```

Confirm that the response is HTTP 200 and contains the Taka Sats implementation page. An unauthenticated request to the internal enqueue route must return HTTP 401.
