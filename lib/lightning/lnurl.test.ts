// SPDX-License-Identifier: AGPL-3.0-only

import { bech32 } from 'bech32';
import { describe, expect, it } from 'vitest';
import {
  InvalidLightningAddressError,
  NotReceiveCapableError,
  SpendCredentialRejectedError,
  UnsafeLnurlTargetError,
} from './errors';
import {
  decodeLnurlBech32,
  isLightningAddress,
  isLnurlBech32,
  isPublicIp,
  lightningAddressToUrl,
  normalizeToResolvableUrl,
} from './lnurl';

const POLICY = { spendLinkHosts: ['card.paybee.buzz'] };
const normalize = (raw: string) => normalizeToResolvableUrl(raw, POLICY);

function encodeLnurl(url: string): string {
  const bytes = new TextEncoder().encode(url);
  const words = bech32.toWords(bytes);
  return bech32.encode('lnurl', words, 4000);
}

function messageOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('expected the call to throw');
}

describe('isLightningAddress', () => {
  it('accepts a well-formed address', () => {
    expect(isLightningAddress('collector@example.com')).toBe(true);
    expect(isLightningAddress('a.b_c-d@sub.domain.co')).toBe(true);
  });

  it('rejects malformed input', () => {
    expect(isLightningAddress('not-an-address')).toBe(false);
    expect(isLightningAddress('@example.com')).toBe(false);
    expect(isLightningAddress('collector@')).toBe(false);
    expect(isLightningAddress('collector@blink')).toBe(false);
  });
});

describe('lightningAddressToUrl', () => {
  it('builds the LUD-16 well-known URL', () => {
    expect(lightningAddressToUrl('sample-wallet@example.com')).toBe(
      'https://example.com/.well-known/lnurlp/sample-wallet',
    );
  });

  it('throws on a non-address, without echoing it', () => {
    expect(() => lightningAddressToUrl('nope-secret')).toThrow(InvalidLightningAddressError);
    expect(messageOf(() => lightningAddressToUrl('nope-secret'))).not.toContain('secret');
  });
});

describe('LNURL bech32 round-trip', () => {
  it('decodes back to the original URL', () => {
    const url = 'https://example.com/.well-known/lnurlp/sample-wallet';
    const encoded = encodeLnurl(url);
    expect(isLnurlBech32(encoded)).toBe(true);
    expect(decodeLnurlBech32(encoded)).toBe(url);
  });

  it('rejects a non-lnurl bech32 prefix', () => {
    const words = bech32.toWords(new TextEncoder().encode('https://example.com'));
    const encoded = bech32.encode('lnbc', words, 4000);
    expect(() => decodeLnurlBech32(encoded)).toThrow(InvalidLightningAddressError);
    expect(messageOf(() => decodeLnurlBech32(encoded))).not.toContain(encoded);
  });

  it('rejects garbage', () => {
    expect(() => decodeLnurlBech32('not-bech32-at-all')).toThrow(InvalidLightningAddressError);
  });

  it('rejects a payload that is not valid UTF-8 text', () => {
    const encoded = bech32.encode('lnurl', bech32.toWords(Uint8Array.from([0xff, 0xfe])), 4000);
    expect(() => decodeLnurlBech32(encoded)).toThrow(InvalidLightningAddressError);
  });

  it('never echoes a bech32 string it cannot decode', () => {
    const encoded = encodeLnurl('https://example.com/x');
    const corrupted = `${encoded.slice(0, -1)}${encoded.endsWith('q') ? 'p' : 'q'}`;
    expect(messageOf(() => decodeLnurlBech32(corrupted))).not.toContain(corrupted);
  });
});

describe('normalizeToResolvableUrl', () => {
  it('handles a Lightning Address', () => {
    expect(normalize('sample-wallet@example.com')).toBe(
      'https://example.com/.well-known/lnurlp/sample-wallet',
    );
    expect(normalize('sample-card@flow.paybee.buzz')).toBe(
      'https://flow.paybee.buzz/.well-known/lnurlp/sample-card',
    );
  });

  it('handles an lnurl bech32 string, with or without a lightning: prefix', () => {
    const url = 'https://lnbits.example/lnurlp/abc123';
    const encoded = encodeLnurl(url);
    expect(normalize(encoded)).toBe(url);
    expect(normalize(`lightning:${encoded}`)).toBe(url);
    expect(normalize(`LIGHTNING:${encoded}`)).toBe(url);
  });

  it('passes an already-resolvable https URL through', () => {
    const url = 'https://example.com/.well-known/lnurlp/sample-wallet';
    expect(normalize(url)).toBe(url);
  });

  it('rejects unrecognised input without echoing it', () => {
    expect(() => normalize('totally-unrecognised-secret')).toThrow(InvalidLightningAddressError);
    expect(messageOf(() => normalize('totally-unrecognised-secret'))).not.toContain('secret');
  });
});

describe('spend-credential rejection (the Pay side of a Paybee card)', () => {
  const payUrl = 'https://card.paybee.buzz/sample-card';

  it.each([
    ['the Pay URL', payUrl],
    ['a lightning:-prefixed Pay URL', `lightning:${payUrl}`],
    ['an uppercase host', 'HTTPS://CARD.PAYBEE.BUZZ/sample-card'],
    ['a trailing-dot host', 'https://card.paybee.buzz./x'],
    ['a subdomain of a spend host', 'https://pay.card.paybee.buzz/x'],
    ['a plain-http Pay URL', 'http://card.paybee.buzz/x'],
    ['a Lightning Address on a spend host', 'x@card.paybee.buzz'],
    ['an lnurl bech32 wrapping the Pay URL', encodeLnurl(payUrl)],
    ['a lightning:-prefixed bech32 Pay URL', `lightning:${encodeLnurl(payUrl)}`],
  ])('rejects %s', (_label, raw) => {
    expect(() => normalize(raw)).toThrow(SpendCredentialRejectedError);
  });

  it('is a NotReceiveCapableError with a fixed message that never echoes the payload', () => {
    expect(() => normalize(payUrl)).toThrow(NotReceiveCapableError);
    expect(messageOf(() => normalize(`${payUrl}?token=SECRET`))).toBe(
      'This is a spend/pay code, not a receive address. Scan the Receive code.',
    );
  });

  it('does not reject a sibling host that merely shares the suffix text', () => {
    expect(normalize('https://notcard.paybee.buzz/x')).toBe('https://notcard.paybee.buzz/x');
    expect(normalize('x@flow.paybee.buzz')).toContain('flow.paybee.buzz');
  });

  it('only rejects the hosts it is configured with (case-insensitively)', () => {
    expect(normalizeToResolvableUrl(payUrl, { spendLinkHosts: [] })).toBe(payUrl);
    expect(() =>
      normalizeToResolvableUrl('https://spend.example/x', { spendLinkHosts: ['SPEND.example'] }),
    ).toThrow(SpendCredentialRejectedError);
  });
});

describe('unsafe targets (SSRF)', () => {
  it.each([
    ['plain http', 'http://example.com/.well-known/lnurlp/a'],
    ['credentials in the URL', 'https://user:pw@example.com/x'],
    ['a username only', 'https://user@example.com/x'],
    ['localhost', 'https://localhost/'],
    ['a localhost subdomain', 'https://app.localhost/'],
    ['IPv4 loopback', 'https://127.0.0.1/'],
    ['IPv4 loopback shorthand', 'https://127.1/'],
    ['IPv4 as a decimal integer', 'https://2130706433/'],
    ['IPv4 in hex', 'https://0x7f.0.0.1/'],
    ['IPv6 loopback', 'https://[::1]/'],
    ['IPv4-mapped IPv6 loopback', 'https://[::ffff:127.0.0.1]/'],
    ['IPv6 unique-local', 'https://[fd00::1]/'],
    ['IPv6 link-local', 'https://[fe80::1]/'],
    ['10/8', 'https://10.0.0.5/'],
    ['172.16/12', 'https://172.20.1.1/'],
    ['the metadata endpoint', 'https://169.254.169.254/latest/meta-data'],
    ['192.168/16', 'https://192.168.1.1/'],
    ['CGNAT 100.64/10', 'https://100.64.0.1/'],
    ['0.0.0.0', 'https://0.0.0.0/'],
    ['multicast', 'https://224.0.0.1/'],
    ['a .local host', 'https://intranet.local/'],
    ['a .internal host', 'https://metadata.google.internal/'],
    ['a .lan host', 'https://nas.lan/'],
    ['a single-label host', 'https://intranet/'],
  ])('rejects %s', (_label, raw) => {
    expect(() => normalize(raw)).toThrow(UnsafeLnurlTargetError);
  });

  it('applies to a Lightning Address domain and a bech32-decoded URL too', () => {
    expect(() => normalize('user@127.0.0.1')).toThrow(UnsafeLnurlTargetError);
    expect(() => normalize('user@intranet.local')).toThrow(UnsafeLnurlTargetError);
    expect(() => normalize(encodeLnurl('http://example.com/x'))).toThrow(UnsafeLnurlTargetError);
    expect(() => normalize(encodeLnurl('https://10.1.2.3/x'))).toThrow(UnsafeLnurlTargetError);
    expect(() => normalize(`lightning:${encodeLnurl('https://localhost/x')}`)).toThrow(
      UnsafeLnurlTargetError,
    );
  });

  it('never leaks the URL path, query or credentials into the message', () => {
    const message = messageOf(() => normalize('https://user:hunter2@127.0.0.1/withdraw?k1=SECRET'));
    expect(message).not.toMatch(/hunter2|SECRET|withdraw|k1/);
  });

  it('is an InvalidLightningAddressError so existing handling still catches it', () => {
    expect(() => normalize('https://localhost/')).toThrow(InvalidLightningAddressError);
  });
});

describe('isPublicIp', () => {
  it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111', '2a00:1450:4001::200e'])(
    'accepts %s',
    (address) => {
      expect(isPublicIp(address)).toBe(true);
    },
  );

  it.each([
    '0.0.0.0',
    '127.0.0.1',
    '10.255.255.255',
    '100.127.255.255',
    '169.254.169.254',
    '172.31.0.1',
    '192.168.0.1',
    '198.19.0.1',
    '255.255.255.255',
    '::',
    '::1',
    '::ffff:10.0.0.1',
    '::ffff:7f00:1',
    '64:ff9b::a00:1',
    'fc00::1',
    'fe80::1',
    'fec0::1',
    'ff02::1',
    '2001:db8::1',
    '2002:7f00:1::',
    'not-an-ip',
    '1.2.3',
    '999.1.1.1',
  ])('rejects %s', (address) => {
    expect(isPublicIp(address)).toBe(false);
  });

  it('keeps the range boundaries exact', () => {
    expect(isPublicIp('172.15.255.255')).toBe(true);
    expect(isPublicIp('172.32.0.1')).toBe(true);
    expect(isPublicIp('100.63.255.255')).toBe(true);
    expect(isPublicIp('100.128.0.1')).toBe(true);
  });
});
