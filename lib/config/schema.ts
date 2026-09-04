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
});

const custodySchema = z.object({
  default_address_source: z.enum(['byo', 'provisioned']),
  provisioning_enabled: z.boolean(),
  provisioning_ack: z.string(),
});

const lightningSchema = z.object({
  float_provider: z.enum(['blink', 'lnbits', 'fedimint']),
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
  /** ≥2 independent sources (D-18); array order is preference order. */
  exchange_sources: z.array(nonEmpty).min(2),
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
  second_signoff_threshold_sats: z.int().nonnegative(),
  float_low_balance_alert_sats: z.int().nonnegative(),
  auto_topup_enabled: z.boolean(),
});

const reconciliationSchema = z.object({
  variance_tolerance_pct: z.number().min(0).max(100),
});

const anomalySchema = z.object({
  identical_weight_repeat_count: z.int().min(2),
  payout_concentration_gini: z.number().min(0).max(1),
  off_hours_grace_minutes: z.int().nonnegative(),
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
  checkpoint_interval_entries: z.int().positive(),
  opentimestamps_enabled: z.boolean(),
});

export const settingsSchema = z
  .object({
    programme: programmeSchema,
    custody: custodySchema,
    lightning: lightningSchema,
    money: moneySchema,
    rates: ratesSchema,
    payouts: payoutsSchema,
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
