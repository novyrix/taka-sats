// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { canonicalize, contentHash, sha256Hex, sha256HexBytes } from './contentHash';

describe('canonicalize', () => {
  it('sorts object keys at every level and emits no whitespace', () => {
    expect(canonicalize({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it('is independent of insertion order', () => {
    expect(canonicalize({ x: 1, y: 2, z: [3, { m: 4, k: 5 }] })).toBe(
      canonicalize({ z: [3, { k: 5, m: 4 }], y: 2, x: 1 }),
    );
  });

  it('keeps array order', () => {
    expect(canonicalize([3, 1, 2])).toBe('[3,1,2]');
  });

  it('drops undefined members but keeps null', () => {
    expect(canonicalize({ a: undefined, b: null, c: 1 })).toBe('{"b":null,"c":1}');
  });

  it('rejects non-finite numbers', () => {
    expect(() => canonicalize({ n: Number.POSITIVE_INFINITY })).toThrow(TypeError);
    expect(() => canonicalize({ n: Number.NaN })).toThrow(TypeError);
  });
});

describe('sha256Hex', () => {
  it('matches the known vector for the empty string', async () => {
    expect(await sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
  it('matches the known vector for "abc"', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('sha256HexBytes (the on-device photo hash)', () => {
  it('hashes raw bytes, matching the string hash of the same content', async () => {
    const bytes = new TextEncoder().encode('abc');
    expect(await sha256HexBytes(bytes)).toBe(await sha256Hex('abc'));
    expect(await sha256HexBytes(bytes.buffer)).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('contentHash', () => {
  it('is stable across key reordering', async () => {
    const a = await contentHash({ weightKg: 2.5, material: 'PET', id: 'x' });
    const b = await contentHash({ id: 'x', material: 'PET', weightKg: 2.5 });
    expect(a).toBe(b);
  });

  it('is a fixed vector for a representative payload (guards the canonical form)', async () => {
    const hash = await contentHash({
      id: '11111111-1111-4111-8111-111111111111',
      material: 'PET',
      weightKg: 2.5,
      rateFiatMinor: 2200,
    });
    // canonical string:
    // {"id":"11111111-1111-4111-8111-111111111111","material":"PET","rateFiatMinor":2200,"weightKg":2.5}
    expect(hash).toBe(
      await sha256Hex(
        '{"id":"11111111-1111-4111-8111-111111111111","material":"PET","rateFiatMinor":2200,"weightKg":2.5}',
      ),
    );
  });
});
