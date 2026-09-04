// SPDX-License-Identifier: AGPL-3.0-only

import { bech32 } from 'bech32';
import { describe, expect, it } from 'vitest';
import { InvalidLightningAddressError } from './errors';
import {
  decodeLnurlBech32,
  isLightningAddress,
  isLnurlBech32,
  lightningAddressToUrl,
  normalizeToResolvableUrl,
} from './lnurl';

function encodeLnurl(url: string): string {
  const bytes = new TextEncoder().encode(url);
  const words = bech32.toWords(bytes);
  return bech32.encode('lnurl', words, 4000);
}

describe('isLightningAddress', () => {
  it('accepts a well-formed address', () => {
    expect(isLightningAddress('collector@blink.sv')).toBe(true);
    expect(isLightningAddress('a.b_c-d@sub.domain.co')).toBe(true);
  });

  it('rejects malformed input', () => {
    expect(isLightningAddress('not-an-address')).toBe(false);
    expect(isLightningAddress('@blink.sv')).toBe(false);
    expect(isLightningAddress('collector@')).toBe(false);
    expect(isLightningAddress('collector@blink')).toBe(false);
  });
});

describe('lightningAddressToUrl', () => {
  it('builds the LUD-16 well-known URL', () => {
    expect(lightningAddressToUrl('afribit@blink.sv')).toBe(
      'https://blink.sv/.well-known/lnurlp/afribit',
    );
  });

  it('throws on a non-address', () => {
    expect(() => lightningAddressToUrl('nope')).toThrow(InvalidLightningAddressError);
  });
});

describe('LNURL bech32 round-trip', () => {
  it('decodes back to the original URL', () => {
    const url = 'https://blink.sv/.well-known/lnurlp/afribit';
    const encoded = encodeLnurl(url);
    expect(isLnurlBech32(encoded)).toBe(true);
    expect(decodeLnurlBech32(encoded)).toBe(url);
  });

  it('rejects a non-lnurl bech32 prefix', () => {
    const words = bech32.toWords(new TextEncoder().encode('https://example.com'));
    const encoded = bech32.encode('lnbc', words, 4000);
    expect(() => decodeLnurlBech32(encoded)).toThrow(InvalidLightningAddressError);
  });

  it('rejects garbage', () => {
    expect(() => decodeLnurlBech32('not-bech32-at-all')).toThrow(InvalidLightningAddressError);
  });
});

describe('normalizeToResolvableUrl', () => {
  it('handles a Lightning Address', () => {
    expect(normalizeToResolvableUrl('afribit@blink.sv')).toBe(
      'https://blink.sv/.well-known/lnurlp/afribit',
    );
  });

  it('handles an lnurl bech32 string, with or without a lightning: prefix', () => {
    const url = 'https://lnbits.example/lnurlp/abc123';
    const encoded = encodeLnurl(url);
    expect(normalizeToResolvableUrl(encoded)).toBe(url);
    expect(normalizeToResolvableUrl(`lightning:${encoded}`)).toBe(url);
    expect(normalizeToResolvableUrl(`LIGHTNING:${encoded}`)).toBe(url);
  });

  it('passes an already-resolvable https URL through', () => {
    const url = 'https://blink.sv/.well-known/lnurlp/afribit';
    expect(normalizeToResolvableUrl(url)).toBe(url);
  });

  it('rejects unrecognised input', () => {
    expect(() => normalizeToResolvableUrl('totally-unrecognised')).toThrow(
      InvalidLightningAddressError,
    );
  });
});
