# Run Taka Sats for your community

This guide is for a programme that wants to run its own copy: a recycling group, a cooperative,
a city project, a school. You do not need to write code. You need a small server, a domain name,
and a few people who will act as staff.

For the engineering side see [`DEVELOPMENT.md`](DEVELOPMENT.md).

## What you are setting up

| Piece | What it does |
|---|---|
| The web app | The supervisor phone app, the admin pages and the public summary |
| A database (Postgres) | Collectors, sessions, rates, payouts and the tamper evident ledger |
| A worker | Prices collections, pays collectors, fetches exchange rates, signs ledger checkpoints |
| Photo storage | Keeps the photo of each weigh in (MinIO or Garage, S3 compatible) |
| A Lightning wallet | The hot wallet that pays collectors. Any provider that meets [`providers/README.md`](providers/README.md) |

Collectors need no account with you. They bring a Lightning wallet they control. You only ever
send to it.

## What you need

- A Linux server with Docker and Docker Compose. 2 CPU cores and 4 GB of memory is enough for a
  pilot of a few dozen collectors.
- A domain name pointing at the server. HTTPS is required, because phones disable the offline
  mode, camera and location on plain `http`.
- Two or more Android phones with Chrome for supervisors, and a scale.
- A hot wallet with an API key. For a first trial you can use the built in demo rail, which pays
  nothing.
- At least two staff people, so that the person who records a weigh in is never the person who
  approves its payment.

## 1. Get the code and set your secrets

```bash
git clone https://github.com/novyrix/taka-sats.git
cd taka-sats
cp .env.example .env
```

Edit `.env`. Every password, `AUTH_SECRET`, `CRON_SECRET` and `LEDGER_SIGNING_KEY` must be a real
random value, and `TAKASATS_DOMAIN` must be your domain. Keep these in a password manager.
Losing `LEDGER_SIGNING_KEY` means you cannot extend the signed checkpoint chain.

```bash
openssl rand -base64 32
```

## 2. Describe your programme

Create `config/settings.toml`. It is git ignored and only needs the keys you change. The full list
is in [`CONFIGURATION.md`](CONFIGURATION.md). The ones most programmes set first:

```toml
[programme]
name            = "Your Programme"
timezone        = "Africa/Nairobi"
fiat_currency   = "KES"
locales         = ["en", "sw"]
default_locale  = "en"
public_base_url = "https://your-domain.example"

[collectors]
authorization_required = true   # only vetted collectors can be weighed or paid
default_site_code      = "HUB"  # public codes look like TS-HUB-0042

[payouts]
second_signoff_threshold_sats = 0   # 0 means every payout waits for a person to approve it

[lightning]
float_provider = "fake"         # a demo rail. Change to your provider when you are ready
```

Material prices live in the database, not in this file. You set and change them in the admin
pages, and every change keeps its history.

## 3. Start it

```bash
COMPOSE="docker compose -f docker/docker-compose.yml -f docker/docker-compose.https.yml --env-file .env"
$COMPOSE up -d --build
$COMPOSE run --rm tools scripts/migrate.ts
```

Open `https://your-domain.example/api/v1/health`. It should report that the database is up. The
first load can take half a minute while a certificate is issued.

More detail on the stack, object storage choices and HTTPS is in [`SELF_HOSTING.md`](SELF_HOSTING.md).

## 4. Create your first staff accounts

There is no public sign up. Staff accounts are created from the command line, and the password is
printed once.

```bash
$COMPOSE run --rm tools scripts/seed-pilot.ts \
  --location "Your Hub" --site HUB \
  --staff "Your Name|+254700000000|admin" \
  --staff "Hub Lead|+254700000001|hub_lead" \
  --staff "Supervisor One|+254700000002|supervisor"
```

This also opens a collection session at that location and stores a first exchange rate. Run it
again safely: it only creates what is missing.

| Role | Can do |
|---|---|
| `supervisor` | Weigh, photograph, register collectors in the field, sync |
| `hub_lead` | Everything a supervisor can, plus approve collectors and payouts |
| `admin` | Everything, plus rates, sessions, reconciliation and the ledger |

Nobody, in any role, can trigger a payment by hand. Payments are made by the worker after a
collection has been verified and, in the cautious default, approved by a second person.

## 5. Prove it works before anyone arrives

```bash
$COMPOSE run --rm tools scripts/pilot-smoke.ts --base https://your-domain.example \
  --admin-phone "<admin login>" --admin-password "<password>" \
  --supervisor-phone "<supervisor login>" --supervisor-password "<password>"
```

It signs in as both roles, registers a test collector, weighs, syncs and checks the ledger over
real HTTP. Add `--wallet <receive address>` to include a payout step. If it passes, the whole path works on your server. The longer runbook for a first field
day is [`PILOT.md`](PILOT.md).

## 6. Onboard people

1. **Supervisors** sign in on their phone while online, open **Weigh** once so it saves its
   offline copy, and install the app to the home screen.
2. **Collectors** are registered by a supervisor: an alias and the Receive side of their
   Lightning wallet (a Lightning address or LNURL). The record is pending until a hub lead or
   admin approves it. That is the gate working.
3. **Spend links are refused.** If a wallet card has a "Pay" QR code, do not scan it. Taka Sats
   rejects spend credentials and only ever accepts a receive address.

## 7. Move to real money carefully

1. Keep `fake` until you are comfortable with the flow.
2. Pick a hot wallet provider that meets the requirements in
   [`providers/README.md`](providers/README.md), put its API key in `.env`, and change
   `float_provider`. Set `TAKASATS_ALLOW_FAKE_PROVIDER` back to `false`.
3. Check the provider with the operator tool before any payout runs (see below).
4. Keep the hot wallet balance small, a few days of expected payouts. Fund it from a pool that
   several people must approve, as described in [`TREASURY.md`](TREASURY.md).
5. Make the first payment yourself: register your own wallet, weigh a tiny amount, approve it,
   and watch it arrive. Only then invite collectors.
6. Set up off host backups for Postgres and the photo storage before you collect real data, and
   rehearse a restore ([`SELF_HOSTING.md`](SELF_HOSTING.md), Backups).

### Checking your provider with `provider:check`

`pnpm provider:check` loads the provider you configured and tells you, line by line, what works.
Secrets are never printed. Run it from the same place that holds the API key (for the Compose
stack, `$COMPOSE run --rm tools scripts/provider-check.ts ...`).

```bash
# 1. Read only: credentials present, float balance readable
pnpm provider:check

# 2. Also prove a receive address works (a wallet you control)
pnpm provider:check --address you@wallet.example

# 3. Also send ONE tiny real payment, supervised
pnpm provider:check --pay-sats 1 --to you@wallet.example
```

If the Blink API key is set but the wallet id is not, it lists the account's wallets (BTC and USD) so you can copy
the BTC wallet id into `TAKASATS__LIGHTNING__BLINK__FLOAT_WALLET_ID`.

The payment step needs both `--pay-sats` (a whole number from 1 to 100) and `--to`, and it only
runs after you type `yes` at the prompt. For a non interactive run pass `--yes-i-am-sure`. The
tool refuses a destination that is not receive capable, and refuses when the float cannot cover
the amount.

It reports how the provider's answer was classified:

| Line | Meaning | Exit code |
|---|---|---|
| `PAID` | The provider confirmed it. The reference is the payment hash. | 0 |
| `FAILED` | The provider refused it and nothing was sent. | 1 |
| `UNKNOWN` | It may have gone out. **Do not send it again.** Look at the wallet history for the key and hash shown. | 3 |

After a payment it also asks the provider to look the payment up and compares the balance before
and after. Record the date and what you saw in the provider's page under
[`providers/`](providers/README.md) once you have run it against a real account. Use
`--env-file <path>` to load `KEY=value` lines first.

## Keeping it honest

How records are checked and what the system cannot prove is written down in
[`VERIFICATION.md`](VERIFICATION.md). The ledger can be verified by anyone with a free script,
described in [`LEDGER.md`](LEDGER.md).

## Getting help

Open an [issue](https://github.com/novyrix/taka-sats/issues). Please do not post keys, wallet
addresses or participant details. Security problems go through [`SECURITY.md`](../SECURITY.md).
