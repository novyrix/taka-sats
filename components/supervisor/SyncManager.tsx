// SPDX-License-Identifier: AGPL-3.0-only

'use client';

import { useCallback, useEffect } from 'react';
import { QUEUE_CHANGED_EVENT, SyncStatusIndicator } from '@/components/weigh/SyncStatusIndicator';
import { drainEventQueue, drainPhotoQueue } from '@/lib/sync';

/**
 * Keeps the browser outboxes moving while the signed-in PWA is open (on mount, whenever the
 * phone comes back online, and every 30 seconds), and shows the sync status bar. A 401 does not
 * lose anything: the events stay queued, the bar asks the person to sign in, and the first drain
 * after sign-in sends them.
 */
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

  return <SyncStatusIndicator />;
}
