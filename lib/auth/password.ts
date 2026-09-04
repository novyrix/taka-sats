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
