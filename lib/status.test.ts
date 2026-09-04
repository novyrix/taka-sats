// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { DISPLAY_STATUSES, isDisplayStatus, STATUS_TONE } from './status';
import enMessages from '@/messages/en.json';

describe('display status vocabulary', () => {
  it('has a tone token for every status', () => {
    for (const status of DISPLAY_STATUSES) {
      expect(STATUS_TONE[status]).toMatch(/^text-/);
    }
  });

  it('never uses the orange fill token as a status tone (DESIGN §13.1)', () => {
    for (const status of DISPLAY_STATUSES) {
      expect(STATUS_TONE[status]).not.toMatch(/bitcoin|orange/i);
    }
  });

  it('has an en label for every status (i18n hard rule)', () => {
    for (const status of DISPLAY_STATUSES) {
      expect(enMessages.Status[status as keyof typeof enMessages.Status]).toBeTruthy();
    }
  });

  it('isDisplayStatus narrows correctly', () => {
    expect(isDisplayStatus('queued')).toBe(true);
    expect(isDisplayStatus('nonsense')).toBe(false);
    expect(isDisplayStatus(42)).toBe(false);
  });
});
