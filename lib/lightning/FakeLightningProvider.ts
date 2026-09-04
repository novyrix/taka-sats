// SPDX-License-Identifier: AGPL-3.0-only

/**
 * In-memory `LightningProvider` for local dev and unit tests (D-11). Never
 * touches the network and never moves real funds. Runs the exact same
 * receive-only validation as the real providers (`resolveReceiveAddress`
 * delegates to `lnurlPay.ts`), so a test against `FakeLightningProvider`
 * genuinely exercises the guarantee in M1-10 — only the network fetch is
 * swapped for an injectable stub.
 */

import { sats, type Sats } from '@/lib/money';
import { PaymentFailedError } from './errors';
import type {
  FloatBalance,
  LightningProvider,
  PayoutDestination,
  PayResult,
  ResolvedAddress,
} from './LightningProvider';
import { resolveLnurlPay, type FetchLike } from './lnurlPay';

export type FakeFetchResponse = {
  readonly tag: 'payRequest' | 'withdrawRequest' | string;
  readonly callback?: string;
  readonly minSendable?: number;
  readonly maxSendable?: number;
  readonly metadata?: string;
};

export type FakeLightningProviderOptions = {
  /** Starting operating-float balance, in sats. Defaults to 1,000,000. */
  readonly initialFloatSats?: number;
  /**
   * Deterministic responses keyed by the raw address/LNURL a caller passes,
   * so tests don't need a real network. Any key not listed resolves as a
   * normal `payRequest` with a generous sendable range; a key containing
   * "withdraw" resolves as a `withdrawRequest` by default (simulates a
   * malicious/withdraw code) unless overridden here.
   */
  readonly responses?: Readonly<Record<string, FakeFetchResponse>>;
};

const DEFAULT_MIN_SENDABLE_MSAT = 1000;
const DEFAULT_MAX_SENDABLE_MSAT = 100_000_000_000;

export class FakeLightningProvider implements LightningProvider {
  readonly kind = 'fake';

  private floatSats: number;
  private readonly responses: Readonly<Record<string, FakeFetchResponse>>;
  private readonly payments: PayResult[] = [];

  constructor(options: FakeLightningProviderOptions = {}) {
    this.floatSats = options.initialFloatSats ?? 1_000_000;
    this.responses = options.responses ?? {};
  }

  private buildFetch(): FetchLike {
    const responses = this.responses;
    return (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      const key = Object.keys(responses).find(
        (raw) => url.includes(encodeURIComponent(raw)) || url.includes(raw),
      );
      const body: FakeFetchResponse =
        (key ? responses[key] : undefined) ??
        (url.toLowerCase().includes('withdraw')
          ? { tag: 'withdrawRequest', callback: url }
          : {
              tag: 'payRequest',
              callback: `${url.split('?')[0]}/callback`,
              minSendable: DEFAULT_MIN_SENDABLE_MSAT,
              maxSendable: DEFAULT_MAX_SENDABLE_MSAT,
              metadata: '[["text/plain","fake"]]',
            });

      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as FetchLike;
  }

  async resolveReceiveAddress(lnurlOrAddress: string): Promise<ResolvedAddress> {
    return resolveLnurlPay(lnurlOrAddress, this.buildFetch());
  }

  async pay(
    destination: PayoutDestination,
    amount: Sats,
    idempotencyKey: string,
  ): Promise<PayResult> {
    // Enforce the same receive-only check a real provider would (M1-10).
    await this.resolveReceiveAddress(destination.lnurlOrAddress);

    if (amount > this.floatSats) {
      throw new PaymentFailedError(
        `Insufficient fake float: need ${amount} sats, have ${this.floatSats}`,
        'INSUFFICIENT_FLOAT',
      );
    }

    const existing = this.payments.find((p) => p.paymentRef === idempotencyKey);
    if (existing) {
      return existing;
    }

    this.floatSats -= amount;
    const result: PayResult = {
      paymentRef: idempotencyKey,
      amount,
      feeSats: sats(0),
      settledAt: new Date(),
    };
    this.payments.push(result);
    return result;
  }

  async getFloatBalance(): Promise<FloatBalance> {
    return { available: sats(this.floatSats), asOf: new Date() };
  }

  /** Test helper: every payment sent so far, in call order. */
  paymentsSent(): readonly PayResult[] {
    return this.payments;
  }
}
