// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from 'vitest';
import { sats } from '@/lib/money';
import { PaymentFailedError, PaymentOutcomeUnknownError } from './errors';
import { FakeLightningProvider } from './FakeLightningProvider';
import type { LightningProvider } from './LightningProvider';
import {
  type CheckLine,
  credentialChecks,
  maskAddress,
  type ProviderCheckInput,
  redact,
  runProviderCheck,
  validatePaySats,
} from './providerCheck';

const SETTINGS = { blinkWalletId: 'w-1', lnbitsWalletId: '' };
const ADDRESS = 'sample-card@wallet.example';

function run(overrides: Partial<ProviderCheckInput> = {}) {
  const lines: CheckLine[] = [];
  const confirm = vi.fn(async (_question: string) => true);
  const input: ProviderCheckInput = {
    provider: new FakeLightningProvider(),
    env: {},
    settings: SETTINGS,
    interactive: true,
    confirm,
    report: (line) => lines.push(line),
    ...overrides,
  };
  return { promise: runProviderCheck(input), lines, confirm };
}

const statusOf = (lines: CheckLine[], name: string) => lines.find((l) => l.name === name)?.status;

/** A provider that behaves like the demo one but whose `pay` we control. */
function withPay(pay: LightningProvider['pay']): LightningProvider {
  const fake = new FakeLightningProvider();
  return {
    kind: 'blink',
    pay,
    resolveReceiveAddress: (a) => fake.resolveReceiveAddress(a),
    getFloatBalance: () => fake.getFloatBalance(),
  };
}
const BLINK_ENV = { BLINK_API_KEY: 'blink_SECRET_VALUE_123' };

describe('runProviderCheck: read only', () => {
  it('passes against the demo provider and sends nothing', async () => {
    const provider = new FakeLightningProvider();
    const { promise, lines } = run({ provider, address: ADDRESS });
    const result = await promise;
    expect(result.exitCode).toBe(0);
    expect(result.payment).toBe('none');
    expect(statusOf(lines, 'float balance')).toBe('PASS');
    expect(statusOf(lines, 'receive address')).toBe('PASS');
    expect(statusOf(lines, 'payment')).toBe('SKIP');
    expect(provider.paymentsSent()).toHaveLength(0);
  });

  it('a withdraw (LNURLw) code is not receive capable', async () => {
    const { promise, lines } = run({ address: 'withdraw@wallet.example' });
    expect((await promise).exitCode).toBe(1);
    expect(statusOf(lines, 'receive address')).toBe('FAIL');
  });

  it('missing Blink credentials fail before anything is called, naming them without values', async () => {
    const provider = withPay(vi.fn());
    const balance = vi.spyOn(provider, 'getFloatBalance');
    const { promise, lines } = run({ provider, settings: { ...SETTINGS, blinkWalletId: '' } });
    const result = await promise;
    expect(result.exitCode).toBe(1);
    const credentials = lines.find((l) => l.name === 'credentials');
    expect(credentials?.status).toBe('FAIL');
    expect(credentials?.detail).toContain('BLINK_API_KEY');
    expect(credentials?.detail).toContain('float_wallet_id');
    expect(balance).not.toHaveBeenCalled();
  });

  it('never prints a secret value, even if a provider message echoes it', async () => {
    const provider = withPay(vi.fn());
    provider.getFloatBalance = async () => {
      throw new Error(`denied for key ${BLINK_ENV.BLINK_API_KEY}`);
    };
    const { promise, lines } = run({ provider, env: BLINK_ENV });
    await promise;
    const everything = JSON.stringify(lines);
    expect(everything).not.toContain('SECRET_VALUE');
    expect(everything).toContain('[redacted]');
  });

  it('a balance read failure stops the run', async () => {
    const provider = withPay(vi.fn());
    provider.getFloatBalance = async () => {
      throw new PaymentFailedError('not found');
    };
    const { promise, lines } = run({ provider, env: BLINK_ENV, address: ADDRESS });
    expect((await promise).exitCode).toBe(1);
    expect(statusOf(lines, 'receive address')).toBeUndefined();
  });
});

describe('runProviderCheck: the supervised payment', () => {
  it('does nothing without BOTH amount and destination (the CLI enforces the pairing)', async () => {
    const pay = vi.fn();
    const { promise } = run({ provider: withPay(pay), env: BLINK_ENV });
    await promise;
    expect(pay).not.toHaveBeenCalled();
  });

  it.each([0, -1, 101, 1.5, Number.NaN, 1_000_000])(
    'refuses %s sats, before any call',
    async (n) => {
      const pay = vi.fn();
      const provider = withPay(pay);
      const balance = vi.spyOn(provider, 'getFloatBalance');
      const { promise, lines } = run({ provider, env: BLINK_ENV, pay: { sats: n, to: ADDRESS } });
      const result = await promise;
      expect(result.exitCode).toBe(1);
      expect(statusOf(lines, 'request')).toBe('FAIL');
      expect(pay).not.toHaveBeenCalled();
      expect(balance).not.toHaveBeenCalled();
    },
  );

  it('accepts exactly the 1 and 100 sat limits', () => {
    expect(validatePaySats(1)).toBeNull();
    expect(validatePaySats(100)).toBeNull();
    expect(validatePaySats(101)).not.toBeNull();
  });

  it('pays after the operator types yes and reports PAID with the reference', async () => {
    const provider = new FakeLightningProvider({ initialFloatSats: 10_000 });
    const { promise, lines, confirm } = run({ provider, pay: { sats: 5, to: ADDRESS } });
    const result = await promise;
    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm.mock.calls[0]?.[0]).toContain('5 sats');
    expect(confirm.mock.calls[0]?.[0]).not.toContain(ADDRESS); // the address is masked
    expect(result.payment).toBe('paid');
    expect(result.exitCode).toBe(0);
    expect(provider.paymentsSent()).toHaveLength(1);
    expect(statusOf(lines, 'payment')).toBe('PASS');
    expect(statusOf(lines, 'provider lookup')).toBe('PASS');
    expect(statusOf(lines, 'balance after')).toBe('PASS');
    expect(result.paymentRef).toBe(provider.paymentsSent()[0]?.paymentRef);
  });

  it('sends nothing when the operator does not confirm', async () => {
    const provider = new FakeLightningProvider();
    const confirm = vi.fn(async (_question: string) => false);
    const { promise, lines } = run({ provider, confirm, pay: { sats: 5, to: ADDRESS } });
    const result = await promise;
    expect(provider.paymentsSent()).toHaveLength(0);
    expect(result.payment).toBe('none');
    expect(statusOf(lines, 'payment')).toBe('SKIP');
  });

  it('refuses to pay without a terminal unless --yes-i-am-sure is given', async () => {
    const provider = new FakeLightningProvider();
    const { promise, lines, confirm } = run({
      provider,
      interactive: false,
      pay: { sats: 5, to: ADDRESS },
    });
    expect((await promise).exitCode).toBe(1);
    expect(confirm).not.toHaveBeenCalled();
    expect(statusOf(lines, 'payment')).toBe('FAIL');
    expect(provider.paymentsSent()).toHaveLength(0);

    const again = run({
      provider,
      interactive: false,
      assumeYes: true,
      pay: { sats: 5, to: ADDRESS },
    });
    expect((await again.promise).payment).toBe('paid');
    expect(again.confirm).not.toHaveBeenCalled();
  });

  it('never pays a destination that is not receive capable', async () => {
    const provider = new FakeLightningProvider();
    const { promise } = run({
      provider,
      assumeYes: true,
      pay: { sats: 5, to: 'withdraw@wallet.example' },
    });
    const result = await promise;
    expect(result.exitCode).toBe(1);
    expect(provider.paymentsSent()).toHaveLength(0);
  });

  it('refuses when the float cannot cover it, before asking', async () => {
    const provider = new FakeLightningProvider({ initialFloatSats: 3 });
    const { promise, confirm } = run({ provider, pay: { sats: 5, to: ADDRESS } });
    expect((await promise).exitCode).toBe(1);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('classifies a definite refusal as FAILED (exit 1)', async () => {
    const provider = withPay(
      vi.fn(async () => {
        throw new PaymentFailedError('no route', 'ROUTE_FINDING_ERROR');
      }),
    );
    const { promise, lines } = run({
      provider,
      env: BLINK_ENV,
      assumeYes: true,
      pay: { sats: 5, to: ADDRESS },
    });
    const result = await promise;
    expect(result.payment).toBe('failed');
    expect(result.exitCode).toBe(1);
    expect(lines.find((l) => l.name === 'payment')?.detail).toContain('FAILED');
  });

  it('classifies an unknown outcome as UNKNOWN (exit 3), tells the operator not to retry, and keeps the hash', async () => {
    const hash = 'cd'.repeat(32);
    const provider = withPay(
      vi.fn(async () => {
        throw new PaymentOutcomeUnknownError('pending', hash);
      }),
    );
    const { promise, lines } = run({
      provider,
      env: BLINK_ENV,
      assumeYes: true,
      pay: { sats: 5, to: ADDRESS },
    });
    const result = await promise;
    expect(result.payment).toBe('unknown');
    expect(result.exitCode).toBe(3);
    expect(result.paymentRef).toBe(hash);
    const detail = lines.find((l) => l.name === 'payment')?.detail ?? '';
    expect(detail).toContain('UNKNOWN');
    expect(detail).toContain('Do NOT send it again');
    expect(detail).toContain(hash);
  });

  it('an unexpected error is UNKNOWN, never FAILED (we cannot say the money did not move)', async () => {
    const provider = withPay(
      vi.fn(async () => {
        throw new TypeError('socket hang up');
      }),
    );
    const { promise } = run({
      provider,
      env: BLINK_ENV,
      assumeYes: true,
      pay: { sats: 5, to: ADDRESS },
    });
    const result = await promise;
    expect(result.payment).toBe('unknown');
    expect(result.exitCode).toBe(3);
  });

  it('does not ask the provider to look up a payment that definitely failed', async () => {
    const lookup = vi.fn();
    const provider = {
      ...withPay(
        vi.fn(async () => {
          throw new PaymentFailedError('refused');
        }),
      ),
      lookupPayment: lookup,
    };
    const { promise } = run({
      provider,
      env: BLINK_ENV,
      assumeYes: true,
      pay: { sats: 5, to: ADDRESS },
    });
    await promise;
    expect(lookup).not.toHaveBeenCalled();
  });

  it('warns when the provider lookup disagrees with a "paid" classification', async () => {
    const provider: LightningProvider = {
      ...withPay(
        vi.fn(async (_d, amount) => ({
          paymentRef: 'ref',
          amount,
          feeSats: sats(0),
          settledAt: new Date(),
        })),
      ),
      lookupPayment: async () => ({ state: 'not_found', matches: 0 }),
    };
    const { promise, lines } = run({
      provider,
      env: BLINK_ENV,
      assumeYes: true,
      pay: { sats: 5, to: ADDRESS },
    });
    await promise;
    expect(statusOf(lines, 'provider lookup')).toBe('WARN');
  });
});

describe('helpers', () => {
  it('credentialChecks names what each provider needs and reports presence only', () => {
    expect(credentialChecks('fake', {}, SETTINGS)).toEqual([]);
    const blink = credentialChecks('blink', BLINK_ENV, SETTINGS);
    expect(blink.every((c) => c.present)).toBe(true);
    expect(JSON.stringify(blink)).not.toContain('SECRET_VALUE');
    expect(credentialChecks('lnbits', {}, SETTINGS).every((c) => !c.present)).toBe(true);
    expect(credentialChecks('fedimint', {}, SETTINGS)[0]?.present).toBe(false);
  });

  it('redact removes every known secret and ignores short values', () => {
    const env = { BLINK_API_KEY: 'blink_abcdef', LNBITS_ADMIN_KEY: 'xy' };
    expect(redact('key blink_abcdef used xy', env)).toBe('key [redacted] used xy');
  });

  it('maskAddress hides most of an address', () => {
    expect(maskAddress('sample-card@wallet.example')).toBe('sa***@wallet.example');
    expect(maskAddress('lnurl1dp68gurn8ghj7')).toBe('lnurl1***');
  });
});
