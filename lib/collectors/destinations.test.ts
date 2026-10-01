// SPDX-License-Identifier: AGPL-3.0-only

import { bech32 } from 'bech32';
import { describe, expect, it } from 'vitest';
import { normalizeDestination, providerHintFor } from './destinations';

/** The bech32 `lnurl1…` encoding of a URL, as a wallet's LNURL QR carries it. */
const lnurlOf = (url: string): string =>
  bech32.encode('lnurl', bech32.toWords(Buffer.from(url, 'utf8')), 4000);

describe('normalizeDestination — one wallet, one string', () => {
  const WALLET = 'me@blink.sv';

  it.each([
    ['plain', 'me@blink.sv'],
    ['upper-case', 'ME@BLINK.SV'],
    ['padded', '  me@blink.sv\n'],
    ['lightning: prefix', 'lightning:me@blink.sv'],
    ['LUD-16 URL', 'https://blink.sv/.well-known/lnurlp/me'],
    ['LUD-16 URL, shouty host and user', 'https://BLINK.SV/.well-known/lnurlp/ME'],
    ['bech32 of the LUD-16 URL', lnurlOf('https://blink.sv/.well-known/lnurlp/me')],
    ['upper-case bech32', lnurlOf('https://blink.sv/.well-known/lnurlp/me').toUpperCase()],
    [
      'lightning:-prefixed bech32',
      `lightning:${lnurlOf('https://blink.sv/.well-known/lnurlp/me')}`,
    ],
  ])('%s → the same canonical address', (_label, raw) => {
    expect(normalizeDestination(raw)).toEqual({ type: 'lightning_address', address: WALLET });
  });

  it('keeps a non-LUD-16 LNURL-pay URL as its normalised https URL', () => {
    expect(normalizeDestination('https://LNbits.Example/lnurlp/api/v1/lnurl/abc123')).toEqual({
      type: 'lnurl_pay',
      address: 'https://lnbits.example/lnurlp/api/v1/lnurl/abc123',
    });
    expect(normalizeDestination(lnurlOf('https://lnbits.example:8443/lnurlp/abc'))).toEqual({
      type: 'lnurl_pay',
      address: 'https://lnbits.example:8443/lnurlp/abc',
    });
  });

  it('collapses trailing slashes, so /me and /me/ are one wallet', () => {
    for (const raw of [
      'https://blink.sv/.well-known/lnurlp/me/',
      'https://blink.sv/.well-known/lnurlp/me//',
      'https://blink.sv/.well-known/lnurlp/me',
    ]) {
      expect(normalizeDestination(raw)).toEqual({
        type: 'lightning_address',
        address: 'me@blink.sv',
      });
    }
    expect(normalizeDestination('https://lnbits.example/lnurlp/abc/').address).toBe(
      'https://lnbits.example/lnurlp/abc',
    );
  });

  it('refuses a query string or fragment — endless spellings of one wallet would defeat uniqueness', () => {
    for (const raw of [
      'https://blink.sv/.well-known/lnurlp/me?x=1',
      'https://blink.sv/.well-known/lnurlp/me?x=2',
      'https://lnbits.example/lnurlp/abc#frag',
      lnurlOf('https://lnbits.example/lnurlp/abc?p=1'),
    ]) {
      expect(() => normalizeDestination(raw)).toThrow(/query string/);
    }
  });

  it('keeps a port (a different endpoint) as an lnurl_pay URL', () => {
    expect(normalizeDestination('https://blink.sv:8443/.well-known/lnurlp/me')).toEqual({
      type: 'lnurl_pay',
      address: 'https://blink.sv:8443/.well-known/lnurlp/me',
    });
  });

  it('rejects anything that is not a payment code', () => {
    for (const raw of [
      '',
      'Akinyi',
      'takasats:TS-0001',
      'http://blink.sv/.well-known/lnurlp/me',
      'lnurl1notvalid',
    ]) {
      expect(() => normalizeDestination(raw)).toThrow();
    }
  });
});

describe('providerHintFor', () => {
  const hints = { 'flow.paybee.buzz': 'paybee', 'blink.sv': 'blink' };

  it('labels by domain, including subdomains, case-insensitively', () => {
    expect(providerHintFor('sample@flow.paybee.buzz', hints)).toBe('paybee');
    expect(providerHintFor('me@pay.blink.sv', hints)).toBe('blink');
    expect(providerHintFor('ME@BLINK.SV', hints)).toBe('blink');
  });

  it('does not match a look-alike domain, and has no label for an LNURL', () => {
    expect(providerHintFor('me@notblink.sv', hints)).toBeNull();
    expect(providerHintFor('me@blink.sv.evil.test', hints)).toBeNull();
    expect(providerHintFor('https://blink.sv/x', hints)).toBeNull();
  });
});
