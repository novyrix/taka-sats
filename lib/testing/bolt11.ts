// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Structurally valid BOLT11 invoices for tests: correct human-readable part, timestamp, a payment
 * hash tag and a signature-sized tail. The signature is NOT valid (nothing here verifies one);
 * the amount and payment-hash readers in `lib/lightning/bolt11` are what these exercise.
 * Tests only.
 */

import { createHash } from 'node:crypto';
import { bech32 } from 'bech32';

/** A deterministic preimage and its payment hash for a test seed. */
export function testPreimage(seed: string): { preimage: string; paymentHash: string } {
  const preimage = createHash('sha256').update(`preimage:${seed}`).digest();
  return {
    preimage: preimage.toString('hex'),
    paymentHash: createHash('sha256').update(preimage).digest('hex'),
  };
}

/** An invoice for exactly `amountSats` whose payment hash is `paymentHash` (64 hex). */
export function testInvoice(amountSats: number, paymentHash: string): string {
  const timestamp = new Array<number>(7).fill(0);
  const hashWords = bech32.toWords(Buffer.from(paymentHash, 'hex')); // 52 words
  const tag = [1, Math.floor(hashWords.length / 32), hashWords.length % 32, ...hashWords];
  const signature = new Array<number>(104).fill(1);
  return bech32.encode(`lnbc${amountSats * 10}n`, [...timestamp, ...tag, ...signature], 4000);
}
