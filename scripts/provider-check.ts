// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Operator tool: check the configured wallet provider, safely.
 *
 *   pnpm provider:check                                  credentials + balance
 *   pnpm provider:check --address you@wallet.example     + prove a receive address works
 *   pnpm provider:check --pay-sats 1 --to you@wallet.example
 *                                                        + send ONE tiny supervised payment
 *
 * Read only unless both --pay-sats (1 to 100) and --to are given AND you type "yes" at the prompt
 * (or pass --yes-i-am-sure for a non interactive run). Secrets are never printed.
 * Optional: --env-file <path> to load KEY=value lines first (otherwise the process environment).
 *
 * Exit code: 0 all good, 1 a check failed, 3 the payment outcome is UNKNOWN (do not retry it),
 * 2 bad usage.
 */

import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { getSettings } from '@/lib/config';
import { getLightningProvider } from '@/lib/lightning';
import { type CheckLine, runProviderCheck } from '@/lib/lightning/providerCheck';

const USAGE = `Usage: provider-check [--address <receive address>] [--pay-sats <1..100> --to <receive address>]
                      [--yes-i-am-sure] [--env-file <path>]`;

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      address: { type: 'string' },
      'pay-sats': { type: 'string' },
      to: { type: 'string' },
      'yes-i-am-sure': { type: 'boolean', default: false },
      'env-file': { type: 'string' },
      help: { type: 'boolean', default: false },
    },
    strict: true,
  });
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  if (values['env-file']) {
    if (!existsSync(values['env-file'])) {
      console.error(`env file not found: ${values['env-file']}`);
      return 2;
    }
    process.loadEnvFile(values['env-file']);
  }

  const paySatsRaw = values['pay-sats'];
  if ((paySatsRaw === undefined) !== (values.to === undefined)) {
    console.error(`--pay-sats and --to must be given together.\n${USAGE}`);
    return 2;
  }
  const pay =
    paySatsRaw !== undefined && values.to !== undefined
      ? { sats: Number(paySatsRaw), to: values.to }
      : undefined;

  const { lightning } = getSettings();
  const provider = getLightningProvider(process.env);
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);

  const print = (line: CheckLine) => {
    console.log(`${line.status.padEnd(4)}  ${line.name.padEnd(16)} ${line.detail}`);
  };

  const result = await runProviderCheck({
    provider,
    env: process.env,
    settings: {
      blinkWalletId: lightning.blink.float_wallet_id,
      lnbitsWalletId: lightning.lnbits.float_wallet_id,
    },
    address: values.address,
    pay,
    assumeYes: values['yes-i-am-sure'],
    interactive,
    confirm: async (question) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        return (await rl.question(question)).trim() === 'yes';
      } finally {
        rl.close();
      }
    },
    report: print,
  });

  console.log('');
  if (result.payment === 'unknown') {
    console.log(
      'RESULT: payment outcome UNKNOWN. Do not send it again. Check the wallet history first.',
    );
  } else if (result.exitCode === 0) {
    console.log(
      `RESULT: all checks passed${result.payment === 'paid' ? ' and the payment was PAID' : ''}.`,
    );
  } else {
    console.log('RESULT: a check FAILED. See above.');
  }
  return result.exitCode;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(2);
  },
);
