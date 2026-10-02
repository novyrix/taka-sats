// SPDX-License-Identifier: AGPL-3.0-only

'use client';

import { RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useApi } from '@/components/console/hooks';
import { Button } from '@/components/ui/button';

type Row = { id: string; alias: string; publicCode: string };

/**
 * The supervisor's own registrations that are still waiting for a hub lead to authorize them.
 * Once authorized a collector leaves this list and shows up in the weigh screen after the next
 * "Sync data". Needs the network; offline it says so instead of guessing.
 */
export function MyRegistrations() {
  const t = useTranslations('Enrol.mine');
  const { data, error, loading, reload } = useApi<{ collectors: Row[] }>(
    '/collectors?status=pending&limit=50',
  );
  const rows = data?.collectors ?? null;
  const state = error
    ? error.code === 'network'
      ? 'offline'
      : 'error'
    : loading
      ? 'loading'
      : 'ready';
  const load = reload;

  return (
    <section aria-labelledby="mine-h" className="space-y-3 border-t border-border pt-5">
      <div className="flex items-center justify-between gap-3">
        <h2 id="mine-h" className="font-display text-base font-bold">
          {t('title')}
        </h2>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11"
          onClick={() => void load()}
        >
          <RefreshCw aria-hidden="true" />
          {t('refresh')}
        </Button>
      </div>
      {state === 'loading' && rows === null ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t('loading')}
        </p>
      ) : state === 'offline' ? (
        <p className="text-sm text-muted-foreground">{t('offline')}</p>
      ) : state === 'error' ? (
        <p role="alert" className="text-sm text-destructive">
          {t('error')}
        </p>
      ) : rows && rows.length > 0 ? (
        <ul
          className="divide-y divide-border rounded-lg border border-border"
          data-testid="my-pending"
        >
          {rows.map((c) => (
            <li key={c.id} className="flex min-h-14 items-center justify-between gap-3 px-4 py-2">
              <span className="min-w-0">
                <span className="block truncate font-medium">{c.alias}</span>
                <span className="font-mono text-xs text-muted-foreground">{c.publicCode}</span>
              </span>
              <span className="shrink-0 text-xs font-medium">{t('waiting')}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t('none')}</p>
      )}
      <p className="text-xs text-muted-foreground">{t('hint')}</p>
    </section>
  );
}
