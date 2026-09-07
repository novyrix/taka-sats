// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `POST /api/v1/photos` (FR-4.2, ROADMAP M3-10). The PWA's photo upload queue
 * drains here, independently of event sync. Raw image bytes in the body;
 * `Content-Type` is the image type; `X-Photo-Sha256` is the hex hash computed
 * on-device (D-12). The server recomputes it and rejects a mismatch — the
 * stored object is content-addressed (`photos/<sha256>`), so a resend is a
 * harmless overwrite. Scope `collection:record`.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse } from '@/lib/api/errors';
import { requireScope } from '@/lib/auth/session';
import { sha256HexBytes } from '@/lib/sync/contentHash';
import { putPhoto } from '@/lib/storage';

/** Hard cap on an upload — a downscaled JPEG is well under this (M3-5). */
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, 'expected a 64-char hex sha256');

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await requireScope('collection:record');

    const claimed = sha256Schema.parse(request.headers.get('x-photo-sha256') ?? '');
    const contentType = request.headers.get('content-type') ?? 'application/octet-stream';
    if (!contentType.startsWith('image/')) {
      return NextResponse.json(
        { error: { code: 'unsupported_media_type', message: 'Body must be an image' } },
        { status: 415 },
      );
    }

    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength === 0) {
      return NextResponse.json(
        { error: { code: 'invalid_request', message: 'Empty body' } },
        { status: 400 },
      );
    }
    if (bytes.byteLength > MAX_PHOTO_BYTES) {
      return NextResponse.json(
        { error: { code: 'payload_too_large', message: `Photo exceeds ${MAX_PHOTO_BYTES} bytes` } },
        { status: 413 },
      );
    }

    const actual = await sha256HexBytes(bytes);
    if (actual !== claimed) {
      return NextResponse.json(
        {
          error: {
            code: 'photo_hash_mismatch',
            message: 'The uploaded bytes do not match X-Photo-Sha256',
          },
        },
        { status: 422 },
      );
    }

    const { url } = await putPhoto(bytes, actual, contentType);
    return NextResponse.json({ photoUrl: url, sha256: actual }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
