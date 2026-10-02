// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Write a proof pack for one session: a folder a funder or auditor can read and re-check.
 *
 *   pnpm proof:pack --session <session id> --out ./proof-2026-10-02
 *   (on a server: docker compose run --rm tools scripts/proof-pack.ts --session <id> --out /tmp/proof)
 *
 * The pack holds events.csv (collector public codes only), the ledger and its signed checkpoints,
 * the verification result, a manifest of file hashes and a README on how to re-check it. It never
 * includes wallet addresses, phone numbers or names. Set LEDGER_SIGNING_KEY (or pass --public-key)
 * so checkpoint signatures are checked; without it only the hash links are.
 *
 * Exit code: 0 when the ledger verifies, 1 when it does not, 2 for bad usage.
 */

import { parseArgs } from 'node:util';
import { closeDb, getDb } from '@/lib/db/client';
import { buildProofPack, ProofPackError } from '@/lib/proof/pack';

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      session: { type: 'string' },
      out: { type: 'string' },
      'public-key': { type: 'string' },
    },
    strict: true,
  });
  if (!values.session || !values.out) {
    console.error(
      'Usage: proof-pack --session <session id> --out <folder> [--public-key <base64>]',
    );
    return 2;
  }
  const db = getDb();
  try {
    const result = await buildProofPack(db, {
      sessionId: values.session,
      outDir: values.out,
      ...(values['public-key'] ? { publicKey: values['public-key'] } : {}),
    });
    console.log(
      `Proof pack written to ${result.outDir}: ${result.eventCount} collection(s), ledger ${result.ledgerOk ? 'OK' : 'FAILED'}.`,
    );
    console.log(`Files: ${result.files.join(', ')}`);
    return result.ledgerOk ? 0 : 1;
  } finally {
    await closeDb();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof ProofPackError ? error.message : 'proof-pack failed');
    process.exitCode = 2;
  });
