// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The photo upload queue (FR-4.2). Drains `outbox` entries of
 * kind `photo`: read the stored blob → `POST /api/v1/photos` → on success set
 * the event's `photoUrl`, drop the outbox entry and the local blob; on failure
 * bump the attempt count and leave it for the next drain.
 *
 * Independent of event sync (M4) — a photo can land before or after its event.
 * Browser only.
 */

import {
  deletePhoto,
  getEvent,
  getPhoto,
  listOutbox,
  markOutboxAttempt,
  putEvent,
  removeOutbox,
  type StoredEvent,
} from './store';

export type PhotoDrainResult = {
  readonly uploaded: number;
  readonly failed: number;
  readonly skipped: number;
};

type UploadResponse = { photoUrl?: string };

export const PHOTO_REQUEST_TIMEOUT_MS = 180_000;

/** @param fetchImpl injectable for tests. */
export async function drainPhotoQueue(fetchImpl: typeof fetch = fetch): Promise<PhotoDrainResult> {
  const entries = await listOutbox('photo');
  let uploaded = 0;
  let failed = 0;
  let skipped = 0;

  for (const entry of entries) {
    const photo = await getPhoto(entry.refId);
    if (!photo) {
      // The blob is gone (already uploaded, or evicted) — clear the stale entry.
      await removeOutbox(entry.id);
      skipped += 1;
      continue;
    }

    try {
      const res = await fetchImpl('/api/v1/photos', {
        method: 'POST',
        headers: { 'content-type': photo.contentType, 'x-photo-sha256': photo.sha256 },
        body: photo.blob,
        // A photo can be several megabytes on a slow link, so allow longer than an event batch.
        signal: AbortSignal.timeout(PHOTO_REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        await markOutboxAttempt(entry.id);
        failed += 1;
        continue;
      }
      const body = (await res.json().catch(() => ({}))) as UploadResponse;
      const event = await getEvent(entry.refId);
      if (event && body.photoUrl) {
        const updated: StoredEvent = { ...event, photoUrl: body.photoUrl };
        await putEvent(updated, updated.syncStatus);
      }
      await removeOutbox(entry.id);
      await deletePhoto(entry.refId);
      uploaded += 1;
    } catch {
      await markOutboxAttempt(entry.id);
      failed += 1;
    }
  }

  return { uploaded, failed, skipped };
}
