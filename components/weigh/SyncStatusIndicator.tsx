// SPDX-License-Identifier: AGPL-3.0-only

'use client';

import { CircleDashed } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { countEventsByState } from '@/lib/sync';

/** Fired by the weigh flow after an event is queued, so the bar can refresh. */
export const QUEUE_CHANGED_EVENT = 'takasats:queue-changed';

/**
 * The sticky sync-status bar (DESIGN §11.3, ROADMAP M3-8). M3 shows only the
 * `Queued (n)` state — shape + colour + text — and nothing when the queue is
 * empty. `Syncing…`, `All synced ✓` (with the 3s collapse) and `needs
 * attention` arrive with M4's sync loop.
 */
export function SyncStatusIndicator() {
  const t = useTranslations('Weigh');
  const [queued, setQueued] = useState(0);

  const refresh = useCallback(() => {
    void countEventsByState('queued').then(setQueued);
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener(QUEUE_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(QUEUE_CHANGED_EVENT, refresh);
  }, [refresh]);

  if (queued === 0) {
    return null;
  }

  // Tapping the bar opens the queue (DESIGN §11.3).
  return (
    <Link
      href="/session"
      role="status"
      className="sticky top-0 z-10 flex min-h-[44px] items-center gap-2 border-b border-border bg-background px-4 py-2 font-display text-xs font-medium uppercase tracking-[0.02em] text-muted-foreground active:bg-accent/40"
    >
      <CircleDashed aria-hidden="true" className="size-4 shrink-0" />
      <span>{t('queued', { count: queued })}</span>
    </Link>
  );
}
