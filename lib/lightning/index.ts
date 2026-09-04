// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `LightningProvider` factory (D-11, D-22, D-23) — the one place that reads
 * `settings.lightning.float_provider` and picks the implementation. Secrets
 * come from the environment only, never from config (D-21 §13.1).
 */

import { getSettings } from '@/lib/config';
import { BlinkProvider } from './BlinkProvider';
import { FedimintProvider } from './FedimintProvider';
import type { LightningProvider } from './LightningProvider';
import { LNbitsProvider } from './LNbitsProvider';

function requireEnv(env: Readonly<Record<string, string | undefined>>, name: string): string {
  const value = env[name];
  if (!value) {
    throw new Error(`${name} is not set (required by the configured lightning.float_provider)`);
  }
  return value;
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
        apiKey: requireEnv(env, 'BLINK_API_KEY'),
      });
    case 'lnbits':
      return new LNbitsProvider({
        baseUrl: lightning.lnbits.base_url,
        floatWalletId: lightning.lnbits.float_wallet_id,
        adminKey: requireEnv(env, 'LNBITS_ADMIN_KEY'),
      });
    case 'fedimint':
      return new FedimintProvider({ federationInvite: lightning.fedimint.federation_invite });
  }
}

export type { LightningProvider } from './LightningProvider';
export { FakeLightningProvider } from './FakeLightningProvider';
