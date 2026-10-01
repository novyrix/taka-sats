// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A collector's public code and the credential reference built from it (D-24,
 * ADR-0017). Pure and framework-free, so the PWA can import it directly
 * (`@/lib/collectors/reference`) to parse a scanned QR / read NFC payload.
 *
 * A credential — QR, NFC tag, printed card — carries `takasats:<public_code>`:
 * an identity pointer only, never a payment target. The code itself is not a
 * secret and grants nothing (payouts always go to the registered destination).
 */

export const COLLECTOR_REF_SCHEME = 'takasats:';

/** `TS-0042`, `TS-KBR-0042`: prefix, optional site, then at least four digits. */
const PUBLIC_CODE_PATTERN = /^[A-Z]{1,6}(?:-[A-Z]{2,6})?-\d{4,}$/;

const MIN_DIGITS = 4;

export type PublicCodeParts = {
  readonly prefix: string;
  readonly siteCode?: string | undefined;
  /** The sequence value allocated for this collector. */
  readonly seq: number;
};

export function formatPublicCode({ prefix, siteCode, seq }: PublicCodeParts): string {
  const digits = String(seq).padStart(MIN_DIGITS, '0');
  return siteCode ? `${prefix}-${siteCode}-${digits}` : `${prefix}-${digits}`;
}

export function isPublicCode(value: string): boolean {
  return PUBLIC_CODE_PATTERN.test(value);
}

/** The payload to put in a QR code or write to an NFC tag. */
export function formatCollectorRef(publicCode: string): string {
  return `${COLLECTOR_REF_SCHEME}${publicCode}`;
}

/** The https form of a reference (`<base>/c/<code>`), for places that need a link. */
export function collectorRefUrl(publicBaseUrl: string, publicCode: string): string {
  return `${publicBaseUrl}/c/${publicCode}`;
}

/**
 * Extract the public code from anything a supervisor might scan or type: a
 * `takasats:` reference, a `<base>/c/<code>` link, or the bare code. Returns the
 * normalised (upper-case) code, or `null` if the input is not a collector
 * reference — never throws, so a caller can fall through to alias search.
 */
export function parseCollectorRef(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > 200) {
    return null;
  }

  let candidate = trimmed;
  if (candidate.toLowerCase().startsWith(COLLECTOR_REF_SCHEME)) {
    candidate = candidate.slice(COLLECTOR_REF_SCHEME.length);
  } else if (/^https?:\/\//i.test(candidate)) {
    // Only the `/c/<code>` path of any host — the host is not trusted or compared.
    const match = /^https?:\/\/[^/?#]+\/c\/([^/?#]+)\/?(?:[?#].*)?$/i.exec(candidate);
    if (!match?.[1]) {
      return null;
    }
    candidate = match[1];
  }

  const code = candidate.trim().toUpperCase();
  return isPublicCode(code) ? code : null;
}
