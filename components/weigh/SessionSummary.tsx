// SPDX-License-Identifier: AGPL-3.0-only

'use client';

import { RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/ui/status';
import {
  drainEventQueue,
  drainPhotoQueue,
  getCachedCollector,
  requeueEvent,
  sessionSummary,
  type SessionSummary as Summary,
} from '@/lib/sync';
import { isDisplayStatus } from '@/lib/status';
import { QUEUE_CHANGED_EVENT } from './SyncStatusIndicator';

const fmt = new Intl.NumberFormat('en');

/**
 * End-of-session rollup + the queue list (DESIGN section 11.3). Reads the local `events` store
 * only. Items the server refused come first, each with the reason in plain words (translated from
 * the stable code) and a Try again button that re-queues it once the cause is fixed. "Sync now"
 * drains the outboxes directly and says what happened, including that the person is signed out.
 */
export function SessionSummary({ sessionId }: { readonly sessionId?: string }) {
  const t = useTranslations('SessionSummary');
  const tStatus = useTranslations('Status');
  const tSync = useTranslations('Sync');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    void sessionSummary(sessionId).then(async (s) => {
      setSummary(s);
      const ids = [...new Set(s.events.map((e) => e.collectorId))];
      const entries = await Promise.all(
        ids.map(async (id) => [id, (await getCachedCollector(id))?.alias] as const),
      );
      setNames(
        Object.fromEntries(entries.filter((entry): entry is [string, string] => Boolean(entry[1]))),
      );
    });
  }, [sessionId]);

  useEffect(() => {
    refresh();
    window.addEventListener(QUEUE_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(QUEUE_CHANGED_EVENT, refresh);
  }, [refresh]);

  const syncNow = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    if (!navigator.onLine) {
      setMessage(tSync('offlineNow'));
      setBusy(false);
      return;
    }
    window.dispatchEvent(new Event(QUEUE_CHANGED_EVENT));
    const [, events] = await Promise.all([
      drainPhotoQueue().catch(() => null),
      drainEventQueue().catch(() => null),
    ]);
    setBusy(false);
    window.dispatchEvent(new Event(QUEUE_CHANGED_EVENT));
    if (events?.signedOut) {
      setMessage(tSync('signedOutNow'));
    } else if (events && events.retryable > 0) {
      setMessage(tSync('serverUnreachable'));
    } else if (events && events.needsAttention > 0) {
      setMessage(tSync('someNeedAttention', { count: events.needsAttention }));
    }
  }, [tSync]);

  async function tryAgain(id: string): Promise<void> {
    await requeueEvent(id);
    window.dispatchEvent(new Event(QUEUE_CHANGED_EVENT));
    await syncNow();
  }

  if (!summary) {
    return <p className="text-sm text-muted-foreground">{t('loading')}</p>;
  }

  const pending = summary.byState.queued + summary.byState.syncing + summary.byState.failed;
  // Items that need a person first, then the rest in the order the store returned them.
  const events = [...summary.events].sort(
    (a, b) =>
      Number(b.syncStatus.state === 'needs_attention') -
      Number(a.syncStatus.state === 'needs_attention'),
  );

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

      <Button
        type="button"
        size="pwa"
        variant="outline"
        onClick={() => void syncNow()}
        disabled={busy || pending === 0}
        data-testid="sync-now"
      >
        <RefreshCw className="size-5" aria-hidden="true" />
        {busy ? tSync('syncing') : pending > 0 ? t('syncNow', { count: pending }) : t('allSynced')}
      </Button>
      {message ? (
        <p role="status" className="text-sm" data-testid="sync-message">
          {message}{' '}
          {message === tSync('signedOutNow') ? (
            <Link href="/login" className="underline">
              {tSync('signInAgain')}
            </Link>
          ) : null}
        </p>
      ) : null}

      {events.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          {t('empty')}
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {events.map((e) => {
            const status = e.syncStatus;
            const attention = status.state === 'needs_attention';
            const code = attention ? status.code : undefined;
            return (
              <li
                key={e.id}
                id={`event-${e.id}`}
                data-testid="queue-item"
                data-state={status.state}
                className={`px-4 py-3 ${attention ? 'bg-secondary' : ''}`}
              >
                <div className="flex min-h-11 items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {names[e.collectorId] ?? t('unknownCollector')} · {e.material}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {e.weightKg.toFixed(3)} kg · ≈ {fmt.format(e.indicativeSats)} sats
                    </span>
                  </span>
                  {isDisplayStatus(status.state) ? (
                    <StatusPill
                      status={status.state}
                      label={tStatus(status.state)}
                      className="shrink-0"
                    />
                  ) : null}
                </div>
                {attention ? (
                  <div className="mt-2 space-y-2">
                    <p className="text-sm" data-testid="attention-reason">
                      {code && tSync.has(`reasons.${code}`)
                        ? tSync(`reasons.${code}`)
                        : tSync('reasons.unknown')}
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="min-h-11"
                      disabled={busy}
                      onClick={() => void tryAgain(e.id)}
                    >
                      {tSync('tryAgain')}
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
