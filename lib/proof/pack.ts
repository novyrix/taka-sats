// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A proof pack: a folder a funder or auditor can read and re-check without a login or a database.
 * It holds one session's collections as a spreadsheet, the whole ledger (only hashes, never personal
 * data), the signed checkpoints and public key, the verification result, and a manifest of file
 * hashes. It contains no wallet addresses, no phone numbers and no names: a collector appears only
 * by public code. Server side only.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { asc, eq } from 'drizzle-orm';
import type { Database } from '@/lib/db/client';
import {
  collectionEvents,
  collectors,
  ledgerCheckpoints,
  ledgerEntries,
  payouts,
  sessions,
} from '@/lib/db/schema';
import { verifyDump, type LedgerDump } from '@/lib/ledger/dump';
import { configuredPublicKey } from '@/lib/ledger/signing';

export class ProofPackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProofPackError';
  }
}

const EVENT_HEADER = [
  'event_id',
  'collector_public_code',
  'material',
  'weight_kg',
  'recorded_at',
  'photo_sha256',
  'payout_status',
  'payout_sats',
  'ledger_seq',
] as const;

/** RFC 4180 quoting, plus a leading apostrophe-free guard against spreadsheet formulas. */
export function csvCell(value: string | number | null): string {
  if (value === null) {
    return '';
  }
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) {
    text = `'${text}`;
  }
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: readonly (string | number | null)[][]): string {
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}

const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');

function readme(args: {
  sessionId: string;
  location: string;
  generatedAt: string;
  eventCount: number;
  ledgerOk: boolean;
  publicKey: string | null;
}): string {
  return `# Taka Sats proof pack

Session: ${args.location} (${args.sessionId})
Generated: ${args.generatedAt}
Collections listed: ${args.eventCount}
Ledger verification when this pack was made: ${args.ledgerOk ? 'OK' : 'FAILED, see verification.json'}

## What is in this folder

| File | What it is |
|---|---|
| \`events.csv\` | One row per collection in the session: collector public code, material, weight, time, photo fingerprint, payout state and sats, and the ledger entry number. No names, phone numbers or wallet addresses. |
| \`ledger.json\` | The whole append only ledger (hashes only) and its signed checkpoints, plus the public key that signs them. |
| \`verification.json\` | The result of re-checking the ledger when this pack was made. |
| \`manifest.json\` | The SHA-256 of every other file, so you can tell if anything was changed after the pack was made. |

## How to re-check it yourself

1. Check the files match the manifest: run \`sha256sum events.csv ledger.json verification.json\` and compare
   with \`manifest.json\`.
2. Re-verify the ledger. This needs the public repository (https://github.com/novyrix/taka-sats), Node and pnpm,
   and no database or login:

       pnpm install
       pnpm exec tsx scripts/verify-ledger.ts ledger.json --public-key ${args.publicKey ?? '<the programme public key>'}

   It recomputes every link of the hash chain from the first entry and checks each checkpoint
   signature. \`ok\` means no entry was changed, removed or reordered since it was written.
3. Pin the public key independently: ask the programme to publish it somewhere it does not control
   alone (its website, a signed message). A key that only arrives inside the same file proves less.${
     args.publicKey
       ? ''
       : '\n   This pack was made without a configured key, so signatures were not checked.'
   }
4. Compare \`events.csv\` with the ledger: each collection's ledger entry number points at an entry in
   \`ledger.json\`. The payload of an entry is not published here, only its hash.

## What this does and does not prove

It proves the record was not altered after it was written. It does not prove the real world matched
the record: weights are typed from a physical scale and a photo, and the final check is comparing
what was paid for with what the recycler received. See docs/VERIFICATION.md in the repository.
`;
}

export type ProofPackResult = {
  readonly outDir: string;
  readonly eventCount: number;
  readonly ledgerOk: boolean;
  readonly files: readonly string[];
};

export async function buildProofPack(
  db: Database,
  input: { sessionId: string; outDir: string; publicKey?: string | null; now?: Date },
): Promise<ProofPackResult> {
  const [session] = await db
    .select({ id: sessions.id, location: sessions.location })
    .from(sessions)
    .where(eq(sessions.id, input.sessionId));
  if (!session) {
    throw new ProofPackError('that session does not exist');
  }

  const rows = await db
    .select({
      id: collectionEvents.id,
      code: collectors.publicCode,
      material: collectionEvents.material,
      weightKg: collectionEvents.weightKg,
      recordedAt: collectionEvents.recordedAt,
      photoSha256: collectionEvents.photoSha256,
      payoutStatus: payouts.status,
      payoutSats: payouts.amountSats,
      seq: ledgerEntries.seq,
    })
    .from(collectionEvents)
    .innerJoin(collectors, eq(collectors.id, collectionEvents.collectorId))
    .innerJoin(ledgerEntries, eq(ledgerEntries.id, collectionEvents.ledgerEntryId))
    .leftJoin(payouts, eq(payouts.collectionEventId, collectionEvents.id))
    .where(eq(collectionEvents.sessionId, input.sessionId))
    .orderBy(asc(collectionEvents.recordedAt), asc(collectionEvents.id));

  const csv = toCsv([
    [...EVENT_HEADER],
    ...rows.map((r) => [
      r.id,
      r.code,
      r.material,
      r.weightKg,
      r.recordedAt.toISOString(),
      r.photoSha256,
      r.payoutStatus,
      r.payoutSats,
      r.seq,
    ]),
  ]);

  const entries = await db.select().from(ledgerEntries).orderBy(asc(ledgerEntries.seq));
  const checkpoints = await db
    .select()
    .from(ledgerCheckpoints)
    .orderBy(asc(ledgerCheckpoints.throughSeq));
  const publicKey = input.publicKey === undefined ? configuredPublicKey() : input.publicKey;

  // Only the fields an auditor needs: no ids that point at people, no payloads.
  const dump = {
    entries: entries.map((e) => ({
      seq: e.seq,
      entryType: e.entryType,
      payloadHash: e.payloadHash,
      prevEntryHash: e.prevEntryHash,
      entryHash: e.entryHash,
    })),
    checkpoints: checkpoints.map((c) => ({
      throughSeq: c.throughSeq,
      entryHash: c.entryHash,
      signature: c.signature,
    })),
    publicKey,
  };
  const result = await verifyDump(dump as unknown as LedgerDump, publicKey);

  const generatedAt = (input.now ?? new Date()).toISOString();
  const verification = {
    generatedAt,
    ledgerOk: result.ok,
    result,
    signaturesChecked: result.ok ? result.checkpoints.signaturesChecked : false,
  };

  mkdirSync(input.outDir, { recursive: true });
  const files: Record<string, string> = {
    'events.csv': csv,
    'ledger.json': `${JSON.stringify(dump, null, 2)}\n`,
    'verification.json': `${JSON.stringify(verification, null, 2)}\n`,
  };
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(input.outDir, name), content);
  }
  const manifest = {
    generatedAt,
    sessionId: session.id,
    files: Object.fromEntries(
      Object.entries(files).map(([name, content]) => [
        name,
        { sha256: sha256(content), bytes: Buffer.byteLength(content) },
      ]),
    ),
  };
  writeFileSync(join(input.outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(
    join(input.outDir, 'README.md'),
    readme({
      sessionId: session.id,
      location: session.location,
      generatedAt,
      eventCount: rows.length,
      ledgerOk: result.ok,
      publicKey,
    }),
  );

  return {
    outDir: input.outDir,
    eventCount: rows.length,
    ledgerOk: result.ok,
    files: readdirSync(input.outDir).sort(),
  };
}

/** Re-check a finished pack against its own manifest. Returns the names of files that do not match. */
export function checkManifest(dir: string): string[] {
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as {
    files: Record<string, { sha256: string }>;
  };
  return Object.entries(manifest.files)
    .filter(([name, meta]) => sha256(readFileSync(join(dir, name))) !== meta.sha256)
    .map(([name]) => name);
}
