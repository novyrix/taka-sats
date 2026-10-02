// SPDX-License-Identifier: AGPL-3.0-only

'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useApi } from '@/components/console/hooks';
import {
  ActionButton,
  DataState,
  DomainPill,
  Mono,
  PageHeader,
  Select,
  TableWrap,
  Td,
  TextField,
  Th,
} from '@/components/console/kit';
import { api, query } from '@/lib/console/api';
import { maskAddress } from '@/lib/console/format';

export type CollectorRow = {
  id: string;
  alias: string;
  publicCode: string;
  nfcTagId: string | null;
  status: string;
  destination?: {
    status: string;
    providerHint: string | null;
    address: string | null;
  } | null;
};

const STATUSES = ['pending', 'active', 'revoked', 'all'] as const;

/** Collectors: the pending queue (authorize / revoke) and a searchable list of the rest. */
export function Collectors() {
  const t = useTranslations('Console.collectors');
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('pending');
  const [q, setQ] = useState('');
  const needsQuery = status === 'active' && q.trim().length === 0;
  const { data, error, loading, reload } = useApi<{ collectors: CollectorRow[] }>(
    needsQuery ? null : `/collectors${query({ status, q: q.trim(), limit: 100 })}`,
  );
  const rows = data?.collectors ?? [];

  return (
    <div>
      <PageHeader title={t('title')} description={t('intro')} />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="space-y-1.5">
          <span className="block font-display text-xs font-medium uppercase tracking-[0.02em] text-muted-foreground">
            {t('filter')}
          </span>
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value as (typeof STATUSES)[number])}
            data-testid="collector-status-filter"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`filters.${s}`)}
              </option>
            ))}
          </Select>
        </label>
        <div className="min-w-56 flex-1 sm:max-w-sm">
          <TextField
            label={t('search')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('searchPlaceholder')}
            autoComplete="off"
          />
        </div>
      </div>

      {needsQuery ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
          {t('needsQuery')}
        </p>
      ) : (
        <DataState
          loading={loading}
          error={error}
          empty={rows.length === 0}
          emptyText={status === 'pending' ? t('emptyPending') : t('empty')}
          onRetry={reload}
        >
          <TableWrap minWidth="52rem">
            <thead>
              <tr>
                <Th>{t('col.collector')}</Th>
                <Th>{t('col.status')}</Th>
                <Th>{t('col.wallet')}</Th>
                <Th>{t('col.tag')}</Th>
                <Th>{t('col.actions')}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} data-testid="collector-row">
                  <Td>
                    <Link href={`/collectors/${c.id}`} className="font-medium underline">
                      {c.alias}
                    </Link>
                    <div>
                      <Mono>{c.publicCode}</Mono>
                    </div>
                  </Td>
                  <Td>
                    <DomainPill domain="collector" value={c.status} />
                  </Td>
                  <Td>
                    {c.destination ? (
                      <div className="space-y-1">
                        <DomainPill domain="destination" value={c.destination.status} />
                        {c.destination.providerHint ? (
                          <div className="text-xs text-muted-foreground">
                            {c.destination.providerHint}
                          </div>
                        ) : null}
                        {c.destination.address ? (
                          <Mono>
                            {c.status === 'pending'
                              ? c.destination.address
                              : maskAddress(c.destination.address)}
                          </Mono>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">{t('noWallet')}</span>
                    )}
                  </Td>
                  <Td>{c.nfcTagId ? t('tagIssued') : t('tagNone')}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-2">
                      {c.status !== 'active' ? (
                        <ActionButton
                          label={c.status === 'revoked' ? t('reauthorize') : t('authorize')}
                          testId="authorize"
                          run={() =>
                            api(`/collectors/${c.id}/authorization`, {
                              method: 'POST',
                              body: { decision: 'authorize' },
                            })
                          }
                          onDone={reload}
                        />
                      ) : null}
                      {c.status !== 'revoked' ? (
                        <ActionButton
                          label={t('revoke')}
                          variant="outline"
                          confirm={t('revokeConfirm', { name: c.alias })}
                          run={() =>
                            api(`/collectors/${c.id}/authorization`, {
                              method: 'POST',
                              body: { decision: 'revoke' },
                            })
                          }
                          onDone={reload}
                        />
                      ) : null}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </DataState>
      )}
    </div>
  );
}
