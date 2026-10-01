// SPDX-License-Identifier: AGPL-3.0-only

import type { Session } from 'next-auth';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/lightning', () => ({ getLightningProvider: vi.fn() }));

import { auth } from '@/auth';
import { getLightningProvider } from '@/lib/lightning';
import { sats } from '@/lib/money';
import { GET } from './route';

const authMock = auth as unknown as { mockResolvedValue: (value: Session | null) => void };
const session = (role: string): Session => ({
  user: { id: 'u', role: role as never, locale: 'en' },
  expires: '2099-01-01T00:00:00.000Z',
});
const provider = (
  getFloatBalance: () => Promise<{ available: ReturnType<typeof sats>; asOf: Date }>,
) => vi.mocked(getLightningProvider).mockReturnValue({ getFloatBalance } as never);

describe('GET /api/v1/treasury/float', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('401 without a session; 403 for everyone but an admin', async () => {
    authMock.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    for (const role of ['supervisor', 'hub_lead', 'partner']) {
      authMock.mockResolvedValue(session(role));
      expect((await GET()).status).toBe(403);
    }
  });

  it('reports the balance and flags it low against float_low_balance_alert_sats', async () => {
    authMock.mockResolvedValue(session('admin'));
    const asOf = new Date('2026-06-10T10:00:00.000Z');

    provider(async () => ({ available: sats(150_000), asOf }));
    const low = await GET();
    expect(low.status).toBe(200);
    expect(await low.json()).toEqual({
      available: 150_000,
      asOf: asOf.toISOString(),
      lowBalance: true, // default alert threshold is 200,000
    });

    provider(async () => ({ available: sats(5_000_000), asOf }));
    expect(((await (await GET()).json()) as { lowBalance: boolean }).lowBalance).toBe(false);
  });

  it('503 float_unavailable when the rail cannot be read — without leaking why', async () => {
    authMock.mockResolvedValue(session('admin'));
    provider(async () => {
      throw new Error('BLINK_API_KEY=secret-value rejected');
    });
    const response = await GET();
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(text).toContain('float_unavailable');
    expect(text).not.toContain('secret-value');
  });

  it('503 when the provider cannot even be constructed', async () => {
    authMock.mockResolvedValue(session('admin'));
    vi.mocked(getLightningProvider).mockImplementation(() => {
      throw new Error('misconfigured');
    });
    expect((await GET()).status).toBe(503);
  });
});
