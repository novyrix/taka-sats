// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Zod schema for the full Taka Sats settings surface (REQUIREMENTS §13.2).
 *
 * This module has zero framework imports (D-04) so it lifts into `packages/*`
 * unchanged. It defines the shape only; layering and boot-time validation live
 * in `./index.ts`.
 */

import { z } from 'zod';

/**
 * The operator must paste this exact string into `custody.provisioning_ack`
 * before `custody.provisioning_enabled = true` is accepted. It is the
 * machine-checkable half of gate G1 (D-22): it does not grant legal cover, it
 * forces a deliberate acknowledgement that the recorded G1 review exists.
 */
export const PROVISIONING_ACKNOWLEDGEMENT =
  'I confirm the recorded G1 legal review authorises this operator to custody collector funds.';

const nonEmpty = z.string().trim().min(1);

const programmeSchema = z.object({
  name: nonEmpty,
  timezone: nonEmpty,
  /** ISO 4217 code; the rate table and all reporting are denominated in this. */
  fiat_currency: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/, 'fiat_currency must be a 3-letter ISO 4217 code'),
  locales: z.array(nonEmpty).min(1),
  default_locale: nonEmpty,
  /** Where this deployment is served; builds credential URLs and links (no trailing slash). */
  public_base_url: z.url().refine((u) => !u.endsWith('/'), 'public_base_url must not end with "/"'),
});

const custodySchema = z.object({
  default_address_source: z.enum(['byo', 'provisioned']),
  provisioning_enabled: z.boolean(),
  provisioning_ack: z.string(),
});

const collectorsSchema = z.object({
  /** The authorization gate (D-25): supervisor registrations stay `pending` until staff authorize. */
  authorization_required: z.boolean(),
  /** First segment of a collector's `public_code` (D-24), e.g. `TS` in `TS-KBR-0042`. */
  code_prefix: z
    .string()
    .trim()
    .regex(/^[A-Z]{1,6}$/, 'code_prefix must be 1-6 capital letters'),
  /** Site segment when an enrolment names none; empty omits the segment. */
  default_site_code: z
    .string()
    .trim()
    .regex(/^([A-Z]{2,6})?$/, 'default_site_code must be empty or 2-6 capital letters'),
});

const authSchema = z.object({
  /** How long a supervisor's signed-in session survives, incl. fully offline (§3.1, ADR-0002). */
  session_max_age_days: z.int().positive(),
  /** Failed logins per identifier per window before it is locked out. 0 disables the throttle. */
  login_max_failures: z.int().nonnegative(),
  /** The sliding window (minutes) failures are counted in, and the lockout length. */
  login_window_minutes: z.int().positive(),
});

const lightningSchema = z.object({
  float_provider: z.enum(['blink', 'lnbits', 'fedimint', 'fake']),
  /** Hosts whose URLs are spend credentials; exact host + subdomains, case-insensitive. Rejected before any fetch. */
  spend_link_hosts: z.array(
    z.string().regex(/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i, 'must be a bare hostname'),
  ),
  /** Per-request timeout for provider API calls; a timeout on a payment is an unknown outcome. */
  provider_timeout_ms: z.int().min(1000).max(120000),
  /** Per-request timeout for LNURL resolution and invoice requests. */
  lnurl_timeout_ms: z.int().min(1000).max(60000),
  /** Wallet-provider labels by Lightning-address domain (subdomains match) — display/analytics only. */
  provider_hints: z.record(nonEmpty, nonEmpty),
  blink: z.object({
    api_url: z.url(),
    float_wallet_id: z.string(),
  }),
  lnbits: z.object({
    base_url: z.url(),
    float_wallet_id: z.string(),
  }),
  fedimint: z.object({
    federation_invite: z.string(),
  }),
});

const moneySchema = z.object({
  rate_staleness_ttl_seconds: z.int().positive(),
  /** ≥2 independent sources (D-18); array order is preference order. Known: `yadio`, `coinbase`, `kraken_fx`, `coingecko`, `fake`. */
  exchange_sources: z.array(nonEmpty).min(2),
  /** Sources within this % of the median agree; an outlier is set aside; ≥2 must agree within this % of each other. */
  rate_deviation_tolerance_pct: z.number().positive().max(100),
});

const rateSeedSchema = z.object({
  material: nonEmpty,
  /** Fiat minor units (e.g. KES cents) per kg. Never sats (D-14). */
  rate_fiat_minor_per_kg: z.int().nonnegative(),
});

const ratesSchema = z.object({
  seed: z.array(rateSeedSchema).min(1),
});

const payoutsSchema = z.object({
  /** A payout above this waits for a distinct approver. 0 = every payout is held for review. */
  second_signoff_threshold_sats: z.int().nonnegative(),
  /** The first payout to a never-paid destination needs an approver whatever its size. */
  require_approval_first_payout: z.boolean(),
  float_low_balance_alert_sats: z.int().nonnegative(),
  auto_topup_enabled: z.boolean(),
  /** How often the worker re-tries parked payouts (5-field cron, UTC). */
  sweep_cron: z
    .string()
    .trim()
    .regex(/^\S+(\s+\S+){4}$/, 'sweep_cron must be a 5-field cron expression'),
  /** Resolving a stuck payout needs an admin who neither recorded the weigh nor approved the payout. */
  resolution_requires_distinct_actor: z.boolean(),
  /** A payout in 'sending' longer than this is flagged payout_uncertain, never re-sent. */
  sending_stale_minutes: z.int().positive(),
  /** Retry limit of the process-payout job. */
  max_attempts: z.int().positive(),
});

const treasurySchema = z.object({
  /**
   * Distinct stewards who must approve a funding proposal. The proposer never counts, so a
   * programme needs at least this many OTHER treasury stewards (ADR-0020).
   */
  topup_approvals_required: z.int().min(1).max(10),
  /** Ceiling on the hot-wallet float in sats, counting funding already in flight. 0 = no cap. */
  hot_wallet_cap_sats: z.int().nonnegative(),
});

const reconciliationSchema = z.object({
  variance_tolerance_pct: z.number().min(0).max(100),
});

const anomalySchema = z.object({
  identical_weight_repeat_count: z.int().min(2),
  payout_concentration_gini: z.number().min(0).max(1),
  off_hours_grace_minutes: z.int().nonnegative(),
  weight_outlier_min_events: z.int().min(1),
  weight_outlier_mad_k: z.number().positive(),
});

const schedulingSchema = z.object({
  coverage_gap_lead_time_hours: z.int().nonnegative(),
});

const transparencySchema = z.object({
  amount_disclosure: z.enum(['exact', 'bucketed', 'omitted']),
  weight_bucket_kg: z.number().positive(),
  public_map_jitter_metres: z.number().nonnegative(),
  nostr_relays: z.array(z.url()),
});

const ledgerSchema = z.object({
  /** Run the signing job at all. Needs the `LEDGER_SIGNING_KEY` secret when true. */
  checkpoint_enabled: z.boolean(),
  /** How often the worker looks for new entries to checkpoint (5-field cron, UTC). */
  checkpoint_cron: z
    .string()
    .trim()
    .regex(/^\S+(\s+\S+){4}$/, 'checkpoint_cron must be a 5-field cron expression'),
  /** Minimum new entries since the last checkpoint before another is signed. */
  checkpoint_interval_entries: z.int().positive(),
  opentimestamps_enabled: z.boolean(),
});

export const settingsSchema = z
  .object({
    programme: programmeSchema,
    custody: custodySchema,
    collectors: collectorsSchema,
    auth: authSchema,
    lightning: lightningSchema,
    money: moneySchema,
    rates: ratesSchema,
    payouts: payoutsSchema,
    treasury: treasurySchema,
    reconciliation: reconciliationSchema,
    anomaly: anomalySchema,
    scheduling: schedulingSchema,
    transparency: transparencySchema,
    ledger: ledgerSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.programme.locales.includes(value.programme.default_locale)) {
      ctx.addIssue({
        code: 'custom',
        path: ['programme', 'default_locale'],
        message: 'default_locale must be one of programme.locales',
      });
    }

    if (value.custody.provisioning_enabled) {
      if (value.custody.provisioning_ack.trim() !== PROVISIONING_ACKNOWLEDGEMENT) {
        ctx.addIssue({
          code: 'custom',
          path: ['custody', 'provisioning_ack'],
          message:
            'custody.provisioning_enabled is true but custody.provisioning_ack does not match the required G1 acknowledgement string',
        });
      }
    }

    if (
      value.custody.default_address_source === 'provisioned' &&
      !value.custody.provisioning_enabled
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['custody', 'default_address_source'],
        message:
          "default_address_source 'provisioned' requires custody.provisioning_enabled = true",
      });
    }

    const seedMaterials = value.rates.seed.map((entry) => entry.material);
    if (new Set(seedMaterials).size !== seedMaterials.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['rates', 'seed'],
        message: 'rates.seed contains duplicate material entries',
      });
    }
  });

export type Settings = z.infer<typeof settingsSchema>;
