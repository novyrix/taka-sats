// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Locale negotiation (REQUIREMENTS §15, D-15).
 *
 * Resolution order for a request is: the supervisor's stored `locale` (once
 * auth lands in M2) → the `Accept-Language` header → the programme default.
 * This module owns only the header step and the fallback; it takes the
 * supported list and default as arguments so nothing operational is hardcoded
 * (D-21). Zero framework imports (D-04).
 */

type WeightedTag = {
  readonly tag: string;
  readonly quality: number;
};

function parseAcceptLanguage(header: string): WeightedTag[] {
  return header
    .split(',')
    .map((part, index): WeightedTag | undefined => {
      const [rawTag, ...params] = part.trim().split(';');
      const tag = rawTag?.trim().toLowerCase();
      if (!tag) {
        return undefined;
      }

      const qParam = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      const parsedQ = qParam ? Number.parseFloat(qParam.slice(2)) : 1;
      const quality = Number.isFinite(parsedQ) ? parsedQ : 1;

      // Preserve source order for equal q-values by nudging with the index.
      return { tag, quality: quality - index * 1e-6 };
    })
    .filter((entry): entry is WeightedTag => entry !== undefined && entry.quality > 0)
    .sort((a, b) => b.quality - a.quality);
}

/**
 * Pick the best supported locale for an `Accept-Language` header value.
 * Matches on the primary subtag (`en-GB` → `en`), case-insensitively.
 * Returns `fallback` when the header is absent or matches nothing; `fallback`
 * is returned as-is and is expected to be a member of `supported`.
 */
export function negotiateLocale(
  acceptLanguage: string | null | undefined,
  supported: readonly string[],
  fallback: string,
): string {
  if (!acceptLanguage) {
    return fallback;
  }

  const supportedByPrimary = new Map(supported.map((locale) => [locale.toLowerCase(), locale]));

  for (const { tag } of parseAcceptLanguage(acceptLanguage)) {
    const exact = supportedByPrimary.get(tag);
    if (exact) {
      return exact;
    }

    const primary = tag.split('-')[0];
    const byPrimary = primary ? supportedByPrimary.get(primary) : undefined;
    if (byPrimary) {
      return byPrimary;
    }
  }

  return fallback;
}
