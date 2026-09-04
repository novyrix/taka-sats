// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Fedimint `LightningProvider` (D-11, D-23) — pays via Afribit's existing
 * Fedi federation (fedi.xyz, OQ-4 resolved).
 *
 * `resolveReceiveAddress` is provider-agnostic LNURL resolution and is fully
 * implemented. `pay`/`getFloatBalance` need a Fedimint client binding
 * (`fedimint-client`/`fedimint-ts` or an RPC to a running `fedimintd`/gateway)
 * that this environment cannot safely guess the shape of without the SDK in
 * hand — they throw {@link NotYetImplemented} until that integration lands.
 * Tracked as a real M1/M5 follow-up, not deferred silently.
 */

import { NotYetImplemented, type Sats } from '@/lib/money';
import type {
  FloatBalance,
  LightningProvider,
  PayoutDestination,
  PayResult,
  ResolvedAddress,
} from './LightningProvider';
import { resolveLnurlPay } from './lnurlPay';

export type FedimintProviderConfig = {
  /** settings.lightning.fedimint.federation_invite. */
  readonly federationInvite: string;
};

export class FedimintProvider implements LightningProvider {
  readonly kind = 'fedimint';

  constructor(private readonly config: FedimintProviderConfig) {}

  async resolveReceiveAddress(lnurlOrAddress: string): Promise<ResolvedAddress> {
    return resolveLnurlPay(lnurlOrAddress);
  }

  async pay(
    _destination: PayoutDestination,
    _amount: Sats,
    _idempotencyKey: string,
  ): Promise<PayResult> {
    throw new NotYetImplemented(
      `FedimintProvider.pay is not implemented (needs a Fedimint client binding for federation ${this.config.federationInvite || '(unset)'})`,
    );
  }

  async getFloatBalance(): Promise<FloatBalance> {
    throw new NotYetImplemented('FedimintProvider.getFloatBalance is not implemented');
  }
}
