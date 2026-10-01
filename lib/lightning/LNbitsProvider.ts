// SPDX-License-Identifier: AGPL-3.0-only

/**
 * LNbits `LightningProvider` (D-11, D-23) — the opt-in custodial provider:
 * runs the operating float and, when `custody.provisioning_enabled`, mints a
 * per-collector wallet + LNURLp (§7.1 Path B). Gate G1 before real funds.
 *
 * Core Payments/Wallet endpoints and the `X-Api-Key` header are LNbits'
 * long-stable REST convention. `createCollectorWallet` additionally uses the
 * `usermanager` and `lnurlp` extensions (must be enabled on the instance —
 * see `docker/docker-compose.custodial.yml`).
 *
 * Payment fields were checked against the OpenAPI document of LNbits 1.6 (`/openapi.json`):
 * `POST /api/v1/payments` answers 201 with a `Payment` whose `status` is `pending` until it
 * settles, so a 201 is NOT proof of payment: only `status: "success"` is. `pending`, a missing
 * status, an HTTP 5xx (LNbits documents 520 "Payment or Invoice error") and a timeout are an
 * UNKNOWN outcome. Amounts and fees are in millisatoshis. The usermanager/lnurlp provisioning
 * shapes remain unverified against a live instance. See `docs/providers/lnbits.md`.
 */

import { sats, type Sats } from '@/lib/money';
import { bolt11PaymentHash } from './bolt11';
import {
  isDefinitiveHttpRejection,
  PaymentFailedError,
  PaymentOutcomeUnknownError,
} from './errors';
import type {
  FloatBalance,
  LightningProvider,
  PaymentLookup,
  PaymentLookupQuery,
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
  /** Per-request timeout; a timeout on a payment is an unknown outcome. Default 30 s. */
  readonly timeoutMs?: number;
};

/** paid | failed | pending, from a 1.x `status` string or a legacy `paid` flag. */
function paymentState(payment: PaymentResponse): 'paid' | 'failed' | 'pending' {
  if (payment.status === 'success') {
    return 'paid';
  }
  if (payment.status === 'failed') {
    return 'failed';
  }
  if (payment.status === undefined && payment.paid === true) {
    return 'paid';
  }
  return 'pending';
}

/** LNbits reports fees in msat (negative when outgoing); round up to whole sats. */
function feeSatsOf(fee: number | undefined): Sats {
  return sats(
    typeof fee === 'number' && Number.isFinite(fee) ? Math.ceil(Math.abs(fee) / 1000) : 0,
  );
}

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
/** Core `Payment` (1.x) or the older `{ payment_hash, checking_id }` / `{ paid, preimage }` shapes. */
type PaymentResponse = {
  payment_hash: string;
  status?: 'pending' | 'success' | 'failed' | string;
  paid?: boolean;
  /** msat; negative for an outgoing payment in LNbits. */
  fee?: number;
  amount?: number;
  memo?: string | null;
};
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

    const paymentHash = bolt11PaymentHash(bolt11);
    let result: PaymentResponse;
    try {
      result = await lnbitsFetch<PaymentResponse>(
        this.config.baseUrl,
        '/api/v1/payments',
        this.config.adminKey,
        {
          method: 'POST',
          body: JSON.stringify({ out: true, bolt11, memo: idempotencyKey }),
          signal: AbortSignal.timeout(this.config.timeoutMs ?? 30_000),
        },
      );
    } catch (error) {
      if (error instanceof PaymentFailedError || error instanceof PaymentOutcomeUnknownError) {
        throw error instanceof PaymentOutcomeUnknownError
          ? new PaymentOutcomeUnknownError(error.message, paymentHash)
          : error;
      }
      // A lost connection or timeout: the request may have reached LNbits.
      throw new PaymentOutcomeUnknownError('LNbits request did not complete', paymentHash);
    }

    const state = paymentState(result);
    if (state === 'failed') {
      throw new PaymentFailedError('LNbits reported the payment as failed', 'failed');
    }
    if (state !== 'paid') {
      // `pending` (it may still settle) or an answer without a status: never "paid", never "failed".
      throw new PaymentOutcomeUnknownError(
        `LNbits payment status: ${result.status ?? 'unreported'}`,
        result.payment_hash || paymentHash,
      );
    }

    return {
      paymentRef: result.payment_hash || paymentHash,
      amount,
      feeSats: feeSatsOf(result.fee),
      settledAt: new Date(),
    };
  }

  /**
   * Read only: `GET /api/v1/payments/{payment_hash}`. LNbits cannot be searched by our memo
   * here, so a payment reference (the hash recorded with an unknown outcome) is required.
   */
  async lookupPayment(query: PaymentLookupQuery): Promise<PaymentLookup> {
    if (!query.paymentRef) {
      throw new Error('LNbits lookup needs the payment hash; check the LNbits wallet history');
    }
    const result = await lnbitsFetch<PaymentResponse>(
      this.config.baseUrl,
      `/api/v1/payments/${encodeURIComponent(query.paymentRef)}`,
      this.config.adminKey,
    );
    const state = paymentState(result);
    return {
      state: state === 'paid' ? 'paid' : state === 'failed' ? 'failed' : 'pending',
      paymentRef: query.paymentRef,
      feeSats: feeSatsOf(result.fee),
      matches: 1,
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
