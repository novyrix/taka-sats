// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The operator's provider check (`pnpm provider:check`). Runs, in order:
 *   1. credentials and settings are present (never printed),
 *   2. the float balance can be read,
 *   3. a receive address resolves and is receive capable,
 *   4. OPTIONALLY one supervised payment of 1 to 100 sats, only after an explicit human "yes".
 * and says how the payment was classified: paid, failed, or unknown (do not retry, look it up).
 *
 * This module has no I/O of its own: the provider, the prompt and the output are passed in, so it
 * is tested against the demo provider and the real CLI (`scripts/provider-check.ts`) is a thin shell.
 */

import { sats } from '@/lib/money';
import { PaymentFailedError, PaymentOutcomeUnknownError } from './errors';
import type { LightningProvider, PaymentLookup } from './LightningProvider';

export const MIN_CHECK_PAYMENT_SATS = 1;
export const MAX_CHECK_PAYMENT_SATS = 100;

export type CheckStatus = 'PASS' | 'FAIL' | 'WARN' | 'SKIP';
export type CheckLine = {
  readonly name: string;
  readonly status: CheckStatus;
  readonly detail: string;
};

/** How the optional payment ended. `none` = no payment was attempted. */
export type PaymentClassification = 'none' | 'paid' | 'failed' | 'unknown';

export type ProviderCheckInput = {
  readonly provider: LightningProvider;
  /** Process environment (read for credentials only; values are never printed). */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Non-secret settings the credential check needs. */
  readonly settings: { readonly blinkWalletId: string; readonly lnbitsWalletId: string };
  /** `--address`: a receive address to resolve (defaults to `pay.to` when paying). */
  readonly address?: string | undefined;
  /** `--pay-sats` and `--to`. Present only when the operator asked for a payment. */
  readonly pay?: { readonly sats: number; readonly to: string } | undefined;
  /** `--yes-i-am-sure`: skip the prompt (for a non interactive run). */
  readonly assumeYes?: boolean | undefined;
  /** Whether a human can be asked (stdin is a terminal). */
  readonly interactive: boolean;
  /** Ask the operator to type yes; resolves true only for exactly "yes". */
  readonly confirm: (question: string) => Promise<boolean>;
  /** Called as each line is produced, so the CLI can stream it. */
  readonly report: (line: CheckLine) => void;
  /** Injectable for tests. */
  readonly now?: () => Date;
};

export type ProviderCheckResult = {
  readonly lines: readonly CheckLine[];
  readonly payment: PaymentClassification;
  /** The provider reference of the payment, when there is one. */
  readonly paymentRef?: string;
  /** 0 all good, 1 a check failed, 3 the payment outcome is unknown. */
  readonly exitCode: 0 | 1 | 3;
};

/** What each provider needs before it can do anything. Values are checked, never returned. */
export function credentialChecks(
  kind: LightningProvider['kind'],
  env: Readonly<Record<string, string | undefined>>,
  settings: ProviderCheckInput['settings'],
): { name: string; present: boolean; hint: string }[] {
  const set = (name: string) => Boolean(env[name]?.trim());
  switch (kind) {
    case 'blink':
      return [
        {
          name: 'BLINK_API_KEY',
          present: set('BLINK_API_KEY'),
          hint: 'create a Read+Write key in the Blink dashboard',
        },
        {
          name: 'lightning.blink.float_wallet_id',
          present: Boolean(settings.blinkWalletId.trim()),
          hint: 'the BTC wallet id, in config/settings.toml',
        },
      ];
    case 'lnbits':
      return [
        {
          name: 'LNBITS_ADMIN_KEY',
          present: set('LNBITS_ADMIN_KEY'),
          hint: 'the float wallet admin key',
        },
        {
          name: 'lightning.lnbits.float_wallet_id',
          present: Boolean(settings.lnbitsWalletId.trim()),
          hint: 'the float wallet id, in config/settings.toml',
        },
      ];
    case 'fedimint':
      return [
        {
          name: 'fedimint provider',
          present: false,
          hint: 'payments are not implemented for Fedimint',
        },
      ];
    case 'fake':
      return [];
  }
}

/** Replace every secret value found in `text`, so nothing leaks through an error message. */
export function redact(text: string, env: Readonly<Record<string, string | undefined>>): string {
  let out = text;
  for (const name of [
    'BLINK_API_KEY',
    'LNBITS_ADMIN_KEY',
    'LNBITS_USERMANAGER_KEY',
    'LEDGER_SIGNING_KEY',
  ]) {
    const value = env[name];
    if (value && value.length >= 4) {
      out = out.split(value).join('[redacted]');
    }
  }
  return out;
}

/** `ab***@wallet.example`: enough to recognise the target, not enough to reuse it. */
export function maskAddress(address: string): string {
  const at = address.lastIndexOf('@');
  if (at > 0) {
    return `${address.slice(0, Math.min(2, at))}***${address.slice(at)}`;
  }
  return `${address.slice(0, 6)}***`;
}

export function validatePaySats(value: number): string | null {
  if (
    !Number.isInteger(value) ||
    value < MIN_CHECK_PAYMENT_SATS ||
    value > MAX_CHECK_PAYMENT_SATS
  ) {
    return `--pay-sats must be a whole number from ${MIN_CHECK_PAYMENT_SATS} to ${MAX_CHECK_PAYMENT_SATS}`;
  }
  return null;
}

function describeLookup(found: PaymentLookup): string {
  const parts = [`state ${found.state}`];
  if (found.matches !== undefined) {
    parts.push(`${found.matches} matching send${found.matches === 1 ? '' : 's'}`);
  }
  if (found.proofVerified !== undefined) {
    parts.push(`proof of payment ${found.proofVerified ? 'verified' : 'not verified'}`);
  }
  if (found.feeSats !== undefined) {
    parts.push(`fee ${found.feeSats} sats`);
  }
  return parts.join(', ');
}

export async function runProviderCheck(input: ProviderCheckInput): Promise<ProviderCheckResult> {
  const { provider, env } = input;
  const lines: CheckLine[] = [];
  const add = (name: string, status: CheckStatus, detail: string) => {
    const line = { name, status, detail: redact(detail, env) };
    lines.push(line);
    input.report(line);
  };
  const message = (error: unknown) => (error instanceof Error ? error.message : 'unknown error');
  const done = (payment: PaymentClassification, paymentRef?: string): ProviderCheckResult => ({
    lines,
    payment,
    ...(paymentRef ? { paymentRef } : {}),
    exitCode: payment === 'unknown' ? 3 : lines.some((l) => l.status === 'FAIL') ? 1 : 0,
  });

  // Validate the request before touching anything.
  if (input.pay) {
    const problem = validatePaySats(input.pay.sats);
    if (problem) {
      add('request', 'FAIL', problem);
      return done('none');
    }
  }

  add(
    'provider',
    provider.kind === 'fake' ? 'WARN' : 'PASS',
    provider.kind === 'fake'
      ? 'fake (demo rail): nothing real is checked and no money can move'
      : `${provider.kind}`,
  );

  // 1. Credentials and settings.
  const needed = credentialChecks(provider.kind, env, input.settings);
  const missing = needed.filter((c) => !c.present);
  if (needed.length === 0) {
    add('credentials', 'SKIP', 'the demo provider needs none');
  } else if (missing.length > 0) {
    // The key is there but the wallet id is not: help the operator find it instead of just failing.
    const onlyWalletMissing = missing.every((c) => c.name.endsWith('float_wallet_id'));
    if (onlyWalletMissing && provider.discoverWallets) {
      try {
        const wallets = await provider.discoverWallets();
        add(
          'wallets',
          'WARN',
          `wallets on this account: ${wallets.map((w) => `${w.currency} id ${w.id} (${w.balance} ${w.currency === 'BTC' ? 'sats' : 'minor units'})`).join('; ') || 'none'}. ` +
            'Set the BTC wallet id as TAKASATS__LIGHTNING__BLINK__FLOAT_WALLET_ID (or lightning.blink.float_wallet_id)',
        );
      } catch (error) {
        add('wallets', 'WARN', `could not list the wallets: ${message(error)}`);
      }
    }
    add(
      'credentials',
      'FAIL',
      `missing: ${missing.map((c) => `${c.name} (${c.hint})`).join('; ')}`,
    );
    return done('none');
  } else {
    add(
      'credentials',
      'PASS',
      `${needed.map((c) => c.name).join(', ')} present (values not shown)`,
    );
  }

  // 2. Balance.
  let balanceBefore: number | null = null;
  try {
    const balance = await provider.getFloatBalance();
    balanceBefore = balance.available;
    add('float balance', 'PASS', `${balance.available} sats available`);
  } catch (error) {
    add('float balance', 'FAIL', `could not read the balance: ${message(error)}`);
    return done('none');
  }

  // 3. A receive address.
  const address = input.address ?? input.pay?.to;
  if (!address) {
    add('receive address', 'SKIP', 'no --address given');
  } else {
    try {
      const resolved = await provider.resolveReceiveAddress(address);
      if (resolved.receiveCapable) {
        add(
          'receive address',
          'PASS',
          `${maskAddress(address)} is receive capable (accepts ${resolved.minSendableSats} to ${resolved.maxSendableSats} sats)`,
        );
      } else {
        add('receive address', 'FAIL', `${maskAddress(address)} is not receive capable`);
        return done('none');
      }
    } catch (error) {
      add('receive address', 'FAIL', `${maskAddress(address)} was refused: ${message(error)}`);
      return done('none');
    }
  }

  // 4. The optional supervised payment.
  if (!input.pay) {
    add(
      'payment',
      'SKIP',
      'not requested (add --pay-sats N --to <address> to send a tiny real payment)',
    );
    return done('none');
  }
  const { pay } = input;
  if (balanceBefore !== null && pay.sats > balanceBefore) {
    add('payment', 'FAIL', `the float (${balanceBefore} sats) cannot cover ${pay.sats} sats`);
    return done('none');
  }

  const real = provider.kind !== 'fake';
  const question =
    `About to send ${pay.sats} sat${pay.sats === 1 ? '' : 's'} to ${maskAddress(pay.to)} using ${provider.kind}` +
    `${real ? ' (REAL FUNDS)' : ' (demo rail, nothing is sent)'}. Type yes to continue: `;
  let approved = input.assumeYes === true;
  if (!approved) {
    if (!input.interactive) {
      add(
        'payment',
        'FAIL',
        'a payment needs a person to type yes; run in a terminal, or pass --yes-i-am-sure',
      );
      return done('none');
    }
    approved = await input.confirm(question);
  }
  if (!approved) {
    add('payment', 'SKIP', 'not confirmed, nothing was sent');
    return done('none');
  }

  const now = (input.now ?? (() => new Date()))();
  const key = `provider-check-${now
    .toISOString()
    .replace(/[-:.TZ]/g, '')
    .slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`;

  let paymentRef: string | undefined;
  let classification: PaymentClassification;
  try {
    const result = await provider.pay({ lnurlOrAddress: pay.to }, sats(pay.sats), key);
    paymentRef = result.paymentRef;
    classification = 'paid';
    add(
      'payment',
      'PASS',
      `classified PAID. reference ${result.paymentRef}, fee ${result.feeSats} sats, key ${key}`,
    );
  } catch (error) {
    if (error instanceof PaymentOutcomeUnknownError) {
      paymentRef = error.paymentRef;
      classification = 'unknown';
      add(
        'payment',
        'WARN',
        `classified UNKNOWN. Do NOT send it again. It may have gone out: check the wallet history for key ${key}` +
          `${error.paymentRef ? ` or payment hash ${error.paymentRef}` : ''}. (${message(error)})`,
      );
    } else if (error instanceof PaymentFailedError) {
      classification = 'failed';
      add('payment', 'FAIL', `classified FAILED, nothing was sent. (${message(error)})`);
    } else {
      // Not a provider verdict (a bug or an unexpected fault): we cannot say the money did not move.
      classification = 'unknown';
      add(
        'payment',
        'WARN',
        `classified UNKNOWN (unexpected error). Check the wallet history for key ${key}. (${message(error)})`,
      );
    }
  }

  // Ask the provider what it recorded, when it can say.
  if (classification !== 'failed' && provider.lookupPayment) {
    try {
      const found = await provider.lookupPayment({
        ...(paymentRef ? { paymentRef } : {}),
        idempotencyKey: key,
      });
      const agrees =
        (classification === 'paid' && found.state === 'paid') ||
        (classification === 'unknown' && found.state !== 'not_found');
      add('provider lookup', agrees ? 'PASS' : 'WARN', describeLookup(found));
    } catch (error) {
      add('provider lookup', 'WARN', `could not look the payment up: ${message(error)}`);
    }
  } else if (classification !== 'failed') {
    add(
      'provider lookup',
      'SKIP',
      'this provider cannot look a payment up; check its own dashboard',
    );
  }

  // The balance should have moved by the amount plus the fee.
  if (classification === 'paid' && balanceBefore !== null) {
    try {
      const after = (await provider.getFloatBalance()).available;
      const spent = balanceBefore - after;
      add(
        'balance after',
        spent >= pay.sats ? 'PASS' : 'WARN',
        `${after} sats (down ${spent}, expected at least ${pay.sats})`,
      );
    } catch (error) {
      add('balance after', 'WARN', `could not re-read the balance: ${message(error)}`);
    }
  }

  return done(classification, paymentRef);
}
