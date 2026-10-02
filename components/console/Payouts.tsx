// SPDX-License-Identifier: AGPL-3.0-only

'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useConsoleUser } from '@/components/console/context';
import { useApi, useAutoRefresh, usePaged } from '@/components/console/hooks';
import {
  DataState,
  DomainPill,
  LoadMore,
  Mono,
  PageHeader,
  Panel,
  Select,
  TableWrap,
  Td,
  Th,
} from '@/components/console/kit';
import { PayoutActions, type PayoutRow } from '@/components/console/PayoutActions';
import { query } from '@/lib/console/api';
import { formatDateTime, formatFiat, formatSats } from '@/lib/console/format';
import { PAYOUT_STATES } from '@/lib/console/status-map';

type Summary = {
  byStatus: { status: string; count: number; totalSats: number }[];
  total: { count: number; totalSats: number };
};

/** Payouts: state filter, counts per state, approve / retry, and a link to each payout. */
export function Payouts() {
  const t = useTranslations('Console.payouts');
  const user = useConsoleUser();
  const params = useSearchParams();
  const initial = params.get('status') ?? '';
  const [status, setStatus] = useState(PAYOUT_STATES.some((s) => s === initial) ? initial : '');
  const summary = useApi<Summary>('/payouts/summary');
  const list = usePaged<PayoutRow>(`/payouts${query({ status, limit: 50 })}`, 'payouts');

  function changed(): void {
    summary.reload();
    list.reload();
  }
  useAutoRefresh(changed);

  return (
    <div>
      <PageHeader title={t('title')} description={t('intro')} />

      <Panel title={t('summary')} className="mb-4">
        <DataState loading={summary.loading} error={summary.error} onRetry={summary.reload}>
          <ul className="flex flex-wrap gap-2" aria-label={t('summary')}>
            {summary.data?.byStatus.map((row) => (
              <li key={row.status}>
                <button
                  type="button"
                  onClick={() => setStatus(row.status === status ? '' : row.status)}
                  aria-pressed={status === row.status}
                  className="flex min-h-11 items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm hover:bg-accent aria-pressed:bg-accent"
                >
                  <span>{t(`filters.${row.status}`)}</span>
                  <span className="font-display font-bold">{row.count}</span>
                </button>
              </li>
            ))}
          </ul>
          {summary.data ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {t('totalPriced', { sats: formatSats(summary.data.total.totalSats) })}
            </p>
          ) : null}
        </DataState>
      </Panel>

      <div className="mb-4">
        <label className="inline-block space-y-1.5">
          <span className="block font-display text-xs font-medium uppercase tracking-[0.02em] text-muted-foreground">
            {t('filter')}
          </span>
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            data-testid="payout-status-filter"
          >
            <option value="">{t('filters.all')}</option>
            {PAYOUT_STATES.map((s) => (
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
        emptyText={t('empty')}
        onRetry={list.reload}
      >
        <TableWrap minWidth="56rem">
          <thead>
            <tr>
              <Th>{t('col.collector')}</Th>
              <Th>{t('col.status')}</Th>
              <Th>{t('col.amount')}</Th>
              <Th>{t('col.created')}</Th>
              <Th>{t('col.actions')}</Th>
            </tr>
          </thead>
          <tbody>
            {list.items.map((p) => (
              <tr key={p.id} data-testid="payout-row">
                <Td>
                  <Link href={`/payouts/${p.id}`} className="font-medium underline">
                    {p.collectorAlias}
                  </Link>
                  <div>
                    <Mono>{p.collectorPublicCode}</Mono>
                  </div>
                </Td>
                <Td>
                  <div className="space-y-1">
                    <DomainPill domain="payout" value={p.status} />
                    {p.lastError ? (
                      <div className="font-mono text-xs text-muted-foreground">{p.lastError}</div>
                    ) : null}
                    {p.openFlags > 0 ? (
                      <div className="text-xs font-medium">
                        {t('flags', { count: p.openFlags })}
                      </div>
                    ) : null}
                  </div>
                </Td>
                <Td>
                  <div>{formatSats(p.amountSats)}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatFiat(p.amountFiatMinor, p.fiatCurrency)}
                  </div>
                </Td>
                <Td>{formatDateTime(p.createdAt, user.timeZone)}</Td>
                <Td>
                  <PayoutActions payout={p} onChanged={changed} />
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
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
