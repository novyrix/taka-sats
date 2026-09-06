// SPDX-License-Identifier: AGPL-3.0-only

'use client';

import { RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/ui/status';
import { sessionSummary, type SessionSummary as Summary } from '@/lib/sync';
import { isDisplayStatus } from '@/lib/status';
import { QUEUE_CHANGED_EVENT } from './SyncStatusIndicator';

const fmt = new Intl.NumberFormat('en');

/**
 * End-of-session rollup + the queue list (DESIGN §11.3, ROADMAP M3-9). Reads
 * the local `events` store only. "Sync now" nudges the service worker to drain
 * the outbox — a no-op until M4's sync loop lands, but the wiring is real.
 */
export function SessionSummary({ sessionId }: { readonly sessionId?: string }) {
  const t = useTranslations('SessionSummary');
  const tStatus = useTranslations('Status');
  const [summary, setSummary] = useState<Summary | null>(null);

  const refresh = useCallback(() => {
    void sessionSummary(sessionId).then(setSummary);
  }, [sessionId]);

  useEffect(() => {
    refresh();
    window.addEventListener(QUEUE_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(QUEUE_CHANGED_EVENT, refresh);
  }, [refresh]);

  const syncNow = useCallback(() => {
    if (typeof navigator !== 'undefined' && navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'takasats:drain-outbox' });
    }
    refresh();
  }, [refresh]);

  if (!summary) {
    return <p className="text-sm text-muted-foreground">{t('loading')}</p>;
  }

  const pending = summary.byState.queued + summary.byState.syncing + summary.byState.failed;

  return (
    <div className="space-y-6">
      <dl className="grid grid-cols-2 gap-3">
        {[
          [t('events'), fmt.format(summary.count)],
          [t('kg'), summary.totalKg.toFixed(3)],
          [t('sats'), `≈ ${fmt.format(summary.totalIndicativeSats)}`],
          [t('walkIns'), fmt.format(summary.walkInCount)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-border bg-card px-4 py-3">
            <dt className="font-display text-xs font-medium uppercase tracking-[0.02em] text-muted-foreground">
              {label}
            </dt>
            <dd className="mt-1 font-mono text-lg tabular-nums text-foreground">{value}</dd>
          </div>
        ))}
      </dl>

      <Button type="button" size="pwa" variant="outline" onClick={syncNow} disabled={pending === 0}>
        <RefreshCw className="size-5" aria-hidden="true" />
        {pending > 0 ? t('syncNow', { count: pending }) : t('allSynced')}
      </Button>

      {summary.events.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          {t('empty')}
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {summary.events.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="min-w-0">
                <span className="block truncate font-medium">{e.material}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {e.weightKg.toFixed(3)} kg · ≈ {fmt.format(e.indicativeSats)} sats
                </span>
              </span>
              {isDisplayStatus(e.syncStatus.state) ? (
                <StatusPill
                  status={e.syncStatus.state}
                  label={tStatus(e.syncStatus.state)}
                  className="shrink-0"
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
