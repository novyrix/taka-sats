// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { CollectionEventDraft } from '@/types/domain';
import { assembleCollectionEvent, EventAssemblyError, indicativeSats } from './events';
import { contentHash } from './contentHash';

const HEX64 = 'a'.repeat(64);

function draft(over: Partial<CollectionEventDraft> = {}): CollectionEventDraft {
  return {
    collectorId: '11111111-1111-4111-8111-111111111111',
    supervisorId: '22222222-2222-4222-8222-222222222222',
    sessionId: '33333333-3333-4333-8333-333333333333',
    material: 'PET',
    weightKg: 2.5,
    rateId: '44444444-4444-4444-8444-444444444444',
    rateFiatMinor: 2200,
    exchangeRate: 5_000_000,
    photoSha256: HEX64,
    geo: { kind: 'fix', lat: -1.29, lng: 36.82, accuracyM: 8 },
    registrationType: 'tap',
    ...over,
  };
}

describe('indicativeSats', () => {
  it('is rateFiatMinor × kg × 1e6 / exchangeRate, floored', () => {
    // 2200 cents/kg × 2.5kg = 5500 cents = 55 KES; ÷ 5,000,000 KES/BTC × 1e8 = 1100 sats
    expect(indicativeSats(2200, 2.5, 5_000_000)).toBe(1100);
  });
  it('floors rather than rounds', () => {
    expect(indicativeSats(1, 1, 3)).toBe(Math.floor(1_000_000 / 3));
  });
  it('rejects a non-positive exchange rate and negative inputs', () => {
    expect(() => indicativeSats(100, 1, 0)).toThrow(EventAssemblyError);
    expect(() => indicativeSats(-1, 1, 10)).toThrow(EventAssemblyError);
    expect(() => indicativeSats(100, -1, 10)).toThrow(EventAssemblyError);
  });
});

describe('assembleCollectionEvent', () => {
  it('fills id, recordedAt, indicativeSats, contentHash and a null photoUrl', async () => {
    const at = new Date('2026-06-10T09:30:00.000Z');
    const event = await assembleCollectionEvent(draft(), { id: 'fixed-id', recordedAt: at });

    expect(event.id).toBe('fixed-id');
    expect(event.recordedAt).toBe('2026-06-10T09:30:00.000Z');
    expect(event.indicativeSats).toBe(1100);
    expect(event.photoUrl).toBeNull();
    expect(event.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('the content hash covers the captured facts and is reproducible', async () => {
    const at = new Date('2026-06-10T09:30:00.000Z');
    const event = await assembleCollectionEvent(draft(), { id: 'fixed-id', recordedAt: at });
    const recomputed = await contentHash({
      id: 'fixed-id',
      collectorId: draft().collectorId,
      supervisorId: draft().supervisorId,
      sessionId: draft().sessionId,
      material: 'PET',
      weightKg: 2.5,
      rateId: draft().rateId,
      rateFiatMinor: 2200,
      exchangeRate: 5_000_000,
      indicativeSats: 1100,
      photoSha256: HEX64,
      geo: { kind: 'fix', lat: -1.29, lng: 36.82, accuracyM: 8 },
      registrationType: 'tap',
      recordedAt: '2026-06-10T09:30:00.000Z',
    });
    expect(event.contentHash).toBe(recomputed);
  });

  it('a different weight changes the hash', async () => {
    const opts = { id: 'x', recordedAt: new Date('2026-06-10T09:30:00.000Z') };
    const a = await assembleCollectionEvent(draft({ weightKg: 2.5 }), opts);
    const b = await assembleCollectionEvent(draft({ weightKg: 2.6 }), opts);
    expect(a.contentHash).not.toBe(b.contentHash);
  });

  it('accepts a gps-unavailable draft with a reason', async () => {
    const event = await assembleCollectionEvent(
      draft({ geo: { kind: 'unavailable', reason: 'permission denied' } }),
      { id: 'x' },
    );
    expect(event.geo).toEqual({ kind: 'unavailable', reason: 'permission denied' });
  });

  it('rejects a bad photo hash, missing ids, and a reasonless gps failure', async () => {
    await expect(assembleCollectionEvent(draft({ photoSha256: 'nope' }))).rejects.toBeInstanceOf(
      EventAssemblyError,
    );
    await expect(assembleCollectionEvent(draft({ collectorId: '' }))).rejects.toBeInstanceOf(
      EventAssemblyError,
    );
    await expect(
      assembleCollectionEvent(draft({ geo: { kind: 'unavailable', reason: '  ' } })),
    ).rejects.toBeInstanceOf(EventAssemblyError);
  });
});
