// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Ed25519 checkpoint signatures (REQUIREMENTS §11.2, D-19). `node:crypto` only.
 *
 * The signed message is the UTF-8 string `<through_seq>|<entry_hash>`; the
 * signature is stored base64. The programme key is a 32-byte seed in the
 * `LEDGER_SIGNING_KEY` env secret (base64, never in TOML — D-21 §13.1); the
 * public key is the raw 32 bytes, base64 — what a verifier pins.
 */

import { createPrivateKey, createPublicKey, type KeyObject, sign, verify } from 'node:crypto';

/** DER prefixes that wrap a raw Ed25519 seed (PKCS#8) / public key (SPKI). */
const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const ED25519_KEY_BYTES = 32;

export class LedgerKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerKeyError';
  }
}

/** What a checkpoint signature covers. */
export type SignedCheckpoint = {
  readonly throughSeq: number;
  readonly entryHash: string;
  readonly signature: string;
};

export function checkpointMessage(throughSeq: number, entryHash: string): Buffer {
  return Buffer.from(`${throughSeq}|${entryHash}`, 'utf8');
}

function decodeKeyBytes(value: string, what: string): Buffer {
  const trimmed = value.trim();
  const bytes = Buffer.from(trimmed, 'base64');
  if (bytes.length !== ED25519_KEY_BYTES || bytes.toString('base64') !== trimmed) {
    throw new LedgerKeyError(`${what} must be a base64-encoded ${ED25519_KEY_BYTES}-byte value`);
  }
  return bytes;
}

/**
 * The signing key from `LEDGER_SIGNING_KEY` (read lazily, at use).
 * @throws {LedgerKeyError} unset, or not a base64 32-byte seed.
 */
export function loadSigningKey(seed = process.env.LEDGER_SIGNING_KEY): KeyObject {
  if (!seed?.trim()) {
    throw new LedgerKeyError('LEDGER_SIGNING_KEY is not set');
  }
  return createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, decodeKeyBytes(seed, 'LEDGER_SIGNING_KEY')]),
    format: 'der',
    type: 'pkcs8',
  });
}

/** The raw public key (base64) for a private key. */
export function publicKeyOf(privateKey: KeyObject): string {
  const der = createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
  return der.subarray(SPKI_ED25519_PREFIX.length).toString('base64');
}

/**
 * The public key matching `LEDGER_SIGNING_KEY`, or `null` when no key is
 * configured (the chain is still verifiable; signatures just can't be checked
 * against a pinned key).
 */
export function configuredPublicKey(seed = process.env.LEDGER_SIGNING_KEY): string | null {
  return seed?.trim() ? publicKeyOf(loadSigningKey(seed)) : null;
}

export function signCheckpoint(
  privateKey: KeyObject,
  throughSeq: number,
  entryHash: string,
): string {
  return sign(null, checkpointMessage(throughSeq, entryHash), privateKey).toString('base64');
}

export type CheckpointVerdict =
  | { readonly ok: true; readonly verified: number; readonly signaturesChecked: boolean }
  | { readonly ok: false; readonly throughSeq: number; readonly reason: string };

function fail(checkpoint: SignedCheckpoint, reason: string): CheckpointVerdict {
  return {
    ok: false,
    throughSeq: checkpoint.throughSeq,
    reason: `checkpoint ${checkpoint.throughSeq}: ${reason}`,
  };
}

/**
 * Check checkpoints against a chain: each must carry a valid signature (when a
 * `publicKey` is given) and name the `entry_hash` the chain actually has at its
 * `through_seq`. `entryHashAt` looks that hash up (`undefined` = no such entry).
 */
export function verifyCheckpoints(
  checkpoints: readonly SignedCheckpoint[],
  entryHashAt: (seq: number) => string | undefined,
  publicKey: string | null,
): CheckpointVerdict {
  for (const checkpoint of checkpoints) {
    if (publicKey && !verifyCheckpointSignature(publicKey, checkpoint)) {
      return fail(checkpoint, 'invalid signature');
    }
    if (entryHashAt(checkpoint.throughSeq) !== checkpoint.entryHash) {
      return fail(checkpoint, 'entry_hash does not match the chain at through_seq');
    }
  }
  return { ok: true, verified: checkpoints.length, signaturesChecked: publicKey !== null };
}

/** True only for a well-formed signature that `publicKey` made over this checkpoint. */
export function verifyCheckpointSignature(
  publicKey: string,
  checkpoint: SignedCheckpoint,
): boolean {
  try {
    const key = createPublicKey({
      key: Buffer.concat([SPKI_ED25519_PREFIX, decodeKeyBytes(publicKey, 'public key')]),
      format: 'der',
      type: 'spki',
    });
    return verify(
      null,
      checkpointMessage(checkpoint.throughSeq, checkpoint.entryHash),
      key,
      Buffer.from(checkpoint.signature, 'base64'),
    );
  } catch {
    return false;
  }
}
