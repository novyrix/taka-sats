// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { type CheckFacts, evaluateChecks } from './detail';

const START = new Date('2026-10-01T08:00:00Z');
const END = new Date('2026-10-01T12:00:00Z');
const SQUARE: [number, number][] = [
  [36.8, -1.3],
  [36.9, -1.3],
  [36.9, -1.2],
  [36.8, -1.2],
  [36.8, -1.3],
]; // GeoJSON order: [lng, lat]

const base: CheckFacts = {
  recordedAt: new Date('2026-10-01T09:00:00Z'),
  graceMs: 30 * 60_000,
  collector: { status: 'active', authorizedBy: 'u1', authorizedAt: START },
  session: { start: START, end: END, bounds: SQUARE },
  eventRateId: 'r1',
  rateInForceId: 'r1',
  rateFiatMinor: 2000,
  photoStored: true,
  gps: { lat: -1.25, lng: 36.85 },
  includeGeo: true,
  flags: [],
  payout: { status: 'paid', amountSats: 100 },
  ledger: { seq: 7, entryHash: 'a'.repeat(64) },
};
const statusOf = (facts: CheckFacts, key: string) =>
  evaluateChecks(facts).find((c) => c.key === key)?.status;

describe('evaluateChecks', () => {
  it('passes every check for a clean, paid event', () => {
    expect(evaluateChecks(base).map((c) => c.status)).toEqual(Array(9).fill('pass'));
  });

  it('fails an unauthorized collector, an outside window and a rate that was not in force', () => {
    expect(
      statusOf(
        { ...base, collector: { ...base.collector, status: 'revoked' } },
        'collector_authorized',
      ),
    ).toBe('fail');
    expect(
      statusOf({ ...base, recordedAt: new Date('2026-10-01T13:00:00Z') }, 'session_window'),
    ).toBe('fail');
    // inside the grace period still passes
    expect(
      statusOf({ ...base, recordedAt: new Date('2026-10-01T12:20:00Z') }, 'session_window'),
    ).toBe('pass');
    expect(statusOf({ ...base, rateInForceId: 'other' }, 'rate_in_force')).toBe('fail');
    expect(statusOf({ ...base, rateInForceId: null }, 'rate_in_force')).toBe('unknown');
  });

  it('judges GPS against the session boundary and explains a missing fix', () => {
    expect(statusOf({ ...base, gps: { lat: 10, lng: 10 } }, 'gps_inside')).toBe('fail');
    expect(statusOf({ ...base, gps: { reason: 'permission denied' } }, 'gps_inside')).toBe('warn');
    expect(statusOf({ ...base, session: { ...base.session!, bounds: null } }, 'gps_inside')).toBe(
      'unknown',
    );
  });

  it('never leaks coordinates to a viewer without geo access', () => {
    const outside = evaluateChecks({ ...base, includeGeo: false, gps: { lat: 10, lng: 10 } });
    expect(JSON.stringify(outside)).not.toContain('"lat"');
    const noBounds = evaluateChecks({
      ...base,
      includeGeo: false,
      session: { ...base.session!, bounds: null },
    });
    expect(JSON.stringify(noBounds)).not.toContain('"lat"');
  });

  it('turns flags into warn (open) or fail (confirmed); a dismissed flag passes', () => {
    const flag = (status: 'open' | 'confirmed' | 'dismissed') => [
      { id: 'f', type: 'duplicate_photo', status, detectedAt: START },
    ];
    expect(statusOf({ ...base, flags: flag('open') }, 'duplicate_photo')).toBe('warn');
    expect(statusOf({ ...base, flags: flag('confirmed') }, 'duplicate_photo')).toBe('fail');
    expect(statusOf({ ...base, flags: flag('dismissed') }, 'duplicate_photo')).toBe('pass');
    expect(statusOf({ ...base, flags: flag('open') }, 'weight_outlier')).toBe('pass');
  });

  it('reports a missing photo, a payout still in progress and a missing session', () => {
    expect(statusOf({ ...base, photoStored: false }, 'photo_stored')).toBe('warn');
    expect(
      statusOf({ ...base, payout: { status: 'pending_approval', amountSats: null } }, 'payout'),
    ).toBe('warn');
    expect(statusOf({ ...base, payout: null }, 'payout')).toBe('unknown');
    expect(statusOf({ ...base, session: null }, 'session_window')).toBe('unknown');
  });
});
