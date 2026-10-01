// SPDX-License-Identifier: AGPL-3.0-only

import { bech32 } from 'bech32';
import { describe, expect, it } from 'vitest';
import { bolt11AmountMsat } from './bolt11';

/** A syntactically valid bech32 string with the given human-readable part (data is irrelevant here). */
const invoiceWith = (hrp: string): string => bech32.encode(hrp, new Array(40).fill(7), 4000);

describe('bolt11AmountMsat', () => {
  // Amounts from the BOLT11 spec's examples and its multiplier table.
  it.each([
    ['lnbc2500u', 250_000_000n], // 2500 µBTC = 250,000 sat
    ['lnbc20m', 2_000_000_000n], // 20 mBTC = 2,000,000 sat
    ['lnbc1', 100_000_000_000n], // 1 BTC
    ['lnbc10n', 1_000n], // 10 nBTC = 1 sat
    ['lnbc1000p', 100n], // 1000 pBTC = 100 msat
    ['lnbc10p', 1n], // the smallest payable: 1 msat
    ['lntb1u', 100_000n], // testnet, 1 µBTC = 100 sat
    ['lnbcrt500u', 50_000_000n], // regtest
  ])('%s → %s msat', (hrp, expected) => {
    expect(bolt11AmountMsat(invoiceWith(hrp))).toBe(expected);
  });

  it('returns null for a zero-amount (payer-chooses) invoice', () => {
    expect(bolt11AmountMsat(invoiceWith('lnbc'))).toBeNull();
  });

  it('accepts a lightning: prefix and upper case', () => {
    const invoice = invoiceWith('lnbc10n');
    expect(bolt11AmountMsat(`lightning:${invoice}`)).toBe(1_000n);
    expect(bolt11AmountMsat(invoice.toUpperCase())).toBe(1_000n);
  });

  it('refuses a sub-millisatoshi amount and a leading zero', () => {
    expect(() => bolt11AmountMsat(invoiceWith('lnbc1p'))).toThrow(/whole number of millisatoshis/);
    expect(() => bolt11AmountMsat(invoiceWith('lnbc05u'))).toThrow(/leading zero/);
  });

  it('refuses anything that is not a BOLT11 invoice', () => {
    for (const bad of [
      '',
      'lnbc1...',
      'not an invoice',
      'lnurl1dp68gurn8ghj7mrww4exctnrdakj7', // an LNURL, valid bech32, wrong hrp
      invoiceWith('lnxx10u'),
      'lnbc10u1' + 'q'.repeat(30), // bad checksum
    ]) {
      expect(() => bolt11AmountMsat(bad)).toThrow();
    }
  });

  it('does not overflow on an absurd amount (BigInt, no float)', () => {
    expect(bolt11AmountMsat(invoiceWith('lnbc99999999999999999999'))).toBe(
      99999999999999999999n * 100_000_000_000n,
    );
  });
});
