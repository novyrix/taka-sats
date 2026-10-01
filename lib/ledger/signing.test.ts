// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import {
  checkpointMessage,
  configuredPublicKey,
  LedgerKeyError,
  loadSigningKey,
  publicKeyOf,
  signCheckpoint,
  verifyCheckpoints,
  verifyCheckpointSignature,
} from './signing';

const H = (c: string) => c.repeat(64);
const seed = (byte: number) => Buffer.alloc(32, byte).toString('base64');

describe('checkpoint signing', () => {
  it('signs the UTF-8 string `<through_seq>|<entry_hash>`', () => {
    expect(checkpointMessage(7, H('a')).toString('utf8')).toBe(`7|${H('a')}`);
  });

  it('matches a fixed vector (Ed25519 is deterministic — a third party can reproduce it)', () => {
    const key = loadSigningKey(seed(1));
    expect(publicKeyOf(key)).toBe('iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w=');
    expect(signCheckpoint(key, 3, H('a'))).toBe(
      'oJCBx7iUnvkG88vqAAbWSmQMiYsActyXA698P+Ds4QiacI08qKgA2Pj5KB02BrqMAGdhpupvHoA5suIGQBL6Dw==',
    );
  });

  it('round-trips, and rejects a different key, seq, hash, or a malformed signature', () => {
    const key = loadSigningKey(seed(1));
    const publicKey = publicKeyOf(key);
    const signature = signCheckpoint(key, 3, H('a'));
    const cp = { throughSeq: 3, entryHash: H('a'), signature };

    expect(verifyCheckpointSignature(publicKey, cp)).toBe(true);
    expect(verifyCheckpointSignature(publicKeyOf(loadSigningKey(seed(2))), cp)).toBe(false);
    expect(verifyCheckpointSignature(publicKey, { ...cp, throughSeq: 4 })).toBe(false);
    expect(verifyCheckpointSignature(publicKey, { ...cp, entryHash: H('b') })).toBe(false);
    expect(verifyCheckpointSignature(publicKey, { ...cp, signature: 'not-a-signature' })).toBe(
      false,
    );
    expect(verifyCheckpointSignature('garbage', cp)).toBe(false);
  });

  it('rejects an unset, non-base64, or wrong-length signing key', () => {
    expect(() => loadSigningKey('')).toThrow(LedgerKeyError);
    expect(() => loadSigningKey('   ')).toThrow(/not set/);
    expect(() => loadSigningKey('%%%not-base64%%%')).toThrow(LedgerKeyError);
    expect(() => loadSigningKey(Buffer.alloc(31).toString('base64'))).toThrow(/32-byte/);
    expect(() => loadSigningKey(Buffer.alloc(33).toString('base64'))).toThrow(/32-byte/);
  });

  it('configuredPublicKey is null with no key and the matching public key with one', () => {
    expect(configuredPublicKey('')).toBeNull();
    expect(configuredPublicKey(seed(1))).toBe(publicKeyOf(loadSigningKey(seed(1))));
  });
});

describe('verifyCheckpoints', () => {
  const key = loadSigningKey(seed(1));
  const publicKey = publicKeyOf(key);
  const signed = (seq: number, hash: string) => ({
    throughSeq: seq,
    entryHash: hash,
    signature: signCheckpoint(key, seq, hash),
  });
  const chain = new Map([
    [1, H('1')],
    [2, H('2')],
  ]);

  it('passes valid checkpoints and reports whether signatures were checked', () => {
    const cps = [signed(1, H('1')), signed(2, H('2'))];
    expect(verifyCheckpoints(cps, (s) => chain.get(s), publicKey)).toEqual({
      ok: true,
      verified: 2,
      signaturesChecked: true,
    });
    expect(verifyCheckpoints(cps, (s) => chain.get(s), null)).toEqual({
      ok: true,
      verified: 2,
      signaturesChecked: false,
    });
    expect(verifyCheckpoints([], (s) => chain.get(s), publicKey)).toMatchObject({ ok: true });
  });

  it('fails a forged signature, a wrong key, a hash mismatch, and a seq past the head', () => {
    const forged = { ...signed(2, H('2')), signature: signed(1, H('1')).signature };
    expect(verifyCheckpoints([forged], (s) => chain.get(s), publicKey)).toMatchObject({
      ok: false,
      throughSeq: 2,
      reason: expect.stringContaining('invalid signature'),
    });

    const otherKey = publicKeyOf(loadSigningKey(seed(9)));
    expect(verifyCheckpoints([signed(1, H('1'))], (s) => chain.get(s), otherKey)).toMatchObject({
      ok: false,
    });

    // validly signed, but the chain has a different hash at that seq
    expect(verifyCheckpoints([signed(2, H('f'))], (s) => chain.get(s), publicKey)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('does not match the chain'),
    });

    // truncated tail: the checkpoint names a seq the chain no longer has
    expect(verifyCheckpoints([signed(3, H('3'))], (s) => chain.get(s), publicKey)).toMatchObject({
      ok: false,
      throughSeq: 3,
    });
  });
});
