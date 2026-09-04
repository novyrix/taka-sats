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
