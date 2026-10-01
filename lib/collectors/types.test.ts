// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import {
  attachDestinationInputSchema,
  authorizationDecisionSchema,
  enrolCollectorInputSchema,
  reissueTagInputSchema,
} from './types';

describe('enrolCollectorInputSchema', () => {
  it('accepts an alias-only input (§7.1 — the only required field)', () => {
    const result = enrolCollectorInputSchema.parse({ alias: 'Amina' });
    expect(result).toEqual({ alias: 'Amina' });
  });

  it('trims whitespace', () => {
    expect(enrolCollectorInputSchema.parse({ alias: '  Amina  ' }).alias).toBe('Amina');
  });

  it('rejects an empty or whitespace-only alias', () => {
    expect(() => enrolCollectorInputSchema.parse({ alias: '' })).toThrow();
    expect(() => enrolCollectorInputSchema.parse({ alias: '   ' })).toThrow();
  });

  it('rejects an addressSource outside byo|provisioned', () => {
    expect(() =>
      enrolCollectorInputSchema.parse({ alias: 'Amina', addressSource: 'stolen' }),
    ).toThrow();
  });
});

describe('attachDestinationInputSchema', () => {
  it('requires a UUID collectorId and a non-empty rawCode', () => {
    expect(() =>
      attachDestinationInputSchema.parse({ collectorId: 'not-a-uuid', rawCode: 'a@b.co' }),
    ).toThrow();
    expect(() =>
      attachDestinationInputSchema.parse({
        collectorId: '00000000-0000-0000-0000-000000000000',
        rawCode: '',
      }),
    ).toThrow();
  });
});

describe('enrolCollectorInputSchema — siteCode', () => {
  it('upper-cases and accepts a 2-6 letter site code', () => {
    expect(enrolCollectorInputSchema.parse({ alias: 'A', siteCode: 'kbr' }).siteCode).toBe('KBR');
  });

  it('rejects a site code that is not 2-6 letters', () => {
    for (const siteCode of ['K', 'KIBERAAA', 'K8R', 'K-R']) {
      expect(() => enrolCollectorInputSchema.parse({ alias: 'A', siteCode })).toThrow();
    }
  });
});

describe('authorizationDecisionSchema', () => {
  it('accepts only authorize | revoke', () => {
    expect(authorizationDecisionSchema.parse('authorize')).toBe('authorize');
    expect(authorizationDecisionSchema.parse('revoke')).toBe('revoke');
    expect(() => authorizationDecisionSchema.parse('approve')).toThrow();
  });
});

describe('reissueTagInputSchema', () => {
  it('requires a non-empty newTagId', () => {
    expect(() =>
      reissueTagInputSchema.parse({
        collectorId: '00000000-0000-0000-0000-000000000000',
        newTagId: '',
      }),
    ).toThrow();
  });
});
