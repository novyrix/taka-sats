// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it, vi } from 'vitest';

const settings = { lightning: { float_provider: 'fake' } };
vi.mock('@/lib/config', () => ({ getSettings: () => settings }));

import { FakeLightningProvider, FakeProviderForbiddenError, getLightningProvider } from './index';

describe('getLightningProvider() — the demo "fake" rail', () => {
  beforeEach(() => {
    settings.lightning.float_provider = 'fake';
  });

  it('is available outside production, as one shared instance', () => {
    const first = getLightningProvider({ NODE_ENV: 'development' });
    expect(first).toBeInstanceOf(FakeLightningProvider);
    expect(getLightningProvider({ NODE_ENV: 'test' })).toBe(first);
    expect(getLightningProvider({})).toBe(first);
  });

  it('is refused in production — it would mark payouts paid without paying', () => {
    expect(() => getLightningProvider({ NODE_ENV: 'production' })).toThrow(
      FakeProviderForbiddenError,
    );
    expect(() =>
      getLightningProvider({ NODE_ENV: 'production', TAKASATS_ALLOW_FAKE_PROVIDER: 'yes' }),
    ).toThrow(FakeProviderForbiddenError);
    expect(() =>
      getLightningProvider({ NODE_ENV: 'production', TAKASATS_ALLOW_FAKE_PROVIDER: '' }),
    ).toThrow(FakeProviderForbiddenError);
  });

  it('is allowed in production only with the explicit opt-in', () => {
    expect(
      getLightningProvider({ NODE_ENV: 'production', TAKASATS_ALLOW_FAKE_PROVIDER: 'true' }),
    ).toBeInstanceOf(FakeLightningProvider);
  });

  it('never affects a real provider selection', () => {
    settings.lightning.float_provider = 'fedimint';
    (settings.lightning as Record<string, unknown>).fedimint = { federation_invite: '' };
    expect(getLightningProvider({ NODE_ENV: 'production' }).kind).toBe('fedimint');
  });
});
