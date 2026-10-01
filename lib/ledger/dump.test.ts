// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { type ChainEntry, computeEntryHash } from './chain';
import { LedgerDumpError, parseDump, verifyDump } from './dump';
import { loadSigningKey, publicKeyOf, signCheckpoint } from './signing';

const H = (c: string) => c.repeat(64);
const key = loadSigningKey(Buffer.alloc(32, 7).toString('base64'));
const publicKey = publicKeyOf(key);

async function buildChain(length: number): Promise<ChainEntry[]> {
  const entries: ChainEntry[] = [];
  let prev: string | null = null;
  for (let seq = 1; seq <= length; seq += 1) {
    const payloadHash = H(String(seq));
    const entryHash = await computeEntryHash(seq, 'collection_event', payloadHash, prev);
    entries.push({
      seq,
      entryType: 'collection_event',
      payloadHash,
      prevEntryHash: prev,
      entryHash,
    });
    prev = entryHash;
  }
  return entries;
}

const checkpointAt = (entries: ChainEntry[], seq: number) => {
  const entryHash = entries[seq - 1]!.entryHash;
  return { throughSeq: seq, entryHash, signature: signCheckpoint(key, seq, entryHash) };
};

describe('verifyDump', () => {
  it('verifies a chain with signed checkpoints', async () => {
    const entries = await buildChain(4);
    const dump = { entries, checkpoints: [checkpointAt(entries, 2), checkpointAt(entries, 4)] };
    expect(await verifyDump({ ...dump, publicKey: null }, publicKey)).toEqual({
      ok: true,
      mode: 'full',
      count: 4,
      throughSeq: 4,
      headHash: entries[3]!.entryHash,
      checkpoints: { verified: 2, signaturesChecked: true },
    });
  });

  it('is ok for an empty export', async () => {
    expect(await verifyDump({ entries: [], checkpoints: [], publicKey: null }, null)).toMatchObject(
      {
        ok: true,
        count: 0,
        throughSeq: 0,
        headHash: null,
      },
    );
  });

  it('tolerates unordered input but not a missing entry', async () => {
    const entries = await buildChain(3);
    const shuffled = { entries: [entries[2]!, entries[0]!, entries[1]!], checkpoints: [] };
    expect(await verifyDump({ ...shuffled, publicKey: null }, null)).toMatchObject({ ok: true });

    const gap = { entries: [entries[0]!, entries[2]!], checkpoints: [], publicKey: null };
    expect(await verifyDump(gap, null)).toMatchObject({ ok: false, brokenAt: 3 });
  });

  it('catches an altered payload, a re-linked entry, and a duplicate seq', async () => {
    const entries = await buildChain(3);

    const altered = entries.map((e) => (e.seq === 2 ? { ...e, payloadHash: H('9') } : e));
    expect(
      await verifyDump({ entries: altered, checkpoints: [], publicKey: null }, null),
    ).toMatchObject({
      ok: false,
      brokenAt: 2,
      reason: expect.stringContaining('entry_hash mismatch'),
    });

    const relinked = entries.map((e) => (e.seq === 3 ? { ...e, prevEntryHash: H('0') } : e));
    expect(
      await verifyDump({ entries: relinked, checkpoints: [], publicKey: null }, null),
    ).toMatchObject({ ok: false, brokenAt: 3, reason: expect.stringContaining('does not link') });

    const dupe = { entries: [...entries, entries[2]!], checkpoints: [], publicKey: null };
    expect(await verifyDump(dupe, null)).toMatchObject({ ok: false });
  });

  it('catches a tampered checkpoint signature and a checkpoint signed by another key', async () => {
    const entries = await buildChain(3);
    const good = checkpointAt(entries, 3);

    const tampered = { ...good, signature: signCheckpoint(key, 2, H('2')) };
    expect(
      await verifyDump({ entries, checkpoints: [tampered], publicKey: null }, publicKey),
    ).toMatchObject({
      ok: false,
      brokenAt: 3,
      reason: expect.stringContaining('invalid signature'),
    });

    expect(
      await verifyDump(
        { entries, checkpoints: [good], publicKey: null },
        publicKeyOf(loadSigningKey(Buffer.alloc(32, 8).toString('base64'))),
      ),
    ).toMatchObject({ ok: false, brokenAt: 3 });
  });

  it('catches a truncated tail: a checkpoint beyond the last entry', async () => {
    const entries = await buildChain(4);
    const dump = {
      entries: entries.slice(0, 3),
      checkpoints: [checkpointAt(entries, 4)],
      publicKey: null,
    };
    expect(await verifyDump(dump, publicKey)).toMatchObject({ ok: false, brokenAt: 4 });
  });

  it('without a public key it still checks hashes but reports signatures unchecked', async () => {
    const entries = await buildChain(2);
    const result = await verifyDump(
      { entries, checkpoints: [checkpointAt(entries, 2)], publicKey: null },
      null,
    );
    expect(result).toMatchObject({
      ok: true,
      checkpoints: { verified: 1, signaturesChecked: false },
    });
  });
});

describe('parseDump', () => {
  it('reads { entries, checkpoints, publicKey }', async () => {
    const entries = await buildChain(2);
    const text = JSON.stringify({ entries, checkpoints: [checkpointAt(entries, 2)], publicKey });
    const dump = parseDump(text);
    expect(dump.entries).toHaveLength(2);
    expect(dump.checkpoints).toHaveLength(1);
    expect(dump.publicKey).toBe(publicKey);
  });

  it('reads snake_case rows (raw table columns, seq as a string)', async () => {
    const [e] = await buildChain(1);
    const row = {
      seq: '1',
      entry_type: e!.entryType,
      payload_hash: e!.payloadHash,
      prev_entry_hash: null,
      entry_hash: e!.entryHash,
    };
    expect(parseDump(JSON.stringify([row])).entries).toEqual([e]);
  });

  it('reads NDJSON with entries and checkpoints mixed', async () => {
    const entries = await buildChain(2);
    const lines = [...entries, checkpointAt(entries, 2)].map((o) => JSON.stringify(o)).join('\n');
    const dump = parseDump(`${lines}\n`);
    expect(dump.entries).toHaveLength(2);
    expect(dump.checkpoints).toHaveLength(1);
  });

  it('rejects input that is not a ledger export', () => {
    expect(() => parseDump('not json at all')).toThrow(LedgerDumpError);
    expect(() => parseDump('[1, 2]')).toThrow(/not an object/);
    expect(() => parseDump('[{"seq": 1, "prevEntryHash": null}]')).toThrow(/entryType/);
    expect(() => parseDump('[{"seq": 1.5, "entryType": "x", "prevEntryHash": null}]')).toThrow(
      /integer/,
    );
  });
});
