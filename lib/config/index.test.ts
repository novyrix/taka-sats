// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { loadSettings, PROVISIONING_ACKNOWLEDGEMENT } from './index';

// No `env` argument here would inherit the real process env; pass an explicit
// empty map so tests are hermetic and only exercise the file + given overrides.
const NO_ENV: Record<string, string | undefined> = {};

describe('loadSettings()', () => {
  it('loads and validates the committed default config', () => {
    const settings = loadSettings({ env: NO_ENV });

    expect(settings.programme.fiat_currency).toBe('KES');
    expect(settings.custody.default_address_source).toBe('byo');
    expect(settings.custody.provisioning_enabled).toBe(false);
    expect(settings.lightning.float_provider).toBe('blink');
    expect(settings.money.exchange_sources.length).toBeGreaterThanOrEqual(2);
  });

  it('deep-freezes the result', () => {
    const settings = loadSettings({ env: NO_ENV });
    expect(Object.isFrozen(settings)).toBe(true);
    expect(Object.isFrozen(settings.payouts)).toBe(true);
  });

  it('applies a valid environment override', () => {
    const settings = loadSettings({
      env: { TAKASATS__PAYOUTS__SECOND_SIGNOFF_THRESHOLD_SATS: '75000' },
    });
    expect(settings.payouts.second_signoff_threshold_sats).toBe(75000);
  });

  it('coerces JSON-shaped env values', () => {
    const settings = loadSettings({
      env: { TAKASATS__MONEY__EXCHANGE_SOURCES: '["kraken","yadio","coingecko"]' },
    });
    expect(settings.money.exchange_sources).toEqual(['kraken', 'yadio', 'coingecko']);
  });

  it('fails the boot on an out-of-range override, naming the key', () => {
    expect(() =>
      loadSettings({ env: { TAKASATS__PAYOUTS__SECOND_SIGNOFF_THRESHOLD_SATS: '-5' } }),
    ).toThrow(/Invalid Taka Sats configuration[\s\S]*second_signoff_threshold_sats/);
  });

  it('rejects an unknown top-level key', () => {
    expect(() => loadSettings({ env: { TAKASATS__NONSENSE__KEY: '1' } })).toThrow(
      /Invalid Taka Sats configuration/,
    );
  });

  it('rejects enabling provisioning without the G1 acknowledgement string', () => {
    expect(() =>
      loadSettings({ env: { TAKASATS__CUSTODY__PROVISIONING_ENABLED: 'true' } }),
    ).toThrow(/provisioning_ack/);
  });

  it('accepts provisioning when the acknowledgement matches', () => {
    const settings = loadSettings({
      env: {
        TAKASATS__CUSTODY__PROVISIONING_ENABLED: 'true',
        TAKASATS__CUSTODY__PROVISIONING_ACK: JSON.stringify(PROVISIONING_ACKNOWLEDGEMENT),
      },
    });
    expect(settings.custody.provisioning_enabled).toBe(true);
  });
});
