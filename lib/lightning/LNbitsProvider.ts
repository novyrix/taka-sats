// SPDX-License-Identifier: AGPL-3.0-only

/**
 * LNbits `LightningProvider` (D-11, D-23) — the opt-in custodial provider:
 * runs the operating float and, when `custody.provisioning_enabled`, mints a
 * per-collector wallet + LNURLp (§7.1 Path B). Gate G1 before real funds.
 *
 * Core Payments/Wallet endpoints and the `X-Api-Key` header are LNbits'
 * long-stable REST convention. `createCollectorWallet` additionally uses the
 * `usermanager` and `lnurlp` extensions (must be enabled on the instance —
 * see `docker/docker-compose.custodial.yml`). Field names are NOT
 * introspection-verified in this environment — confirm against the running
 * instance's `/docs` (Swagger UI) before the first live provisioning run.
 */

import { sats, type Sats } from '@/lib/money';
import {
  isDefinitiveHttpRejection,
  PaymentFailedError,
  PaymentOutcomeUnknownError,
} from './errors';
import type {
  FloatBalance,
  LightningProvider,
  PayoutDestination,
  PayResult,
  ResolvedAddress,
} from './LightningProvider';
import { requestInvoiceFor, resolveLnurlPay } from './lnurlPay';

/**
 * The one method a per-collector provisioning job needs (M1-6). Kept as a
 * narrow interface here (not the whole `LightningProvider`) so a test can
 * stub it and so `lib/jobs` depends on `lib/lightning`, not the reverse.
 */
export interface CollectorWalletProvisioner {
  createCollectorWallet(userLabel: string): Promise<{ lnbitsWalletId: string; lnurlp: string }>;
}

export type LNbitsProviderConfig = {
  /** e.g. http://lnbits:5000 (settings.lightning.lnbits.base_url). */
  readonly baseUrl: string;
  /** The float wallet id (settings.lightning.lnbits.float_wallet_id). Non-secret. */
  readonly floatWalletId: string;
  /** The float wallet's admin key. From the environment only — `LNBITS_ADMIN_KEY`. */
  readonly adminKey: string;
  /**
   * The `usermanager` extension admin key, for minting per-collector wallets
   * (M1-6 / gate G1). Environment only — `LNBITS_USERMANAGER_KEY`. Distinct
   * from the float `adminKey`.
   */
  readonly usermanagerKey?: string;
};

async function lnbitsFetch<T>(
  baseUrl: string,
  path: string,
  apiKey: string,
  init?: RequestInit,
): Promise<T> {
  if (!apiKey) {
    throw new PaymentFailedError(`An LNbits API key is not set — required for ${path}`);
  }
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'X-Api-Key': apiKey,
      ...init?.headers,
    },
  });

  if (!response.ok) {
    // The body is deliberately not included: an LNbits error can echo an invoice or a key.
    // 4xx = rejected, nothing attempted; 5xx / timeout / rate-limit = the outcome is unknown.
    throw isDefinitiveHttpRejection(response.status)
      ? new PaymentFailedError(`LNbits ${path} returned HTTP ${response.status}`)
      : new PaymentOutcomeUnknownError(`LNbits ${path} returned HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

type WalletDetails = { id: string; name: string; balance: number };
type PaymentResponse = { payment_hash: string };
type UsermanagerUser = { id: string; wallets: { id: string; adminkey: string; inkey: string }[] };
type LnurlpLink = { id: string; lnurl: string };

export class LNbitsProvider implements LightningProvider {
  readonly kind = 'lnbits';

  constructor(private readonly config: LNbitsProviderConfig) {}

  async resolveReceiveAddress(lnurlOrAddress: string): Promise<ResolvedAddress> {
    return resolveLnurlPay(lnurlOrAddress);
  }

  async pay(
    destination: PayoutDestination,
    amount: Sats,
    idempotencyKey: string,
  ): Promise<PayResult> {
    const bolt11 = await requestInvoiceFor(destination.lnurlOrAddress, amount);

    const result = await lnbitsFetch<PaymentResponse>(
      this.config.baseUrl,
      '/api/v1/payments',
      this.config.adminKey,
      {
        method: 'POST',
        body: JSON.stringify({ out: true, bolt11, memo: idempotencyKey }),
      },
    );

    return {
      paymentRef: result.payment_hash,
      amount,
      // LNbits does not return the routing fee synchronously; a follow-up
      // reconciliation pass (`GET /api/v1/payments/{hash}`) is deferred past M1.
      feeSats: sats(0),
      settledAt: new Date(),
    };
  }

  async getFloatBalance(): Promise<FloatBalance> {
    const wallet = await lnbitsFetch<WalletDetails>(
      this.config.baseUrl,
      '/api/v1/wallet',
      this.config.adminKey,
    );
    return { available: sats(Math.max(0, Math.trunc(wallet.balance / 1000))), asOf: new Date() };
  }

  /**
   * Provision a per-collector wallet + LNURLp (§7.1 Path B, M1-6). Uses the
   * `usermanager` extension key from config — distinct from the float
   * `adminKey`. Implements `CollectorWalletProvisioner` (lib/jobs).
   */
  async createCollectorWallet(
    userLabel: string,
  ): Promise<{ lnbitsWalletId: string; lnurlp: string }> {
    if (!this.config.usermanagerKey) {
      throw new PaymentFailedError(
        'LNBITS_USERMANAGER_KEY is not set — required to provision a collector wallet',
      );
    }
    const user = await lnbitsFetch<UsermanagerUser>(
      this.config.baseUrl,
      '/usermanager/api/v1/users',
      this.config.usermanagerKey,
      { method: 'POST', body: JSON.stringify({ user_name: userLabel, wallet_name: 'collector' }) },
    );
    const wallet = user.wallets[0];
    if (!wallet) {
      throw new PaymentFailedError(`LNbits did not return a wallet for user ${userLabel}`);
    }

    const link = await lnbitsFetch<LnurlpLink>(
      this.config.baseUrl,
      '/lnurlp/api/v1/links',
      wallet.adminkey,
      {
        method: 'POST',
        body: JSON.stringify({
          description: `Taka Sats collector — ${userLabel}`,
          min: 1,
          max: 1_000_000,
          comment_chars: 0,
        }),
      },
    );

    return { lnbitsWalletId: wallet.id, lnurlp: link.lnurl };
  }
}
