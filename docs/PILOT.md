# Pilot runbook

How to stand up the Taka Sats pilot, prove it works before any collector arrives, run a field
day, and show it to someone. Written for the person doing it, not for a developer: every step is a
command or a thing to look at. Companion docs: `docs/SELF_HOSTING.md` (the stack),
`docs/CONFIGURATION.md` (every setting), `docs/BACKEND.md` (what the frontend builds against),
`docs/LEDGER.md` (how the tamper-evident record works).

> **The pilot proves one thing:** can verified recycling activity be turned into traceable Bitcoin
> earnings, offline-first, with a record nobody can quietly edit?
> `collect → identify → weigh → verify → calculate → pay → reconcile`.
> It is *not* a test of NFC hardware, AI, or custom cards — none of those are required.

---

## 1. Shape of the deployment

One small Linux server (2 vCPU / 4 GB is plenty for 10–20 collectors) running Docker Compose:

```
Internet ──443──► Caddy (automatic HTTPS) ──► app (Next.js)  ──► Postgres
                                              worker (pg-boss jobs: payouts, rates, checkpoints)
                                              MinIO (private photo storage)
```

Why Compose rather than Vercel for the pilot: the **worker** (payouts, exchange rates, ledger
checkpoints, wallet re-validation) is a long-running process and Vercel has none. Compose runs the
whole thing on one box you control. (The Vercel + Neon path in `docs/DEPLOY_VERCEL.md` also needs
a separate worker host — fine for later, extra moving parts now.)

**HTTPS is not optional.** Browsers disable the service worker (offline mode), camera, GPS and Web
NFC on plain `http`. That is what the Caddy overlay (`docker/docker-compose.https.yml`) is for.

## 2. Before you start

- [ ] **DNS:** an `A` record for `your-domain.example` → the server's public IP. (Caddy cannot get a
      certificate until this resolves.)
- [ ] **Server:** Docker + Compose v2.24 or newer; firewall allows **80, 443** (and 22 for you).
      Everything else stays closed — the overlay already binds MinIO and the relay to localhost.
- [ ] **Decide the payout rail** (see §6): `fake` (a demo — nothing is sent, clearly labelled) or
      `blink` (real sats from your Blink float).
- [ ] **A Paybee card** (or any wallet) for the test collector. You need its **Receive** side — a
      Lightning Address. Never scan the **Pay** side; the system will refuse it, but don't try.
- [ ] Two Android phones with Chrome, a digital scale, something to weigh.

Generate the secrets (keep them in a password manager — losing `LEDGER_SIGNING_KEY` means losing
the ability to extend the signed checkpoint chain):

```bash
openssl rand -base64 32     # AUTH_SECRET
openssl rand -base64 32     # CRON_SECRET
openssl rand -base64 32     # LEDGER_SIGNING_KEY  (a 32-byte Ed25519 seed)
openssl rand -base64 24     # POSTGRES_PASSWORD, MINIO_ROOT_PASSWORD
```

## 3. First deploy

```bash
git clone <repo> && cd taka-sats
cp .env.example .env        # then edit: every password, AUTH_SECRET, CRON_SECRET,
                            # LEDGER_SIGNING_KEY, TAKASATS_DOMAIN=your-domain.example,
                            # DATABASE_URL's password to match POSTGRES_PASSWORD
```

Create `config/settings.toml` with the pilot's settings (only the keys you change — see §5; the file is git-ignored), then:

```bash
COMPOSE="docker compose -f docker/docker-compose.yml -f docker/docker-compose.https.yml --env-file .env"
$COMPOSE up -d --build
$COMPOSE run --rm tools scripts/migrate.ts          # create the tables
$COMPOSE run --rm tools scripts/seed-pilot.ts \
  --location "Kibera Pilot" --site KBR \
  --collector "Test Card=<the card's Receive Lightning Address>" \
  --staff "Your Name|+2547XXXXXXXX|admin" \
  --staff "Hub Lead|+2547XXXXXXXX|hub_lead" \
  --staff "Supervisor One|+2547XXXXXXXX|supervisor" \
  --staff "Supervisor Two|+2547XXXXXXXX|supervisor"
```

`seed-pilot` is safe to re-run: it creates only what is missing and never touches an existing
account. **It prints each new account's password exactly once** — copy them now. It also stores a
fresh BTC/KES rate, opens a session at the location for 12 hours, and registers the collector
(authorized, wallet checked live and marked `verified`).

Open `https://your-domain.example` — the first load may take ~30 s while Caddy gets the
certificate. `https://your-domain.example/api/v1/health` should say `{"ok":true,"database":"up"}`.

## 4. Prove it before anyone arrives — the smoke test

```bash
$COMPOSE run --rm tools scripts/pilot-smoke.ts --base https://your-domain.example \
  --admin-phone +2547… --admin-password '…' --supervisor-phone +2547… --supervisor-password '…'
```

It signs in as both roles and walks the whole backend: register → authorize → weigh → upload a
photo → sync (twice, to prove idempotency) → check the ledger verifies → see the payout appear.
Every line is ✓ or ✗ with the reason. **Do not run a field day until this is all green.**

To include the treasury funding vote, add two more admin accounts
(`--admin2-phone … --admin2-password … --admin3-phone … --admin3-password …`; the first account must
be an `admin`). It proposes a 1 sat refill, checks that the proposer cannot approve it, has the two
others approve, records a transfer reference and checks that arrival is **not** accepted on anyone's
say so. It stops at `transferred` and moves no pool funds; that proposal stays in flight until a
steward resolves it, so it counts against the hot wallet cap headroom.

## 5. The pilot configuration

`config/settings.toml` — the pilot values (each is explained in `docs/CONFIGURATION.md`):

```toml
[collectors]
authorization_required = true     # only vetted collectors can be weighed or paid (D-25)
default_site_code      = "KBR"    # public codes read TS-KBR-0042

[payouts]
second_signoff_threshold_sats = 0     # 0 = EVERY payout waits for a hub_lead/admin to approve
require_approval_first_payout = true  # belt and braces: a wallet's first payout always waits
# float_low_balance_alert_sats / sweep_cron / max_attempts: defaults are fine

[ledger]
checkpoint_interval_entries = 1   # sign a checkpoint after every new entry (pilot volume is tiny)

[lightning]
float_provider = "blink"          # or "fake" for a no-money demo (see §6)
```

With `second_signoff_threshold_sats = 0` the pilot runs in **"queued, not instant"** mode: the
system verifies and prices every collection, then a person presses *approve*. That is deliberate
for the first weeks — it makes fraud review, rate testing and recovery from mistakes easy. Raise the
threshold (e.g. `50000`) once you trust the flow.

## 6. Money safety

- **Fake vs real.** `float_provider = "fake"` marks payouts *paid* without sending anything; the app
  shows `demo: true` at `GET /api/v1/meta` so the UI can banner it, and **refuses to start the fake
  rail in production** unless `TAKASATS_ALLOW_FAKE_PROVIDER=true` is set — a safety net so a
  misconfiguration can never claim payments that never happened. Use it for rehearsals and the
  showcase; switch to `blink` for the real thing.
- **Float.** Keep the Blink float small — a few days of expected payouts. The admin can see it at
  `GET /api/v1/treasury/float`; the system flags it when it drops below `float_low_balance_alert_sats`.
- **First real payment.** Run `pnpm provider:check` first (see `GETTING_STARTED.md`): it proves the key, the
  BTC wallet and a receive address, and can send ONE supervised 1 sat payment with a typed `yes`. Then, before any collector: register your own Paybee card as a collector, weigh a
  small amount (50 g of PET ≈ 9 sats at today's rate), approve it, and watch the sats land in the
  card. Only then invite real collectors.
- **Who can pay?** Nobody. There is no "execute payout" button or endpoint for any role — the worker
  pays, only after verification and (in pilot mode) a human approval, and never the person who
  recorded the weigh-in (a supervisor cannot approve their own collection).
- **Kill switch.** `docker compose … stop worker` stops all payouts immediately (queued work waits
  safely in Postgres and resumes when the worker returns). To also stop new weigh-ins, close the
  session (`PATCH /api/v1/sessions/:id {"status":"closed"}`).
- **A payout stuck in `sending`** for longer than `payouts.sending_stale_minutes` is **never retried
  automatically** — the payment may have gone out. It raises a `payout_uncertain` flag for an admin to
  check against the wallet. This is rare and by design.
  **To resolve it** (admin, and not the person who recorded the weigh or approved the payout):
  1. `GET /api/v1/payouts/:id/check` asks the provider what it recorded. `paid` with
     `proofVerified: true` is conclusive; `pending` means wait; `not_found` is **not** proof that
     nothing was sent, so also look in the wallet's own transaction list (the payout id is the memo).
  2. `POST /api/v1/payouts/:id/resolve` with `{"outcome":"paid","reference":"<payment hash>"}` if the
     money left, or `{"outcome":"failed"}` if you are sure it did not, plus a `note`. The provider's
     own answer can veto a decision that contradicts it. A `failed` payout is not re-queued: use
     **Retry** as a separate step once you are certain.

## 7. A field day

**The night before:** open the PWA on each supervisor phone *while online*, sign in, go to **Weigh** so
it primes its offline cache (collectors, rates, exchange rate). Install it to the home screen. Allow
camera and location. Check the session is active.

**On the day:** weigh as normal — the app works with no signal and syncs when it can. The supervisor's
"Session" tab shows what is queued / confirmed / needs attention.

**Registering someone new at the site:** a supervisor registers them (alias + scan the Receive QR of
their wallet card). They are **pending** — they cannot be weighed until a `hub_lead` or `admin`
authorizes them (the pending queue). That is the gate working, not a fault.

**End of day:** each supervisor syncs and checks nothing is left queued; an admin approves the day's
payouts, then records what the recycler accepted (when reconciliation lands — see `docs/BACKEND.md` §9).

## 8. The showcase (≈15 minutes)

Run it on two phones and a laptop, with the demo rail or a tiny real payout. Narrate the *why*:

1. **Register** (supervisor phone): "Akinyi" with her wallet card's Receive QR. Note the code
   `TS-KBR-0042` and "waiting for authorization". *Why: no ghost collectors — a person vets each one.*
2. **Authorize** (laptop, admin): see her in the pending queue with her wallet; approve. *The decision
   is a ledger entry — who authorized whom is provable.*
3. **Go offline** (airplane mode). Find her by name or by `0042`; pick PET; weigh 4.8 kg; photograph the
   scale; confirm. "Recorded offline." Close and reopen the app — it is still there.
4. **Reconnect.** Watch queued → syncing → confirmed. *Idempotent: a retry can never double-count.*
5. **Verify the record** (laptop): the ledger page / `GET /api/v1/ledger/verify` → `ok`. Change nothing
   and run `scripts/verify-ledger.ts` — "a funder can check this without trusting us".
6. **Payout** (laptop, admin): the payout appears priced at *that day's* BTC/KES rate from three
   independent sources; approve it; watch it go `sending → paid`. Open the card holder's wallet: sats
   arrived. *The amount was computed once, on the server, in integer sats; no one chose where it went.*
7. **Try to cheat** (optional, powerful): scan the card's **Pay** QR at enrolment — it is refused
   with a clear message. Try to register a second collector with the same wallet — refused. Try to
   approve your own weigh-in as the supervisor — refused.

## 9. Backups and monitoring

- **Database and photos:** `pnpm backup:pg` and `pnpm backup:objects`, and **prove** the newest one with
  `pnpm backup:check`. Copy both off the server (the ledger is append-only, but a disk failure is still a
  disk failure). The full procedure and a restore rehearsal are in `docs/SELF_HOSTING.md` (Backups).
- **Ledger:** nightly `scripts/verify-ledger.ts --export ledger-$(date +%F).json` — a portable proof you
  can hand to anyone, verifiable offline with the public key from `GET /api/v1/ledger/checkpoints`.
- **Health:** point an uptime check at `/api/v1/health`. `docker compose … logs --follow app worker`.

## 10. When something goes wrong

| Symptom | Likely cause | Fix |
|---|---|---|
| Browser says the site is not secure / no camera | DNS not pointing yet, or Caddy still getting the certificate | `docker compose … logs caddy`; wait a minute after DNS resolves |
| App won't start: "AUTH_SECRET" | placeholder still in `.env` | set a real random value |
| Phone can't weigh: "no active session" | the session window ended or wasn't assigned to that supervisor | admin creates/extends a session and assigns them |
| Collector not in the phone's search | not authorized yet, or the phone hasn't re-primed | authorize; supervisor opens Weigh online, taps *Sync now* |
| Event stuck "needs attention: collector_not_authorized" | the collector was revoked/pending when it synced | authorize them, then re-record (the old event is kept as evidence) |
| Payout stays `awaiting_destination` | the wallet is `pending_validation` / `invalid` | check the wallet via `GET /collectors/:id`; re-attach the Receive address |
| Payout stays `awaiting_rate` | the exchange feed couldn't reach ≥2 sources | `docker compose … logs worker`; it retries on its own; check outbound internet |
| Payout stuck in `sending` / flagged `payout_uncertain` | the provider never confirmed the payment | check, then resolve it (section 6) |
| Payout `pending_float` | the float is below the amount | top up the Blink float; the sweep resumes it |
| Scanning a card is refused: "spend/pay code" | the Pay side was scanned | flip the card and scan **Receive** |
| `verify` says `ok: false` | **stop.** Do not restart or edit anything | keep the database, run `verify-ledger.ts`, call the maintainers |

## 11. Data protection

The system deliberately holds as little as possible: an alias, a wallet address, weights, timestamps,
location, and a photo of the weighed material. No ID numbers, no phone numbers for collectors, no
faces needed — **frame the waste and the scale, not people**. Tell collectors what is recorded, why,
and who can see it (partners only ever see aggregates). Before collecting real people's data, confirm
Afribit's obligations under Kenya's Data Protection Act (registration as a data controller, a short
privacy notice at the collection point). This document is operational guidance, not legal advice.
