// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Small helpers for reading Postgres error codes. Drizzle wraps a driver error
 * in `DrizzleQueryError` with the real `postgres.js` error on `.cause`, so a
 * naive `error.code` check misses it — unwrap recursively.
 */

const UNIQUE_VIOLATION = '23505';

/** The Postgres `SQLSTATE`, whether raised directly or wrapped by Drizzle (`.cause`). */
export function pgErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  if ('code' in error && typeof error.code === 'string') {
    return error.code;
  }
  if ('cause' in error) {
    return pgErrorCode((error as { cause?: unknown }).cause);
  }
  return undefined;
}

export function isUniqueViolation(error: unknown): boolean {
  return pgErrorCode(error) === UNIQUE_VIOLATION;
}
