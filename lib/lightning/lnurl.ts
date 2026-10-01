// SPDX-License-Identifier: AGPL-3.0-only

/**
 * LNURL / Lightning Address normalisation (LUD-01, LUD-16) — pure, no I/O.
 *
 * Turns whatever a collector's QR or a submitted string contains into the
 * single HTTPS URL a provider fetches to learn whether the code is
 * receive-capable (§7.1 Path A step 2). Before returning a URL it enforces the
 * static half of the SSRF / spend-credential guard: only a public https
 * target, never a known spend-link host. Actually fetching that URL (and the
 * DNS half of the guard), and rejecting a resolved `withdrawRequest`, happen in
 * `lnurlPay.ts` — this file never makes a network call, so it is fully
 * unit-testable. Zero framework imports (D-04).
 *
 * Error messages never carry the scanned code — it may be a spend or withdraw
 * credential — only a hostname or a generic description.
 */

import { bech32 } from 'bech32';
import {
  InvalidLightningAddressError,
  SpendCredentialRejectedError,
  UnsafeLnurlTargetError,
} from './errors';

// LNURL bech32 strings encode a full URL and routinely exceed bech32's
// default 90-character limit — decode with a generous ceiling instead.
const BECH32_LIMIT = 4000;

const LIGHTNING_ADDRESS_PATTERN =
  /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;

/** Names that only resolve on a private network (reserved / intranet conventions). */
const LOCAL_ONLY_SUFFIXES = [
  'localhost',
  'local',
  'localdomain',
  'internal',
  'intranet',
  'corp',
  'lan',
  'home',
  'home.arpa',
  'private',
] as const;

/** Special-purpose IPv4 blocks (base, prefix length) a public LNURL host never uses. */
const NON_PUBLIC_IPV4: readonly (readonly [string, number])[] = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, incl. the 169.254.169.254 metadata endpoint
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.88.99.0', 24], // 6to4 relay
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 3], // multicast, reserved, broadcast
];

/** Static policy for what a code may point at. `spendLinkHosts` is `lightning.spend_link_hosts`. */
export type LnurlPolicy = {
  readonly spendLinkHosts: readonly string[];
};

export function isLightningAddress(input: string): boolean {
  return LIGHTNING_ADDRESS_PATTERN.test(input.trim());
}

export function isLnurlBech32(input: string): boolean {
  return /^lnurl1[02-9ac-hj-np-z]+$/i.test(input.trim());
}

function parseIpv4(text: string): number | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (!match) {
    return null;
  }
  const octets = match.slice(1).map(Number);
  if (octets.some((octet) => octet > 255)) {
    return null;
  }
  const [a = 0, b = 0, c = 0, d = 0] = octets;
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

/** Eight 16-bit groups, or null when `text` is not a valid IPv6 literal. */
function parseIpv6(text: string): number[] | null {
  let rest = text.toLowerCase();
  const zone = rest.indexOf('%');
  if (zone !== -1) {
    rest = rest.slice(0, zone);
  }

  const lastColon = rest.lastIndexOf(':');
  const tail = rest.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = parseIpv4(tail);
    if (v4 === null) {
      return null;
    }
    rest = `${rest.slice(0, lastColon + 1)}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }

  const halves = rest.split('::');
  if (halves.length > 2) {
    return null;
  }
  const head = halves[0] ? halves[0].split(':') : [];
  const end = halves[1] ? halves[1].split(':') : [];
  const compressed = halves.length === 2;
  const fill = 8 - head.length - end.length;
  if (compressed ? fill < 1 : head.length !== 8) {
    return null;
  }

  const groups = [...head, ...(compressed ? Array<string>(fill).fill('0') : []), ...end];
  if (!groups.every((group) => /^[0-9a-f]{1,4}$/.test(group))) {
    return null;
  }
  return groups.map((group) => parseInt(group, 16));
}

/**
 * True only for a publicly routable IPv4/IPv6 literal. Fails closed: anything
 * unparseable, and every special-purpose range, is "not public". IPv6 is
 * allowed only inside global unicast `2000::/3` minus documentation, 6to4 and
 * protocol-assignment blocks — which also rules out `::1`, `fc00::/7`,
 * `fe80::/10`, IPv4-mapped (`::ffff:a.b.c.d`) and NAT64 forms.
 */
export function isPublicIp(address: string): boolean {
  const v4 = parseIpv4(address);
  if (v4 !== null) {
    return !NON_PUBLIC_IPV4.some(([base, bits]) => {
      const mask = (0xffffffff << (32 - bits)) >>> 0;
      return (v4 & mask) >>> 0 === parseIpv4(base);
    });
  }

  const groups = parseIpv6(address);
  const [first = 0, second = 0] = groups ?? [];
  if (groups === null || (first & 0xe000) !== 0x2000) {
    return false;
  }
  return !(
    first === 0x2002 || // 6to4
    (first === 0x2001 && (second < 0x200 || second === 0xdb8)) || // protocol assignments, documentation
    (first === 0x3fff && second < 0x1000) // documentation
  );
}

/** The hostname of `url` for use in an error message, or a generic stand-in. */
export function describeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'the Lightning endpoint';
  }
}

function matchesHost(host: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => {
    const wanted = pattern.toLowerCase().replace(/\.$/, '');
    return host === wanted || host.endsWith(`.${wanted}`);
  });
}

/**
 * Parse `raw` and enforce the static policy: not a known spend-link host, and
 * a public https target with no embedded credentials. Returns the parsed URL;
 * callers fetch `url.href`, the form that was actually validated.
 *
 * @throws {SpendCredentialRejectedError} for a configured spend-link host.
 * @throws {UnsafeLnurlTargetError} for anything but a public https endpoint.
 * @throws {InvalidLightningAddressError} if it is not a URL at all.
 */
export function parseLnurlUrl(raw: string, policy: LnurlPolicy): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new InvalidLightningAddressError('The Lightning code does not contain a valid URL');
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (matchesHost(host, policy.spendLinkHosts)) {
    throw new SpendCredentialRejectedError();
  }
  if (url.protocol !== 'https:') {
    throw new UnsafeLnurlTargetError('Only https Lightning endpoints are allowed');
  }
  if (url.username !== '' || url.password !== '') {
    throw new UnsafeLnurlTargetError(`Credentials in a Lightning URL are not allowed (${host})`);
  }

  // The WHATWG parser has already normalised IPv4 forms (`127.1`, `0x7f.1`,
  // `2130706433`) to dotted quads and wrapped IPv6 literals in brackets.
  const isIpLiteral = host.startsWith('[') || parseIpv4(host) !== null;
  const unsafe = isIpLiteral
    ? !isPublicIp(host.replace(/^\[|\]$/g, ''))
    : !host.includes('.') ||
      LOCAL_ONLY_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  if (unsafe) {
    throw new UnsafeLnurlTargetError(`${host} is not a public internet host`);
  }
  return url;
}

/** `name@domain` → the LUD-16 well-known LNURL-pay URL. */
export function lightningAddressToUrl(address: string): string {
  const trimmed = address.trim();
  if (!isLightningAddress(trimmed)) {
    throw new InvalidLightningAddressError('Not a valid Lightning Address');
  }
  const [localPart, domain] = trimmed.split('@');
  return `https://${domain}/.well-known/lnurlp/${encodeURIComponent(localPart ?? '')}`;
}

/** Decode an `lnurl1…` bech32 string to the URL it encodes (LUD-01). */
export function decodeLnurlBech32(encoded: string): string {
  let decoded: { prefix: string; words: number[] };
  try {
    decoded = bech32.decode(encoded.trim(), BECH32_LIMIT);
  } catch {
    throw new InvalidLightningAddressError('Could not decode the LNURL bech32 string');
  }

  if (decoded.prefix.toLowerCase() !== 'lnurl') {
    throw new InvalidLightningAddressError('Not an LNURL bech32 string');
  }

  let url: string;
  try {
    const bytes = Uint8Array.from(bech32.fromWords(decoded.words));
    url = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new InvalidLightningAddressError('The LNURL payload is not valid text');
  }
  if (!/^https?:\/\//i.test(url)) {
    throw new InvalidLightningAddressError('Decoded LNURL payload is not an http(s) URL');
  }
  return url;
}

/**
 * Normalise whatever a collector's QR or a submitted string contains — a
 * Lightning Address, an `lnurl1…` bech32 string (optionally prefixed
 * `lightning:`), or an already-resolvable `https://` LNURL-pay URL — into
 * the URL to fetch next, after the static {@link parseLnurlUrl} checks.
 *
 * A spend-link URL (e.g. a Paybee card's Pay side) is rejected, never
 * converted into a receive address.
 */
export function normalizeToResolvableUrl(raw: string, policy: LnurlPolicy): string {
  const trimmed = raw.trim().replace(/^lightning:/i, '');

  let candidate: string;
  if (isLightningAddress(trimmed)) {
    candidate = lightningAddressToUrl(trimmed);
  } else if (isLnurlBech32(trimmed)) {
    candidate = decodeLnurlBech32(trimmed);
  } else if (/^https?:\/\//i.test(trimmed)) {
    candidate = trimmed;
  } else {
    throw new InvalidLightningAddressError(
      'Unrecognised Lightning code — not a Lightning Address, LNURL, or https URL',
    );
  }
  return parseLnurlUrl(candidate, policy).href;
}
