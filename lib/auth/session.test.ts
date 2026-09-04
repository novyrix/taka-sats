// SPDX-License-Identifier: AGPL-3.0-only

import type { Session } from 'next-auth';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// `auth` is overloaded (bare call / middleware / handler-wrapper); session.ts
// only ever uses the bare `auth()` overload, so the mock is typed to that
// shape directly rather than fighting vi.mocked's overload inference.
vi.mock('@/auth', () => ({ auth: vi.fn() }));

import { auth } from '@/auth';
import { ForbiddenError, getActor, requireScope, UnauthorizedError } from './session';

const authMock = auth as unknown as {
  mockReset: () => void;
  mockResolvedValue: (value: Session | null) => void;
};

describe('getActor / requireScope', () => {
  beforeEach(() => {
    authMock.mockReset();
  });

  it('returns null when there is no session', async () => {
    authMock.mockResolvedValue(null);
    expect(await getActor()).toBeNull();
  });

  it('resolves the actor from a valid session', async () => {
    authMock.mockResolvedValue({
      user: { id: 'sup-1', role: 'supervisor', locale: 'en' },
      expires: '2099-01-01T00:00:00.000Z',
    });
    const actor = await getActor();
    expect(actor).toEqual({ kind: 'supervisor', id: 'sup-1', role: 'supervisor' });
  });

  it('requireScope throws UnauthorizedError with no session', async () => {
    authMock.mockResolvedValue(null);
    await expect(requireScope('collector:enrol')).rejects.toThrow(UnauthorizedError);
  });

  it('requireScope throws ForbiddenError when the role lacks the scope', async () => {
    authMock.mockResolvedValue({
      user: { id: 'sup-1', role: 'supervisor', locale: 'en' },
      expires: '2099-01-01T00:00:00.000Z',
    });
    await expect(requireScope('tag:revoke')).rejects.toThrow(ForbiddenError);
  });

  it('requireScope resolves the actor when the role has the scope', async () => {
    authMock.mockResolvedValue({
      user: { id: 'admin-1', role: 'admin', locale: 'en' },
      expires: '2099-01-01T00:00:00.000Z',
    });
    const actor = await requireScope('tag:revoke');
    expect(actor.role).toBe('admin');
  });

  it('deny-by-default: payout:execute is unreachable via any session (Code Style Guide §9.4)', async () => {
    for (const role of ['supervisor', 'hub_lead', 'admin', 'partner'] as const) {
      authMock.mockResolvedValue({
        user: { id: 'x', role, locale: 'en' },
        expires: '2099-01-01T00:00:00.000Z',
      });
      await expect(requireScope('payout:execute')).rejects.toThrow(ForbiddenError);
    }
  });
});
