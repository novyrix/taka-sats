// SPDX-License-Identifier: AGPL-3.0-only

'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { useConsoleUser } from '@/components/console/context';
import { useApi, useStaffNames } from '@/components/console/hooks';
import {
  ActionButton,
  DataState,
  DomainPill,
  Empty,
  ErrorNotice,
  Field,
  KeyValue,
  Mono,
  PageHeader,
  Panel,
  TableWrap,
  Td,
  TextField,
  Textarea,
  Th,
} from '@/components/console/kit';
import { Button } from '@/components/ui/button';
import { type ApiFail, api } from '@/lib/console/api';
import { formatDateTime, formatSats } from '@/lib/console/format';

type Destination = {
  id: string;
  address: string | null;
  providerHint: string | null;
  status: string;
  validationError: string | null;
  verifiedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
};
type CollectorFull = {
  id: string;
  alias: string;
  publicCode: string;
  status: string;
  nfcTagId: string | null;
  reference: { payload: string; url: string };
  enrolledAt: string;
  registeredBy: string | null;
  authorizedBy: string | null;
  authorizedAt: string | null;
};
type EventRow = {
  id: string;
  material: string;
  weightKg: number;
  recordedAt: string;
  payout: { status: string; amountSats: number | null } | null;
  openFlags: number;
};
type PayoutRow = {
  id: string;
  status: string;
  amountSats: number | null;
  createdAt: string;
};

/** One collector: authorization, wallet, tag, and the recent events and payouts. */
export function CollectorDetail({ id }: { readonly id: string }) {
  const t = useTranslations('Console.collectors');
  const user = useConsoleUser();
  const one = useApi<{ collector: CollectorFull; destination: Destination | null }>(
    `/collectors/${id}`,
  );
  const history = useApi<{ destinations: Destination[] }>(`/collectors/${id}/destinations`);
  const events = useApi<{ events: EventRow[] }>(`/events?collectorId=${id}&limit=10`);
  const payouts = useApi<{ payouts: PayoutRow[] }>(`/payouts?collectorId=${id}&limit=10`);
  const [reason, setReason] = useState('');
  const [rawCode, setRawCode] = useState('');
  const [attachError, setAttachError] = useState<ApiFail | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [attachNote, setAttachNote] = useState<string | null>(null);

  const collector = one.data?.collector;
  const destination = one.data?.destination ?? null;
  const tz = user.timeZone;
  const nameOf = useStaffNames(user.can('session:configure'));

  function reloadAll(): void {
    one.reload();
    history.reload();
  }

  async function onAttach(event: FormEvent): Promise<void> {
    event.preventDefault();
    setAttaching(true);
    setAttachError(null);
    setAttachNote(null);
    const res = await api<{ destination: Destination }>(`/collectors/${id}/destinations`, {
      method: 'POST',
      body: { rawCode: rawCode.trim() },
    });
    setAttaching(false);
    if (res.ok) {
      setRawCode('');
      setAttachNote(res.status === 202 ? t('attachedPending') : t('attachedVerified'));
      reloadAll();
    } else {
      setAttachError(res);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={collector?.alias ?? t('detailTitle')}
        actions={
          <Link href="/collectors" className="text-sm underline">
            {t('backToList')}
          </Link>
        }
      />
      <DataState loading={one.loading} error={one.error} onRetry={one.reload}>
        {collector ? (
          <>
            <Panel title={t('identity')}>
              <KeyValue
                items={[
                  {
                    k: t('col.status'),
                    v: <DomainPill domain="collector" value={collector.status} />,
                  },
                  { k: t('publicCode'), v: <Mono>{collector.publicCode}</Mono> },
                  { k: t('qrPayload'), v: <Mono>{collector.reference.payload}</Mono> },
                  { k: t('enrolledAt'), v: formatDateTime(collector.enrolledAt, tz) },
                  {
                    k: t('registeredBy'),
                    v: collector.registeredBy ? nameOf(collector.registeredBy) : t('unknown'),
                  },
                  {
                    k: t('authorizedBy'),
                    v: collector.authorizedBy ? (
                      <>
                        {nameOf(collector.authorizedBy)}
                        {collector.authorizedAt ? (
                          <span className="ml-2 text-muted-foreground">
                            {formatDateTime(collector.authorizedAt, tz)}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      t('notYet')
                    ),
                  },
                  {
                    k: t('col.tag'),
                    v: collector.nfcTagId ? <Mono>{collector.nfcTagId}</Mono> : t('tagNone'),
                  },
                ]}
              />
              <div className="mt-4 space-y-3">
                <Field label={t('reason')} hint={t('reasonHint')}>
                  {(fid) => (
                    <Textarea
                      id={fid}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      maxLength={500}
                    />
                  )}
                </Field>
                <div className="flex flex-wrap gap-2">
                  {collector.status !== 'active' ? (
                    <ActionButton
                      label={collector.status === 'revoked' ? t('reauthorize') : t('authorize')}
                      testId="authorize"
                      run={() =>
                        api(`/collectors/${id}/authorization`, {
                          method: 'POST',
                          body: {
                            decision: 'authorize',
                            ...(reason.trim() && { reason: reason.trim() }),
                          },
                        })
                      }
                      onDone={reloadAll}
                    />
                  ) : null}
                  {collector.status !== 'revoked' ? (
                    <ActionButton
                      label={t('revoke')}
                      variant="outline"
                      confirm={t('revokeConfirm', { name: collector.alias })}
                      run={() =>
                        api(`/collectors/${id}/authorization`, {
                          method: 'POST',
                          body: {
                            decision: 'revoke',
                            ...(reason.trim() && { reason: reason.trim() }),
                          },
                        })
                      }
                      onDone={reloadAll}
                    />
                  ) : null}
                  {user.can('tag:revoke') && collector.nfcTagId ? (
                    <ActionButton
                      label={t('revokeTag')}
                      variant="outline"
                      confirm={t('revokeTagConfirm')}
                      run={() => api(`/collectors/${id}/tags/revoke`, { method: 'POST', body: {} })}
                      onDone={reloadAll}
                    />
                  ) : null}
                </div>
              </div>
            </Panel>

            <Panel title={t('wallet')}>
              {destination ? (
                <KeyValue
                  items={[
                    {
                      k: t('col.status'),
                      v: <DomainPill domain="destination" value={destination.status} />,
                    },
                    { k: t('address'), v: <Mono>{destination.address ?? t('hidden')}</Mono> },
                    { k: t('provider'), v: destination.providerHint ?? t('unknown') },
                    {
                      k: t('verifiedAt'),
                      v: destination.verifiedAt
                        ? formatDateTime(destination.verifiedAt, tz)
                        : t('notYet'),
                    },
                    ...(destination.validationError
                      ? [{ k: t('validationError'), v: destination.validationError }]
                      : []),
                  ]}
                />
              ) : (
                <p className="text-sm text-muted-foreground">{t('noWallet')}</p>
              )}
              {destination ? (
                <div className="mt-3">
                  <ActionButton
                    label={t('revokeWallet')}
                    variant="outline"
                    confirm={t('revokeWalletConfirm')}
                    run={() =>
                      api(`/collectors/${id}/destinations/${destination.id}/revoke`, {
                        method: 'POST',
                        body: {},
                      })
                    }
                    onDone={reloadAll}
                  />
                </div>
              ) : null}

              <form onSubmit={(e) => void onAttach(e)} className="mt-5 max-w-lg space-y-3">
                <TextField
                  label={destination ? t('replaceWallet') : t('attachWallet')}
                  hint={t('walletHint')}
                  value={rawCode}
                  onChange={(e) => setRawCode(e.target.value)}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                />
                <Button type="submit" size="sm" disabled={attaching || rawCode.trim().length === 0}>
                  {attaching ? t('attaching') : t('attach')}
                </Button>
                {attachNote ? (
                  <p role="status" className="text-sm">
                    {attachNote}
                  </p>
                ) : null}
                {attachError ? <ErrorNotice error={attachError} /> : null}
              </form>

              {history.data && history.data.destinations.length > 1 ? (
                <div className="mt-5">
                  <h3 className="mb-2 font-display text-sm font-bold">{t('walletHistory')}</h3>
                  <TableWrap minWidth="32rem">
                    <thead>
                      <tr>
                        <Th>{t('address')}</Th>
                        <Th>{t('col.status')}</Th>
                        <Th>{t('added')}</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.data.destinations.map((d) => (
                        <tr key={d.id}>
                          <Td>
                            <Mono>{d.address ?? t('hidden')}</Mono>
                          </Td>
                          <Td>
                            <DomainPill domain="destination" value={d.status} />
                          </Td>
                          <Td>{formatDateTime(d.createdAt, tz)}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </TableWrap>
                </div>
              ) : null}
            </Panel>

            <Panel title={t('recentEvents')}>
              <DataState
                loading={events.loading}
                error={events.error}
                empty={(events.data?.events.length ?? 0) === 0}
                emptyText={t('noEvents')}
                onRetry={events.reload}
              >
                <TableWrap minWidth="32rem">
                  <thead>
                    <tr>
                      <Th>{t('eventWhen')}</Th>
                      <Th>{t('eventWeight')}</Th>
                      <Th>{t('eventPayout')}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.data?.events.map((e) => (
                      <tr key={e.id}>
                        <Td>
                          <Link href={`/events/${e.id}`} className="underline">
                            {formatDateTime(e.recordedAt, tz)}
                          </Link>
                        </Td>
                        <Td>
                          {e.material} {e.weightKg} kg
                        </Td>
                        <Td>
                          {e.payout ? (
                            <DomainPill domain="payout" value={e.payout.status} />
                          ) : (
                            <span className="text-muted-foreground">{t('none')}</span>
                          )}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrap>
              </DataState>
            </Panel>

            <Panel title={t('recentPayouts')}>
              <DataState
                loading={payouts.loading}
                error={payouts.error}
                empty={(payouts.data?.payouts.length ?? 0) === 0}
                emptyText={t('noPayouts')}
                onRetry={payouts.reload}
              >
                <TableWrap minWidth="32rem">
                  <thead>
                    <tr>
                      <Th>{t('eventWhen')}</Th>
                      <Th>{t('col.status')}</Th>
                      <Th>{t('amount')}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {payouts.data?.payouts.map((p) => (
                      <tr key={p.id}>
                        <Td>
                          <Link href={`/payouts/${p.id}`} className="underline">
                            {formatDateTime(p.createdAt, tz)}
                          </Link>
                        </Td>
                        <Td>
                          <DomainPill domain="payout" value={p.status} />
                        </Td>
                        <Td>{formatSats(p.amountSats)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrap>
              </DataState>
            </Panel>
          </>
        ) : (
          <Empty>{t('notFound')}</Empty>
        )}
      </DataState>
    </div>
  );
}
