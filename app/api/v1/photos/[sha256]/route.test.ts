// SPDX-License-Identifier: AGPL-3.0-only

import type { Session } from 'next-auth';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/storage', () => ({
  StorageConfigError: class StorageConfigError extends Error {},
  getPhoto: vi.fn(),
  baseMediaType: (t: string) => (t.split(';')[0] ?? '').trim().toLowerCase(),
  isAllowedPhotoType: (t: string) =>
    ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'].includes(
      (t.split(';')[0] ?? '').trim().toLowerCase(),
    ),
}));

import { auth } from '@/auth';
import { getPhoto } from '@/lib/storage';
import { GET } from './route';

const authMock = auth as unknown as { mockResolvedValue: (value: Session | null) => void };
const session = (role: string): Session => ({
  user: { id: 'actor-1', role: role as never, locale: 'en' },
  expires: '2099-01-01T00:00:00.000Z',
});

const SHA = 'a'.repeat(64);
const call = (sha: string) =>
  GET(new NextRequest(`http://localhost/api/v1/photos/${sha}`), {
    params: Promise.resolve({ sha256: sha }),
  });

beforeEach(() => {
  vi.mocked(getPhoto).mockReset();
});

describe('GET /api/v1/photos/:sha256', () => {
  it('401 without a session, and never touches storage', async () => {
    authMock.mockResolvedValue(null);
    expect((await call(SHA)).status).toBe(401);
    expect(getPhoto).not.toHaveBeenCalled();
  });

  it('403 for a partner — evidence photos are staff-only', async () => {
    authMock.mockResolvedValue(session('partner'));
    expect((await call(SHA)).status).toBe(403);
    expect(getPhoto).not.toHaveBeenCalled();
  });

  it('400 for anything that is not a sha256 (no path games reach storage)', async () => {
    authMock.mockResolvedValue(session('supervisor'));
    for (const bad of ['..%2F..%2Fetc', 'a'.repeat(63), 'A'.repeat(64), 'zz']) {
      expect((await call(bad)).status).toBe(400);
    }
    expect(getPhoto).not.toHaveBeenCalled();
  });

  it('404 until the upload queue has delivered the bytes', async () => {
    authMock.mockResolvedValue(session('supervisor'));
    vi.mocked(getPhoto).mockResolvedValue(null);
    const res = await call(SHA);
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('not_found');
  });

  it('streams the bytes with a private, immutable cache and nosniff', async () => {
    authMock.mockResolvedValue(session('hub_lead'));
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    vi.mocked(getPhoto).mockResolvedValue({ bytes, contentType: 'image/jpeg' });

    const res = await call(SHA);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
    expect(res.headers.get('content-disposition')).toBe('inline');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
    expect(getPhoto).toHaveBeenCalledWith(SHA);
  });

  it.each(['image/svg+xml', 'text/html', 'application/xhtml+xml', 'text/javascript'])(
    'never renders a stored %s — it is a download, sandboxed (stored-XSS defence)',
    async (contentType) => {
      authMock.mockResolvedValue(session('admin'));
      const bytes = new TextEncoder().encode('<svg onload="alert(document.cookie)"/>');
      vi.mocked(getPhoto).mockResolvedValue({ bytes, contentType });

      const res = await call(SHA);
      expect(res.headers.get('content-type')).toBe('application/octet-stream');
      expect(res.headers.get('content-disposition')).toBe(`attachment; filename="${SHA}"`);
      expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    },
  );
});
