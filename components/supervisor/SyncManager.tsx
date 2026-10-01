// SPDX-License-Identifier: AGPL-3.0-only

'use client';

import { useCallback, useEffect } from 'react';
import { drainEventQueue, drainPhotoQueue } from '@/lib/sync';
import { QUEUE_CHANGED_EVENT } from '@/components/weigh/SyncStatusIndicator';

/** Keeps the browser outboxes moving while the signed-in PWA is open. */
export function SyncManager() {
  const drain = useCallback(async () => {
    if (!navigator.onLine) return;
    window.dispatchEvent(new Event(QUEUE_CHANGED_EVENT));
    await Promise.allSettled([drainPhotoQueue(), drainEventQueue()]);
    window.dispatchEvent(new Event(QUEUE_CHANGED_EVENT));
  }, []);

  useEffect(() => {
    void drain();
    window.addEventListener('online', drain);
    const timer = window.setInterval(() => void drain(), 30_000);
    return () => {
      window.removeEventListener('online', drain);
      window.clearInterval(timer);
    };
  }, [drain]);

  return null;
}
