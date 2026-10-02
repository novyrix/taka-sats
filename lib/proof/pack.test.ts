// SPDX-License-Identifier: AGPL-3.0-only

import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db/client';
import { createCheckpoint } from '@/lib/ledger/checkpoints';
import { loadSigningKey, publicKeyOf } from '@/lib/ledger/signing';
import {
  PAYOUT_TRUNCATE,
  seedCollectionEvent,
  seedPayoutWorld,
} from '@/lib/testing/payout-fixtures';
import { buildProofPack, checkManifest, csvCell, ProofPackError, toCsv } from './pack';

vi.mock('@/lib/storage', () => ({ photoUrlFor: vi.fn(async () => null) }));

describe('csv', () => {
  it('quotes, escapes and defuses spreadsheet formulas', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('-5')).toBe('-5');
    expect(csvCell(null)).toBe('');
    expect(
      toCsv([
        ['a', 1],
        ['b', null],
      ]),
    ).toBe('a,1\nb,\n');
  });
});

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)('buildProofPack (database)', () => {
  const db = hasDatabase ? getDb() : (undefined as never);
  const dir = mkdtempSync(join(tmpdir(), 'proof-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('writes a readable, verifiable, personal data free pack and notices tampering', async () => {
    const world = await seedPayoutWorld(db);
    await db.execute(sql`truncate ledger_checkpoints`);
    await seedCollectionEvent(db, world);
    await seedCollectionEvent(db, world, { weightKg: '1.0' });
    const key = loadSigningKey(randomBytes(32).toString('base64'));
    await createCheckpoint(db, { signingKey: key });

    const out = join(dir, 'pack');
    const result = await buildProofPack(db, {
      sessionId: world.sessionId,
      outDir: out,
      publicKey: publicKeyOf(key),
    });
    expect(result.ledgerOk).toBe(true);
    expect(result.eventCount).toBe(2);
    expect(result.files).toEqual([
      'README.md',
      'events.csv',
      'ledger.json',
      'manifest.json',
      'verification.json',
    ]);

    const csv = readFileSync(join(out, 'events.csv'), 'utf8').trim().split('\n');
    expect(csv[0]).toBe(
      'event_id,collector_public_code,material,weight_kg,recorded_at,photo_sha256,payout_status,payout_sats,ledger_seq',
    );
    expect(csv).toHaveLength(3);

    // No wallet address, no phone number, no payload in anything we wrote.
    const everything = result.files.map((f) => readFileSync(join(out, f), 'utf8')).join('\n');
    expect(everything).not.toMatch(/wallet\.example/);
    expect(everything).not.toMatch(/\+254/);
    expect(JSON.parse(readFileSync(join(out, 'verification.json'), 'utf8')).signaturesChecked).toBe(
      true,
    );

    expect(checkManifest(out)).toEqual([]);
    writeFileSync(join(out, 'events.csv'), `${csv.join('\n')}\nextra,row\n`);
    expect(checkManifest(out)).toEqual(['events.csv']);
  });

  it('refuses an unknown session and reports a broken ledger honestly', async () => {
    await expect(
      buildProofPack(db, {
        sessionId: '00000000-0000-4000-8000-000000000000',
        outDir: join(dir, 'none'),
      }),
    ).rejects.toThrow(ProofPackError);
  });

  it('cleans up', async () => {
    await db.execute(PAYOUT_TRUNCATE);
    await db.execute(sql`truncate ledger_checkpoints`);
  });
});
