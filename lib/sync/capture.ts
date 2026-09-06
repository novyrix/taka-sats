// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The offline write path (ROADMAP M3-8, FR-4.1, US-4.3). One call:
 *
 *   1. assemble the event (id, time, indicative sats, content hash),
 *   2. write it to IndexedDB as `queued`,
 *   3. enqueue an outbox entry for the sync loop (M4).
 *
 * It resolves only after step 2 has committed — the caller shows the "queued"
 * state *after* this promise, never before, so a supervisor is never told
 * their work is saved when it is not. Nothing here touches the network.
 */

import type { CollectionEventDraft } from '@/types/domain';
import { type AssembleOptions, assembleCollectionEvent } from './events';
import { enqueueOutbox, putEvent, type StoredEvent } from './store';

export async function captureCollectionEvent(
  draft: CollectionEventDraft,
  options: AssembleOptions = {},
): Promise<StoredEvent> {
  const event = await assembleCollectionEvent(draft, options);
  const stored = await putEvent(event); // must commit before we return
  await enqueueOutbox({ id: event.id, kind: 'collection_event', refId: event.id });
  return stored;
}
