// SPDX-License-Identifier: AGPL-3.0-only

/** A scanned/submitted code could not be normalised or resolved. */
export class InvalidLightningAddressError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidLightningAddressError';
  }
}

/**
 * The resolved code is not receive-capable — most importantly, a withdraw
 * (`LNURLw`) code. ADR-0001/M1-10: this must never be silently accepted.
 */
export class NotReceiveCapableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotReceiveCapableError';
  }
}

/**
 * A known spend-credential link (e.g. the Pay side of a Paybee card) was
 * scanned instead of a receive address. Thrown before any network call; the
 * scanned payload is never stored, logged, or echoed.
 */
export class SpendCredentialRejectedError extends NotReceiveCapableError {
  constructor(message = 'This is a spend/pay code, not a receive address. Scan the Receive code.') {
    super(message);
    this.name = 'SpendCredentialRejectedError';
  }
}

/**
 * TRANSIENT: the LNURL endpoint could not be reached or answered with a
 * server-side failure (DNS, network error, timeout, HTTP 5xx/429). A caller
 * may retry later; definitive failures stay {@link InvalidLightningAddressError}.
 */
export class LightningEndpointUnreachableError extends InvalidLightningAddressError {
  constructor(message: string) {
    super(message);
    this.name = 'LightningEndpointUnreachableError';
  }
}

/**
 * The target is not a public https endpoint (SSRF guard): non-https,
 * credentials in the URL, or a loopback / private / link-local / CGNAT /
 * metadata address or a local-only hostname.
 */
export class UnsafeLnurlTargetError extends InvalidLightningAddressError {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeLnurlTargetError';
  }
}

/**
 * We cannot tell whether the payment happened: the provider answered "pending", returned a
 * server error after the request was sent, or said something we do not recognise. Distinct from
 * {@link PaymentFailedError} on purpose — a failed payment may be retried, an unknown one must
 * NOT be (it may already have settled, and a retry fetches a fresh invoice, so nothing would
 * stop it paying twice). The payout engine keeps such a payout `sending` and flags it for a human.
 */
export class PaymentOutcomeUnknownError extends Error {
  constructor(
    message: string,
    /**
     * The provider-side reference (the Lightning payment hash) of the attempt, when one exists,
     * so the payout can keep it and a person can look the payment up. Never a secret.
     */
    public readonly paymentRef?: string,
  ) {
    super(message);
    this.name = 'PaymentOutcomeUnknownError';
  }
}

/** HTTP statuses that mean "the request was rejected, nothing was attempted" (not 408/429/5xx). */
export function isDefinitiveHttpRejection(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

/** The provider (Blink/LNbits/Fedimint) returned a payment failure. */
export class PaymentFailedError extends Error {
  constructor(
    message: string,
    public readonly providerCode?: string,
  ) {
    super(message);
    this.name = 'PaymentFailedError';
  }
}

/**
 * The invoice a destination's LNURL server returned is not for the amount we asked for (or is
 * not a valid invoice, or is outside the wallet's own sendable range). Paying it could move
 * more than the payout, so it is refused before any money moves. Never carries the invoice.
 */
export class InvoiceMismatchError extends PaymentFailedError {
  constructor(message: string) {
    super(message, 'invoice_mismatch');
    this.name = 'InvoiceMismatchError';
  }
}
