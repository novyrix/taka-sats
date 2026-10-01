// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `GET /api/v1/meta` — the non-sensitive deployment facts a UI needs so it never
 * has to guess (docs/BACKEND.md §7). Public: no session required, and nothing
 * here is a secret, a key, or a person. Derived from `config/settings*.toml`.
 */

import { NextResponse } from 'next/server';
import { getSettings } from '@/lib/config';

export function GET(): NextResponse {
  const { programme, collectors, lightning } = getSettings();

  return NextResponse.json({
    programme: {
      name: programme.name,
      timezone: programme.timezone,
      fiatCurrency: programme.fiat_currency,
      locales: programme.locales,
      defaultLocale: programme.default_locale,
      publicBaseUrl: programme.public_base_url,
    },
    collectors: {
      /** false → there is no `pending` state; everyone registers `active`. */
      authorizationRequired: collectors.authorization_required,
      codePrefix: collectors.code_prefix,
      defaultSiteCode: collectors.default_site_code || null,
    },
    lightning: {
      floatProvider: lightning.float_provider,
      /** true → payouts are simulated (the `fake` provider): show a "demo mode" banner. */
      demo: lightning.float_provider === 'fake',
    },
    /** The commit this build came from, when the host provides one. */
    build: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_SHA ?? null,
  });
}
