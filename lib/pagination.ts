// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Keyset cursors for newest-first lists ordered by `(timestamp, id)`. A cursor is the exact
 * timestamp of the last row — as Postgres prints it (µs precision; a JS `Date` would round to
 * ms and skip rows) — plus its id, base64url-encoded so clients treat it as opaque.
 *
 * Use with `(col, id) < (cursor.ts::timestamptz, cursor.id::uuid)` and select
 * `col::text` as the value passed to {@link encodeCursor}.
 */

export class CursorError extends Error {
  constructor() {
    super('cursor is not valid — pass the nextCursor of a previous response');
    this.name = 'CursorError';
  }
}

export function encodeCursor(timestampText: string, id: string): string {
  return Buffer.from(JSON.stringify([timestampText, id])).toString('base64url');
}

export function decodeCursor(cursor: string): { readonly ts: string; readonly id: string } {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      Array.isArray(parsed) &&
      typeof parsed[0] === 'string' &&
      typeof parsed[1] === 'string' &&
      !Number.isNaN(Date.parse(parsed[0])) &&
      /^[0-9a-f-]{36}$/i.test(parsed[1])
    ) {
      return { ts: parsed[0], id: parsed[1] };
    }
  } catch {
    // fall through
  }
  throw new CursorError();
}

export const PAGE_DEFAULT = 50;
export const PAGE_MAX = 100;
