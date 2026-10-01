// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `GET /api/v1/photos/:sha256` — a collection photo, streamed through the app.
 * Scope `collector:read` (staff only; a `partner` never sees evidence photos).
 *
 * The storage bucket is private and its URL (`collection_events.photo_url`) is an
 * internal address a browser cannot reach — render *this* URL instead. The object is
 * content-addressed, so the response is immutable and safe to cache privately for a
 * long time. 404 until the photo upload queue has delivered the bytes.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse } from '@/lib/api/errors';
import { requireScope } from '@/lib/auth/session';
import { baseMediaType, getPhoto, isAllowedPhotoType } from '@/lib/storage';

const paramsSchema = z.object({ sha256: z.string().regex(/^[0-9a-f]{64}$/) });

type RouteParams = { readonly params: Promise<{ sha256: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    await requireScope('collector:read');

    const { sha256 } = paramsSchema.parse(await params);
    const photo = await getPhoto(sha256);
    if (!photo) {
      return NextResponse.json(
        { error: { code: 'not_found', message: 'No photo is stored for that hash yet' } },
        { status: 404 },
      );
    }

    // Defence in depth: uploads are allow-listed, but anything else that is somehow in the
    // bucket is never rendered — it is served as an opaque download.
    const safe = isAllowedPhotoType(photo.contentType);
    return new NextResponse(Buffer.from(photo.bytes), {
      headers: {
        'content-type': safe ? baseMediaType(photo.contentType) : 'application/octet-stream',
        'content-disposition': safe ? 'inline' : `attachment; filename="${sha256}"`,
        'cache-control': 'private, max-age=31536000, immutable',
        // An evidence photo is only ever an image: even if something executable got through,
        // nothing may run, load or navigate (the app origin carries staff sessions).
        'content-security-policy': "default-src 'none'; sandbox",
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
