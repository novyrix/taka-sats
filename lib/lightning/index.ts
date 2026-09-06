// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `LightningProvider` factory (D-11, D-22, D-23) — the one place that reads
 * `settings.lightning.float_provider` and picks the implementation. Secrets
 * come from the environment only, never from config (D-21 §13.1), and are
 * read *lazily* by the provider — `resolveReceiveAddress` (pure LNURL
 * resolution, M1-5) works with no secret set; only `pay`/`getFloatBalance`
 * require one and throw a clear error if it is missing at call time.
 */

import { getSettings } from '@/lib/config';
import { BlinkProvider } from './BlinkProvider';
import { FedimintProvider } from './FedimintProvider';
import type { LightningProvider } from './LightningProvider';
import { type CollectorWalletProvisioner, LNbitsProvider } from './LNbitsProvider';

function lnbitsProvider(env: Readonly<Record<string, string | undefined>>): LNbitsProvider {
  const { lightning } = getSettings();
  return new LNbitsProvider({
    baseUrl: lightning.lnbits.base_url,
    floatWalletId: lightning.lnbits.float_wallet_id,
    adminKey: env.LNBITS_ADMIN_KEY ?? '',
    ...(env.LNBITS_USERMANAGER_KEY ? { usermanagerKey: env.LNBITS_USERMANAGER_KEY } : {}),
  });
}

export function getLightningProvider(
  env: Readonly<Record<string, string | undefined>> = process.env,
): LightningProvider {
  const { lightning } = getSettings();

  switch (lightning.float_provider) {
    case 'blink':
      return new BlinkProvider({
        apiUrl: lightning.blink.api_url,
        floatWalletId: lightning.blink.float_wallet_id,
        apiKey: env.BLINK_API_KEY ?? '',
      });
    case 'lnbits':
      return lnbitsProvider(env);
    case 'fedimint':
      return new FedimintProvider({ federationInvite: lightning.fedimint.federation_invite });
  }
}

/**
 * The per-collector wallet provisioner (M1-6). Only LNbits provisions —
 * `custody.provisioning_enabled` gates whether it is ever used, and gate G1
 * gates real funds.
 */
export function getCollectorWalletProvisioner(
  env: Readonly<Record<string, string | undefined>> = process.env,
): CollectorWalletProvisioner {
  return lnbitsProvider(env);
}

export type { LightningProvider } from './LightningProvider';
export { FakeLightningProvider } from './FakeLightningProvider';
