// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The offline write path (ROADMAP M3-8/M3-10, FR-4.1, US-4.3). One call:
 *
 *   1. assemble the event (id, time, indicative sats, content hash),
 *   2. write it to IndexedDB as `queued`,
 *   3. persist the photo bytes + an outbox entry for the photo upload queue,
 *   4. enqueue an outbox entry for the event sync loop (M4).
 *
 * It resolves only after step 2 has committed — the caller shows the "queued"
 * state *after* this promise, never before, so a supervisor is never told
 * their work is saved when it is not. Nothing here touches the network.
 */

import type { CollectionEventDraft } from '@/types/domain';
import { type AssembleOptions, assembleCollectionEvent } from './events';
import { enqueueOutbox, putEvent, putPhoto, type StoredEvent } from './store';

export type CapturePhoto = {
  readonly blob: Blob;
  /** Must equal `draft.photoSha256` — hex, the on-device hash. */
  readonly sha256: string;
  readonly contentType: string;
};

export async function captureCollectionEvent(
  draft: CollectionEventDraft,
  photo?: CapturePhoto,
  options: AssembleOptions = {},
): Promise<StoredEvent> {
  const event = await assembleCollectionEvent(draft, options);
  const stored = await putEvent(event); // must commit before we return

  if (photo) {
    await putPhoto({
      eventId: event.id,
      blob: photo.blob,
      sha256: photo.sha256,
      contentType: photo.contentType,
    });
    await enqueueOutbox({ id: `photo:${event.id}`, kind: 'photo', refId: event.id });
  }

  await enqueueOutbox({ id: event.id, kind: 'collection_event', refId: event.id });
  return stored;
}
