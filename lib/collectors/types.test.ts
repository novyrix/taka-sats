// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import {
  attachByoAddressInputSchema,
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

describe('attachByoAddressInputSchema', () => {
  it('requires a UUID collectorId and a non-empty rawCode', () => {
    expect(() =>
      attachByoAddressInputSchema.parse({ collectorId: 'not-a-uuid', rawCode: 'a@b.co' }),
    ).toThrow();
    expect(() =>
      attachByoAddressInputSchema.parse({
        collectorId: '00000000-0000-0000-0000-000000000000',
        rawCode: '',
      }),
    ).toThrow();
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
