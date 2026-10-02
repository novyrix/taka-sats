// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it, vi } from 'vitest';
import { PaymentFailedError, PaymentOutcomeUnknownError } from '@/lib/lightning/errors';
import { errorResponse } from './errors';

vi.mock('@/auth', () => ({ auth: vi.fn(async () => null) }));

afterEach(() => vi.restoreAllMocks());

const SECRET = 'blink_SECRET_KEY_abc123 sample-wallet@example.com lnbc500n1invoice';

describe('errorResponse never leaks a secret, an address or an invoice', () => {
  it.each([
    ['an unmapped Error', new Error(SECRET)],
    ['a provider failure', new PaymentFailedError(SECRET, 'CODE')],
    ['an unknown payment outcome', new PaymentOutcomeUnknownError(SECRET, 'ab'.repeat(32))],
    ['a database-looking error', Object.assign(new Error(`password=${SECRET}`), { code: '28P01' })],
    ['a thrown string', SECRET],
  ])('%s becomes a generic 500', async (_name, error) => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = errorResponse(error);
    expect(response.status).toBe(500);
    const text = JSON.stringify(await response.json());
    expect(text).not.toMatch(/SECRET|sample-wallet|lnbc/);
    expect(text).toContain('internal_error');
    // The log line carries the error type only.
    expect(JSON.stringify(logged.mock.calls)).not.toMatch(/SECRET|sample-wallet|lnbc/);
  });
});
