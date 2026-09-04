# Configuration

Taka Sats is config-first (D-21): every operational value lives in configuration, not
in source. A programme in another city runs this codebase by editing one file, never by
forking. A literal magic number in domain code is a review-blocking defect.

## Layers

`lib/config/` merges three layers, lowest precedence first, then validates the result:

1. **`config/settings.default.toml`** — committed. Every key is present with a documented
   default. This is the reference and the fallback.
2. **`config/settings.toml`** — git-ignored. The operator's overrides; only the keys they
   change. Copy from the default file to start.
3. **Environment variables** — `TAKASATS__SECTION__KEY=value`. Nested keys join with a
   double underscore, lower-cased: `TAKASATS__PAYOUTS__SECOND_SIGNOFF_THRESHOLD_SATS=75000`.
   Values are parsed as JSON when possible (`900` → number, `true` → boolean,
   `'["kraken","yadio"]'` → array), otherwise kept as a string. Env wins over both files —
   use it on platforms where a file is awkward (Vercel).

The merged object is checked against the Zod schema in `lib/config/schema.ts`. **A missing
or out-of-range value fails the boot**, loudly, with every violation listed. The app never
starts on a half-valid config. The validated object is deep-frozen and exported typed by
`getSettings()`.

## Secrets are never in TOML

`DATABASE_URL`, `BLINK_API_KEY`, `LNBITS_ADMIN_KEY`, `NOSTR_PRIVATE_KEY`, `AUTH_SECRET`,
and object-storage credentials are environment variables only. `settings.toml` may name
*which* provider (`float_provider = "lnbits"`), never a key. See `.env.example`.

## The settings surface

Full annotated list: [`config/settings.default.toml`](../config/settings.default.toml).
Every key there carries a comment. Summary of the sections:

| Section | Purpose |
|---|---|
| `[programme]` | Name, timezone, fiat currency (ISO 4217), UI locales, default locale |
| `[custody]` | `byo` vs `provisioned` address source; the provisioning enable flag + G1 acknowledgement |
| `[lightning]` | `float_provider` (`blink` \| `lnbits` \| `fedimint`) and each provider's non-secret settings |
| `[money]` | BTC rate staleness TTL; the ordered list of exchange-rate sources (≥2) |
| `[rates]` | `seed` rows for `material_rates` on the first migration only — history lives in the DB afterwards |
| `[payouts]` | Second-sign-off threshold, low-float alert threshold, auto-topup flag |
| `[reconciliation]` | Paid-kg vs sold-kg variance tolerance |
| `[anomaly]` | Detector thresholds (identical-weight repeats, payout concentration, off-hours grace) |
| `[scheduling]` | Coverage-gap alert lead time |
| `[transparency]` | Attestation amount disclosure, weight bucket, public map jitter, Nostr relays |
| `[ledger]` | Checkpoint interval, OpenTimestamps toggle |

### Cross-field rules enforced at boot

- `programme.default_locale` must be one of `programme.locales`.
- `custody.provisioning_enabled = true` requires `custody.provisioning_ack` to equal the
  exact `PROVISIONING_ACKNOWLEDGEMENT` string in `lib/config/schema.ts`. This is the
  machine-checkable half of gate **G1** — it forces a deliberate acknowledgement that the
  recorded legal review exists; it is not legal cover.
- `custody.default_address_source = "provisioned"` requires `provisioning_enabled = true`.
- `rates.seed` may not contain a duplicate `material`.
- `money.exchange_sources` needs at least two entries (D-18 — no single oracle).

## What is *not* in the settings file

Operational data that changes while the system runs — rate *versions* over time, sessions,
supervisor rotations, API keys, collectors — lives in the database and is edited through
the admin UI / API, because it needs history, audit, and per-row authorisation. The
settings file only seeds the initial rate table on the first migration.

## Adding a new tunable

In the same change: add the key to `config/settings.default.toml` (with a comment), add it
to the Zod schema in `lib/config/schema.ts`, and add a row to the table above. An
operational literal in domain code fails review.
