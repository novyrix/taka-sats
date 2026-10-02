// SPDX-License-Identifier: AGPL-3.0-only

'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useConsoleUser } from '@/components/console/context';
import { usePaged } from '@/components/console/hooks';
import {
  DataState,
  DomainPill,
  LoadMore,
  Mono,
  PageHeader,
  TableWrap,
  Td,
  TextField,
  Th,
} from '@/components/console/kit';
import { query } from '@/lib/console/api';
import { formatDateTime, formatKg } from '@/lib/console/format';

export type EventRow = {
  id: string;
  seq: number;
  collector: { id: string; alias: string; publicCode: string };
  supervisorId: string;
  material: string;
  weightKg: number;
  recordedAt: string;
  payout: { id: string; status: string; amountSats: number | null } | null;
  openFlags: number;
};

/** Collection events, newest first, each linking to its verification picture. */
export function Events() {
  const t = useTranslations('Console.events');
  const user = useConsoleUser();
  const [material, setMaterial] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const toIso = (local: string): string | undefined => {
    if (!local) {
      return undefined;
    }
    const d = new Date(local);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  };

  const list = usePaged<EventRow>(
    `/events${query({ material: material.trim().toUpperCase(), from: toIso(from), to: toIso(to), limit: 50 })}`,
    'events',
  );

  return (
    <div>
      <PageHeader title={t('title')} description={t('intro')} />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <TextField
          label={t('material')}
          value={material}
          onChange={(e) => setMaterial(e.target.value)}
          placeholder="PET"
          autoComplete="off"
        />
        <TextField
          label={t('from')}
          type="datetime-local"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <TextField
          label={t('to')}
          type="datetime-local"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
      </div>

      <DataState
        loading={list.loading}
        error={list.error}
        empty={list.items.length === 0}
        emptyText={t('empty')}
        onRetry={list.reload}
      >
        <TableWrap minWidth="48rem">
          <thead>
            <tr>
              <Th>{t('col.when')}</Th>
              <Th>{t('col.collector')}</Th>
              <Th>{t('col.weight')}</Th>
              <Th>{t('col.payout')}</Th>
              <Th>{t('col.flags')}</Th>
            </tr>
          </thead>
          <tbody>
            {list.items.map((e) => (
              <tr key={e.id} data-testid="event-row">
                <Td>
                  <Link href={`/events/${e.id}`} className="font-medium underline">
                    {formatDateTime(e.recordedAt, user.timeZone)}
                  </Link>
                  <div className="text-xs text-muted-foreground">#{e.seq}</div>
                </Td>
                <Td>
                  {e.collector.alias}
                  <div>
                    <Mono>{e.collector.publicCode}</Mono>
                  </div>
                </Td>
                <Td>
                  {e.material} {formatKg(e.weightKg)}
                </Td>
                <Td>
                  {e.payout ? (
                    <DomainPill domain="payout" value={e.payout.status} />
                  ) : (
                    <span className="text-muted-foreground">{t('noPayout')}</span>
                  )}
                </Td>
                <Td>
                  {e.openFlags > 0 ? (
                    <span className="font-medium">{t('flags', { count: e.openFlags })}</span>
                  ) : (
                    <span className="text-muted-foreground">{t('none')}</span>
                  )}
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
