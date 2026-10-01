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

/** What to look up: the provider reference if we hold one, and always the key we sent. */
export type PaymentLookupQuery = {
  /** The payment hash recorded when the attempt was made, if any. */
  readonly paymentRef?: string;
  /** The idempotency key `pay` was called with (the payout id). */
  readonly idempotencyKey: string;
};

/**
 * What the provider says became of a payment. Read only evidence for a person to act on;
 * it never changes a payout by itself. `not_found` is not proof that nothing was sent.
 */
export type PaymentLookup = {
  readonly state: 'paid' | 'failed' | 'pending' | 'not_found';
  readonly paymentRef?: string;
  readonly feeSats?: Sats;
  readonly settledAt?: Date;
  /** True when the provider returned a preimage whose sha256 equals the payment hash. */
  readonly proofVerified?: boolean;
  /** How many matching outgoing payments were found (more than one needs a person's eyes). */
  readonly matches?: number;
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

  /**
   * Read only: ask the provider what became of an earlier `pay` (used to resolve a payout whose
   * outcome was unknown). Optional: a provider that cannot look a payment up omits it and the
   * operator checks the provider's own dashboard.
   */
  lookupPayment?(query: PaymentLookupQuery): Promise<PaymentLookup>;
}
