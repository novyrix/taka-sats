// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The content hash (`payload_hash`, REQUIREMENTS §11.1). The client computes a
 * SHA-256 over a **canonical** JSON serialisation of a fact at capture time,
 * so the record is bound to its content before it ever reaches the server. The
 * server later chains it (`entry_hash = sha256(seq || type || payload_hash ||
 * prev)`) — that part is M4.
 *
 * Canonical form: object keys sorted lexicographically at every level, no
 * insignificant whitespace, arrays kept in order, `undefined` members dropped,
 * numbers via the JS number→string rule (finite only). This must stay stable —
 * a change here re-hashes every event, so it is covered by a fixed vector test.
 *
 * Framework-free (D-04); uses the Web Crypto `crypto.subtle`, present in
 * browsers and Node ≥ 20.
 */

export type Canonicalizable =
  | string
  | number
  | boolean
  | null
  | readonly Canonicalizable[]
  | { readonly [key: string]: Canonicalizable | undefined };

/** Deterministic JSON: sorted keys, no whitespace, dropped `undefined`. */
export function canonicalize(value: Canonicalizable): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`canonicalize: non-finite number (${value})`);
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalize(v as Canonicalizable)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, Canonicalizable | undefined>)
    .filter((entry): entry is [string, Canonicalizable] => entry[1] !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`;
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Lowercase hex SHA-256 of a UTF-8 string. */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return toHex(digest);
}

/**
 * Lowercase hex SHA-256 of raw bytes — the on-device photo hash (D-12, M3-5).
 * Computed from the image bytes before any upload.
 */
export async function sha256HexBytes(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const buffer = bytes instanceof Uint8Array ? (bytes.buffer as ArrayBuffer) : bytes;
  return toHex(await crypto.subtle.digest('SHA-256', buffer));
}

/** Lowercase hex SHA-256 of the canonical serialisation of `payload`. */
export async function contentHash(payload: Canonicalizable): Promise<string> {
  return sha256Hex(canonicalize(payload));
}
