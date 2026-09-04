// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Lightning access boundary (D-11, D-22, D-23).
 *
 * Every money path talks to this interface, never to a provider SDK directly,
 * so the payout code is byte-identical across `blink` | `lnbits` | `fedimint`
 * and a `FakeLightningProvider` can stand in for unit tests. The concrete
 * implementations land in M1-2; this file freezes the contract.
 *
 * Zero framework imports (D-04). `Sats` is the branded type from `lib/money`.
 */

import type { Sats } from '@/lib/money';

export type ProviderKind = 'blink' | 'lnbits' | 'fedimint' | 'fake';

/** A validated, receive-only payment target resolved from a tag mapping (§12.3). */
export type PayoutDestination = {
  /** Bech32 LNURL-pay string or a Lightning Address (`name@domain`). */
  readonly lnurlOrAddress: string;
};

export type PayResult = {
  /** Provider-side reference for reconciliation (`provider_payment_ref`). */
  readonly paymentRef: string;
  readonly amount: Sats;
  readonly feeSats: Sats;
  readonly settledAt: Date;
};

export type ResolvedAddress = {
  readonly lnurlOrAddress: string;
  /** True only for a payable, receive-capable target; a withdraw code is false. */
  readonly receiveCapable: boolean;
  readonly minSendableSats: Sats;
  readonly maxSendableSats: Sats;
};

export type FloatBalance = {
  readonly available: Sats;
  readonly asOf: Date;
};

export interface LightningProvider {
  readonly kind: ProviderKind;

  /**
   * Send `amount` to a server-resolved destination. The destination is passed
   * by the payout worker after resolving it from the tag mapping — it is never
   * taken from client input (§12.3).
   */
  pay(destination: PayoutDestination, amount: Sats, idempotencyKey: string): Promise<PayResult>;

  /**
   * Resolve and validate a BYO address/Paycode as receive-capable. Must reject
   * an `LNURLw` (withdraw) code (ADR-001, M1-10).
   */
  resolveReceiveAddress(lnurlOrAddress: string): Promise<ResolvedAddress>;

  /** Current operating-float balance for the low-balance alert (FR-7.2). */
  getFloatBalance(): Promise<FloatBalance>;
}
