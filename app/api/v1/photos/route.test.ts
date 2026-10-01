// SPDX-License-Identifier: AGPL-3.0-only

import type { Session } from 'next-auth';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn() }));
// Keep the real allow-list helpers; only the S3 call is faked.
vi.mock('@/lib/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/storage')>()),
  putPhoto: vi.fn(async (_bytes: Uint8Array, sha256: string) => ({
    key: `photos/${sha256}`,
    url: `https://minio/taka-sats/photos/${sha256}`,
  })),
}));

import { auth } from '@/auth';
import { putPhoto } from '@/lib/storage';
import { sha256HexBytes } from '@/lib/sync/contentHash';
import { POST } from './route';

const authMock = auth as unknown as { mockResolvedValue: (value: Session | null) => void };
const session = (role: string): Session => ({
  user: { id: 'actor-1', role: role as never, locale: 'en' },
  expires: '2099-01-01T00:00:00.000Z',
});

const BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

function req(body: BodyInit | null, headers: Record<string, string>): NextRequest {
  return new NextRequest('http://localhost/api/v1/photos', { method: 'POST', body, headers });
}

beforeEach(() => {
  vi.mocked(putPhoto).mockClear();
});

describe('POST /api/v1/photos', () => {
  it('401 without a session', async () => {
    authMock.mockResolvedValue(null);
    const res = await POST(
      req(BYTES, { 'content-type': 'image/jpeg', 'x-photo-sha256': 'a'.repeat(64) }),
    );
    expect(res.status).toBe(401);
  });

  it('403 for a partner (no collection:record)', async () => {
    authMock.mockResolvedValue(session('partner'));
    const res = await POST(
      req(BYTES, { 'content-type': 'image/jpeg', 'x-photo-sha256': 'a'.repeat(64) }),
    );
    expect(res.status).toBe(403);
  });

  it('400 for a bad sha256 header', async () => {
    authMock.mockResolvedValue(session('supervisor'));
    const res = await POST(req(BYTES, { 'content-type': 'image/jpeg', 'x-photo-sha256': 'nope' }));
    expect(res.status).toBe(400);
  });

  it('415 for a non-image content type', async () => {
    authMock.mockResolvedValue(session('supervisor'));
    const res = await POST(
      req(BYTES, { 'content-type': 'application/pdf', 'x-photo-sha256': 'a'.repeat(64) }),
    );
    expect(res.status).toBe(415);
  });

  it.each([
    'image/svg+xml',
    'image/svg+xml; charset=utf-8',
    'IMAGE/SVG+XML',
    'image/gif',
    'image/x-icon',
    'text/html',
    'image/', // a prefix is not a type
  ])('415 for %s — only raster photos are stored (stored-XSS defence)', async (contentType) => {
    authMock.mockResolvedValue(session('supervisor'));
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>',
    );
    const res = await POST(
      req(svg, { 'content-type': contentType, 'x-photo-sha256': await sha256HexBytes(svg) }),
    );
    expect(res.status).toBe(415);
    expect(putPhoto).not.toHaveBeenCalled();
  });

  it.each(['image/jpeg', 'image/png', 'image/webp', 'image/jpeg; charset=binary'])(
    'accepts %s',
    async (contentType) => {
      authMock.mockResolvedValue(session('supervisor'));
      const sha = await sha256HexBytes(BYTES);
      const res = await POST(req(BYTES, { 'content-type': contentType, 'x-photo-sha256': sha }));
      expect(res.status).toBe(201);
    },
  );

  it('422 when the bytes do not match the claimed hash', async () => {
    authMock.mockResolvedValue(session('supervisor'));
    const res = await POST(
      req(BYTES, { 'content-type': 'image/jpeg', 'x-photo-sha256': 'b'.repeat(64) }),
    );
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe('photo_hash_mismatch');
    expect(putPhoto).not.toHaveBeenCalled();
  });

  it('201 + photoUrl on a matching hash', async () => {
    authMock.mockResolvedValue(session('supervisor'));
    const sha = await sha256HexBytes(BYTES);
    const res = await POST(req(BYTES, { 'content-type': 'image/jpeg', 'x-photo-sha256': sha }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({ photoUrl: `https://minio/taka-sats/photos/${sha}`, sha256: sha });
    expect(putPhoto).toHaveBeenCalledOnce();
  });
});
