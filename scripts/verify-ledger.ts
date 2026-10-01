// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Standalone hash-chain verifier (D-19, ROADMAP M4-8, docs/LEDGER.md).
 *
 * Recomputes every `entry_hash` link from genesis and checks each signed
 * checkpoint. Exit code: 0 = verified, 1 = the ledger fails verification,
 * 2 = bad usage or unreadable input.
 *
 *   # an auditor with an export — no database needed
 *   pnpm exec tsx scripts/verify-ledger.ts ledger-export.json --public-key <base64>
 *
 *   # the operator, against the live database (DATABASE_URL)
 *   pnpm exec tsx scripts/verify-ledger.ts [--windowed] [--public-key <base64>]
 *   pnpm exec tsx scripts/verify-ledger.ts --export ledger-export.json
 *
 * Signatures are checked against `--public-key` (pin the programme's key out of
 * band). Without one, the key shipped in the export — or derived from
 * `LEDGER_SIGNING_KEY` in database mode — is used and flagged as not pinned.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import type { VerifyLedgerResult } from '@/lib/ledger/chain';
import { LedgerDumpError, parseDump, verifyDump } from '@/lib/ledger/dump';
import { configuredPublicKey } from '@/lib/ledger/signing';

const USAGE = `Usage:
  verify-ledger <export.json|export.ndjson> [--public-key <base64>]
  verify-ledger [--windowed] [--public-key <base64>] [--export <file>]   (uses DATABASE_URL)`;

function report(result: VerifyLedgerResult, keySource: string): void {
  if (!result.ok) {
    console.error(`FAIL  broken at seq ${result.brokenAt}: ${result.reason}`);
    return;
  }
  const scope = result.mode === 'windowed' ? 'entries after the last checkpoint' : 'entries';
  console.log(`Chain        OK — ${result.count} ${scope}, through seq ${result.throughSeq}`);
  console.log(`Head hash    ${result.headHash ?? '(empty ledger)'}`);
  const { verified, signaturesChecked } = result.checkpoints;
  console.log(
    signaturesChecked
      ? `Checkpoints  OK — ${verified} verified, signatures checked (${keySource})`
      : `Checkpoints  ${verified} matched the chain; signatures NOT checked (no public key)`,
  );
}

async function verifyFromDatabase(
  windowed: boolean,
  publicKey: string | null,
  exportPath: string | undefined,
): Promise<VerifyLedgerResult> {
  const { closeDb, getDb } = await import('@/lib/db/client');
  const db = getDb();
  try {
    if (exportPath) {
      const { asc } = await import('drizzle-orm');
      const { ledgerCheckpoints, ledgerEntries } = await import('@/lib/db/schema');
      const entries = await db.select().from(ledgerEntries).orderBy(asc(ledgerEntries.seq));
      const checkpoints = await db
        .select()
        .from(ledgerCheckpoints)
        .orderBy(asc(ledgerCheckpoints.throughSeq));
      writeFileSync(exportPath, JSON.stringify({ entries, checkpoints, publicKey }, null, 2));
      console.log(`Exported ${entries.length} entries, ${checkpoints.length} checkpoints`);
    }
    const { verifyLedger } = await import('@/lib/ledger/checkpoints');
    return await verifyLedger(db, { mode: windowed ? 'windowed' : 'full', publicKey });
  } finally {
    await closeDb();
  }
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      'public-key': { type: 'string' },
      windowed: { type: 'boolean' },
      export: { type: 'string' },
    },
  });
  const [file] = positionals;
  if (positionals.length > 1 || (file && (values.windowed || values.export))) {
    console.error(USAGE);
    return 2;
  }

  let result: VerifyLedgerResult;
  let keySource = 'pinned with --public-key';
  if (file) {
    const dump = parseDump(readFileSync(file, 'utf8'));
    const publicKey = values['public-key'] ?? dump.publicKey;
    if (!values['public-key'] && publicKey) {
      keySource = 'key from the export itself — NOT independently pinned';
    }
    result = await verifyDump(dump, publicKey);
  } else {
    const publicKey = values['public-key'] ?? configuredPublicKey();
    if (!values['public-key'] && publicKey) {
      keySource = 'key derived from LEDGER_SIGNING_KEY';
    }
    result = await verifyFromDatabase(Boolean(values.windowed), publicKey, values.export);
  }

  report(result, keySource);
  return result.ok ? 0 : 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof LedgerDumpError ? `Bad input: ${error.message}` : error);
    process.exitCode = 2;
  });
