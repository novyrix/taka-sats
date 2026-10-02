// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Password hashing for `supervisors.password_hash` (M2-1). `scrypt` from
 * `node:crypto` — no extra dependency, and Node's own docs recommend it for
 * password storage. Stored as `<saltHex>:<hashHex>`. Never logged (Code
 * Style Guide §9.6) — callers must not include this column in any log line.
 *
 * Zero framework imports (D-04).
 */

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

const SALT_BYTES = 16;
const KEY_LENGTH = 64;

/** The shortest password an account may be created with (a floor, not a target). */
export const MIN_PASSWORD_LENGTH = 12;

const WEAK = new Set([
  'password1234',
  'passwordpassword',
  '123456789012',
  'qwertyuiop12',
  'takasats1234',
  'welcome12345',
]);

/**
 * Refuse an obviously weak password when an account is created. Not a strength meter: it stops the
 * placeholder, repeated-character and common-password cases that a guessing attack tries first.
 * @returns a reason, or `null` when the password is acceptable.
 */
export function weakPasswordReason(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `use at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (new Set(password).size < 5) {
    return 'use more than a few different characters';
  }
  if (WEAK.has(password.toLowerCase())) {
    return 'that password is too common';
  }
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) {
    return false;
  }

  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const derived = (await scryptAsync(password, salt, expected.length)) as Buffer;

  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
