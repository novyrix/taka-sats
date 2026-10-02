// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { hashPassword, MIN_PASSWORD_LENGTH, verifyPassword, weakPasswordReason } from './password';

describe('hashPassword / verifyPassword', () => {
  it('verifies the correct password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('wrong password', hash)).toBe(false);
  });

  it('produces a different hash each time (random salt)', async () => {
    const a = await hashPassword('same password');
    const b = await hashPassword('same password');
    expect(a).not.toBe(b);
    expect(await verifyPassword('same password', a)).toBe(true);
    expect(await verifyPassword('same password', b)).toBe(true);
  });

  it('rejects a malformed stored value instead of throwing', async () => {
    expect(await verifyPassword('anything', 'not-a-valid-hash')).toBe(false);
    expect(await verifyPassword('anything', '')).toBe(false);
  });
});

describe('weakPasswordReason', () => {
  it('accepts a long, varied password', () => {
    expect(weakPasswordReason('correct horse battery staple')).toBeNull();
    expect(weakPasswordReason('uky24UhvvgLSfAqRZ9Vz')).toBeNull();
  });

  it.each([
    ['', 'short'],
    ['short1!', 'short'],
    ['a'.repeat(MIN_PASSWORD_LENGTH - 1), 'one under the floor'],
    ['aaaaaaaaaaaaaaaa', 'one repeated character'],
    ['abababababababab', 'two characters'],
    ['Password1234', 'common'],
    ['TAKASATS1234', 'common, any case'],
  ])('refuses %j (%s)', (password) => {
    expect(weakPasswordReason(password)).not.toBeNull();
  });
});
