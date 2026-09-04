// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password';

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
