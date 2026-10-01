// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Blink (Galoy) `LightningProvider` (D-11, D-23) — the shipped default
 * operating-float rail; also resolves/validates a collector's Blink Paycode
 * / Lightning Address for BYO enrolment (§7.1 Path A).
 *
 * Endpoint, mutation name (`lnInvoicePaymentSend`), and the `X-API-KEY`
 * header are confirmed against dev.blink.sv. The exact input/output field
 * names below follow Blink's documented public GraphQL conventions but are
 * NOT introspection-verified in this environment — confirm against
 * `https://api.blink.sv/graphql`'s live schema (or the Blink Postman
 * collection) before the first real payout.
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

export type BlinkProviderConfig = {
  /** e.g. https://api.blink.sv/graphql (settings.lightning.blink.api_url). */
  readonly apiUrl: string;
  /** The float wallet id (settings.lightning.blink.float_wallet_id). Non-secret. */
  readonly floatWalletId: string;
  /** `X-API-KEY` value. From the environment only (D-21) — never in settings.toml. */
  readonly apiKey: string;
};

type GraphQlError = { message: string; code?: string };
type GraphQlResponse<T> = { data?: T; errors?: GraphQlError[] };

const PAY_INVOICE_MUTATION = /* GraphQL */ `
  mutation LnInvoicePaymentSend($input: LnInvoicePaymentInput!) {
    lnInvoicePaymentSend(input: $input) {
      status
      errors {
        message
        path
        code
      }
    }
  }
`;

const WALLET_BALANCE_QUERY = /* GraphQL */ `
  query FloatWalletBalance {
    me {
      defaultAccount {
        wallets {
          id
          balance
          walletCurrency
        }
      }
    }
  }
`;

type PayInvoiceData = {
  lnInvoicePaymentSend: { status: string; errors: GraphQlError[] };
};

type WalletBalanceData = {
  me: {
    defaultAccount: { wallets: { id: string; balance: number; walletCurrency: string }[] };
  } | null;
};

export class BlinkProvider implements LightningProvider {
  readonly kind = 'blink';

  constructor(private readonly config: BlinkProviderConfig) {}

  private async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    if (!this.config.apiKey) {
      throw new PaymentFailedError('BLINK_API_KEY is not set — required to move funds via Blink');
    }
    const response = await fetch(this.config.apiUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-API-KEY': this.config.apiKey,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      // A 4xx means the request was rejected and nothing was attempted; a 5xx / timeout /
      // rate-limit may have been processed before the response was lost — outcome unknown.
      throw isDefinitiveHttpRejection(response.status)
        ? new PaymentFailedError(`Blink API returned HTTP ${response.status}`)
        : new PaymentOutcomeUnknownError(`Blink API returned HTTP ${response.status}`);
    }

    const body = (await response.json()) as GraphQlResponse<T>;
    if (body.errors && body.errors.length > 0) {
      throw new PaymentFailedError(
        body.errors.map((e) => e.message).join('; '),
        body.errors[0]?.code,
      );
    }
    if (!body.data) {
      throw new PaymentFailedError('Blink API returned no data');
    }
    return body.data;
  }

  async resolveReceiveAddress(lnurlOrAddress: string): Promise<ResolvedAddress> {
    return resolveLnurlPay(lnurlOrAddress);
  }

  async pay(
    destination: PayoutDestination,
    amount: Sats,
    idempotencyKey: string,
  ): Promise<PayResult> {
    // The destination is an already-resolved receive-capable target — never
    // trust it blindly, resolve again to get a fresh invoice at pay time.
    const bolt11 = await requestInvoiceFor(destination.lnurlOrAddress, amount);

    const data = await this.graphql<PayInvoiceData>(PAY_INVOICE_MUTATION, {
      input: {
        walletId: this.config.floatWalletId,
        paymentRequest: bolt11,
        memo: idempotencyKey,
      },
    });

    const { status, errors } = data.lnInvoicePaymentSend;
    if (status === 'FAILURE') {
      throw new PaymentFailedError(
        errors.map((e) => e.message).join('; ') || `Blink payment status: ${status}`,
        status,
      );
    }
    if (status !== 'SUCCESS' && status !== 'ALREADY_PAID') {
      // PENDING (it may still settle) or a status we do not recognise: never "failed".
      throw new PaymentOutcomeUnknownError(`Blink payment status: ${status}`);
    }

    return {
      paymentRef: idempotencyKey,
      amount,
      // Blink's send mutation does not return the routing fee; reconciling
      // exact fees from `transactionsByWalletId` is deferred past M1.
      feeSats: sats(0),
      settledAt: new Date(),
    };
  }

  async getFloatBalance(): Promise<FloatBalance> {
    const data = await this.graphql<WalletBalanceData>(WALLET_BALANCE_QUERY, {});
    const wallet = data.me?.defaultAccount.wallets.find((w) => w.id === this.config.floatWalletId);
    if (!wallet) {
      throw new PaymentFailedError(
        `Float wallet ${this.config.floatWalletId} not found on this Blink account`,
      );
    }
    return { available: sats(Math.max(0, Math.trunc(wallet.balance))), asOf: new Date() };
  }
}
