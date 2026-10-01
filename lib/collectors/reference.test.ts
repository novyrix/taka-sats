// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import {
  collectorRefUrl,
  formatCollectorRef,
  formatPublicCode,
  isPublicCode,
  parseCollectorRef,
} from './reference';

describe('formatPublicCode', () => {
  it('pads the sequence to four digits and includes the site when given', () => {
    expect(formatPublicCode({ prefix: 'TS', siteCode: 'KBR', seq: 42 })).toBe('TS-KBR-0042');
    expect(formatPublicCode({ prefix: 'TS', seq: 7 })).toBe('TS-0007');
  });

  it('grows past four digits instead of truncating', () => {
    expect(formatPublicCode({ prefix: 'TS', seq: 123456 })).toBe('TS-123456');
  });

  it('always produces something isPublicCode accepts', () => {
    for (const seq of [1, 42, 9999, 10000, 987654]) {
      expect(isPublicCode(formatPublicCode({ prefix: 'TS', siteCode: 'KBR', seq }))).toBe(true);
    }
  });
});

describe('parseCollectorRef', () => {
  it('reads every accepted form to the same code', () => {
    const code = 'TS-KBR-0042';
    expect(parseCollectorRef('takasats:TS-KBR-0042')).toBe(code);
    expect(parseCollectorRef('TAKASATS:ts-kbr-0042')).toBe(code);
    expect(parseCollectorRef('https://taka.afribit.africa/c/TS-KBR-0042')).toBe(code);
    expect(parseCollectorRef('https://taka.afribit.africa/c/ts-kbr-0042/?src=nfc')).toBe(code);
    expect(parseCollectorRef('  ts-kbr-0042  ')).toBe(code);
  });

  it('round-trips with formatCollectorRef', () => {
    expect(parseCollectorRef(formatCollectorRef('TS-0007'))).toBe('TS-0007');
    expect(parseCollectorRef(collectorRefUrl('https://example.org', 'TS-0007'))).toBe('TS-0007');
  });

  it('returns null — never throws — for anything that is not a collector reference', () => {
    for (const input of [
      '',
      '   ',
      'Akinyi',
      '0042',
      'takasats:',
      'takasats:not a code',
      'https://taka.afribit.africa/other/TS-0007',
      'https://taka.afribit.africa/c/',
      'akinyi@flow.paybee.buzz',
      'https://card.paybee.buzz/sample-card',
      'x'.repeat(500),
    ]) {
      expect(parseCollectorRef(input)).toBeNull();
    }
  });

  it('does not treat an LNURL as a collector reference', () => {
    expect(parseCollectorRef('lnurl1dp68gurn8ghj7mrww4exctnrdakj7')).toBeNull();
  });

  it('reads only the /c/<code> path of a link — the host is neither trusted nor compared', () => {
    // Harmless: all that is consumed is a public code, which grants nothing.
    expect(parseCollectorRef('https://elsewhere.example/c/TS-0007')).toBe('TS-0007');
  });
});
