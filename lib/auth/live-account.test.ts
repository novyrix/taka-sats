// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from 'vitest';
import { type AccountLookup, refreshSessionToken } from './live-account';

const token = (over: Record<string, unknown> = {}) => ({
  sub: 'user-1',
  role: 'admin',
  locale: 'en',
  ...over,
});

describe('refreshSessionToken', () => {
  it('ends the session when the account is deactivated or gone', async () => {
    const lookup: AccountLookup = async () => null;
    expect(await refreshSessionToken(token(), lookup)).toBeNull();
  });

  it('uses the role stored now, not the one the token was issued with (a demoted admin loses admin at once)', async () => {
    const lookup: AccountLookup = async () => ({ role: 'supervisor', locale: 'sw' });
    const refreshed = await refreshSessionToken(token({ role: 'admin' }), lookup);
    expect(refreshed).toMatchObject({ sub: 'user-1', role: 'supervisor', locale: 'sw' });
  });

  it('asks the partner table for a partner token and the staff table otherwise', async () => {
    const lookup = vi.fn<AccountLookup>(async () => ({ role: 'partner', locale: 'en' }));
    await refreshSessionToken(token({ role: 'partner' }), lookup);
    await refreshSessionToken(token({ role: 'supervisor' }), lookup);
    expect(lookup.mock.calls).toEqual([
      ['user-1', true],
      ['user-1', false],
    ]);
  });

  it('keeps the token when the lookup fails, so an outage does not sign everyone out, and reports it', async () => {
    const seen: unknown[] = [];
    const original = token();
    const result = await refreshSessionToken(
      original,
      async () => {
        throw new Error('connection refused');
      },
      (e) => seen.push(e),
    );
    expect(result).toBe(original);
    expect(seen).toHaveLength(1);
  });

  it('refuses a token with no subject', async () => {
    const lookup = vi.fn<AccountLookup>();
    expect(await refreshSessionToken({ role: 'admin' }, lookup)).toBeNull();
    expect(lookup).not.toHaveBeenCalled();
  });

  it('refuses a stored role that is not a real role', async () => {
    const lookup = (async () => ({ role: 'root', locale: 'en' })) as unknown as AccountLookup;
    expect(await refreshSessionToken(token(), lookup)).toBeNull();
  });
});
