// SPDX-License-Identifier: AGPL-3.0-only

'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useConsoleUser } from '@/components/console/context';
import { usePaged } from '@/components/console/hooks';
import {
  ActionButton,
  DataState,
  DomainPill,
  LoadMore,
  Mono,
  PageHeader,
  Panel,
  Select,
  TextField,
} from '@/components/console/kit';
import { api, query } from '@/lib/console/api';
import { formatDateTime } from '@/lib/console/format';

type HistoryEntry = {
  outcome: string;
  reviewedBy: string;
  reviewedAt: string;
  note: string | null;
};
type Anomaly = {
  id: string;
  type: string;
  status: 'open' | 'confirmed' | 'dismissed';
  eventId: string | null;
  sessionId: string | null;
  detectedAt: string;
  context: Record<string, unknown> | null;
  collector: { id: string; alias: string; publicCode: string } | null;
  supervisor: { id: string; name: string } | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
};

const STATUSES = ['open', 'confirmed', 'dismissed', 'all'] as const;

function contextPairs(context: Record<string, unknown> | null): [string, string][] {
  if (!context) {
    return [];
  }
  return Object.entries(context)
    .filter(([key, value]) => key !== 'history' && typeof value !== 'object')
    .map(([key, value]) => [key, String(value)]);
}

/** The anomaly queue: flags are notes for a person; a different admin may overturn a verdict. */
export function Anomalies() {
  const t = useTranslations('Console.anomalies');
  const tf = useTranslations('Console.events.flagTypes');
  const user = useConsoleUser();
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('open');
  const list = usePaged<Anomaly>(`/anomalies${query({ status, limit: 50 })}`, 'anomalies');

  return (
    <div>
      <PageHeader title={t('title')} description={t('intro')} />
      <div className="mb-4">
        <label className="inline-block space-y-1.5">
          <span className="block font-display text-xs font-medium uppercase tracking-[0.02em] text-muted-foreground">
            {t('filter')}
          </span>
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value as (typeof STATUSES)[number])}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`filters.${s}`)}
              </option>
            ))}
          </Select>
        </label>
      </div>
      <DataState
        loading={list.loading}
        error={list.error}
        empty={list.items.length === 0}
        emptyText={status === 'open' ? t('emptyOpen') : t('empty')}
        onRetry={list.reload}
      >
        <ul className="space-y-3">
          {list.items.map((a) => (
            <li key={a.id}>
              <AnomalyCard
                anomaly={a}
                tz={user.timeZone}
                label={tf.has(a.type) ? tf(a.type) : a.type}
                onChanged={list.reload}
              />
            </li>
          ))}
        </ul>
        <LoadMore
          hasMore={list.hasMore}
          busy={list.loadingMore}
          error={list.moreError}
          onMore={() => void list.loadMore()}
        />
      </DataState>
    </div>
  );
}

function AnomalyCard({
  anomaly: a,
  tz,
  label,
  onChanged,
}: {
  readonly anomaly: Anomaly;
  readonly tz: string;
  readonly label: string;
  readonly onChanged: () => void;
}) {
  const t = useTranslations('Console.anomalies');
  const [note, setNote] = useState('');
  const history = (Array.isArray(a.context?.history) ? a.context.history : []) as HistoryEntry[];
  const pairs = contextPairs(a.context);
  const review = (outcome: 'confirmed' | 'dismissed') => () =>
    api(`/anomalies/${a.id}/review`, {
      method: 'POST',
      body: { outcome, ...(note.trim() && { note: note.trim() }) },
    });

  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-base font-bold">{label}</h2>
        <DomainPill domain="anomaly" value={a.status} />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(a.detectedAt, tz)}</p>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {a.collector ? (
          <Link href={`/collectors/${a.collector.id}`} className="underline">
            {a.collector.alias} ({a.collector.publicCode})
          </Link>
        ) : null}
        {a.supervisor ? <span>{t('supervisor', { name: a.supervisor.name })}</span> : null}
        {a.eventId ? (
          <Link href={`/events/${a.eventId}`} className="underline">
            {t('openEvent')}
          </Link>
        ) : null}
      </div>
      {pairs.length > 0 ? (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 text-xs text-muted-foreground">
          {pairs.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="font-mono">{k}</dt>
              <dd className="font-mono break-all">{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {a.reviewedAt ? (
        <p className="mt-2 text-sm">
          {t('reviewed', { when: formatDateTime(a.reviewedAt, tz) })}
          {a.reviewNote ? `: ${a.reviewNote}` : ''}{' '}
          {a.reviewedBy ? <Mono>{a.reviewedBy}</Mono> : null}
        </p>
      ) : null}
      {history.length > 0 ? (
        <div className="mt-2 text-xs text-muted-foreground">
          <p className="font-medium">{t('history')}</p>
          <ul>
            {history.map((h, i) => (
              <li key={`${h.reviewedAt}-${i}`}>
                {h.outcome}, {formatDateTime(h.reviewedAt, tz)}
                {h.note ? `: ${h.note}` : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="mt-3 max-w-lg space-y-3 border-t border-border pt-3">
        <TextField
          label={t('note')}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={1000}
        />
        <div className="flex flex-wrap gap-2">
          {a.status !== 'confirmed' ? (
            <ActionButton
              label={t('confirm')}
              testId="flag-confirm"
              run={review('confirmed')}
              onDone={onChanged}
            />
          ) : null}
          {a.status !== 'dismissed' ? (
            <ActionButton
              label={t('dismiss')}
              variant="outline"
              testId="flag-dismiss"
              run={review('dismissed')}
              onDone={onChanged}
            />
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">{t('overturnHint')}</p>
      </div>
    </Panel>
  );
}
