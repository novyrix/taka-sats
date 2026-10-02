// SPDX-License-Identifier: AGPL-3.0-only

'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useConsoleUser } from '@/components/console/context';
import { useApi } from '@/components/console/hooks';
import { DataState, DomainPill, KeyValue, Mono, PageHeader, Panel } from '@/components/console/kit';
import {
  PayoutActions,
  type PayoutRow,
  StuckPayoutTools,
} from '@/components/console/PayoutActions';
import { formatDateTime, formatFiat, formatSats } from '@/lib/console/format';

/** One payout: state, amount, proof, the flags beside it, and the approve/retry/check/resolve tools. */
export function PayoutDetail({ id }: { readonly id: string }) {
  const t = useTranslations('Console.payouts');
  const user = useConsoleUser();
  const { data, error, loading, reload } = useApi<{ payout: PayoutRow }>(`/payouts/${id}`);
  const payout = data?.payout;
  const tz = user.timeZone;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('detailTitle')}
        actions={
          <Link href="/payouts" className="text-sm underline">
            {t('backToList')}
          </Link>
        }
      />
      <DataState loading={loading} error={error} onRetry={reload}>
        {payout ? (
          <>
            <Panel title={t('overview')}>
              <KeyValue
                items={[
                  { k: t('col.status'), v: <DomainPill domain="payout" value={payout.status} /> },
                  ...(payout.lastError
                    ? [
                        {
                          k: t('lastError'),
                          v: (
                            <>
                              <Mono>{payout.lastError}</Mono>
                              {payout.lastError === 'outcome_unknown' ? (
                                <p className="mt-1 text-sm">{t('outcomeUnknownHelp')}</p>
                              ) : null}
                            </>
                          ),
                        },
                      ]
                    : []),
                  {
                    k: t('col.collector'),
                    v: (
                      <Link href={`/collectors/${payout.collectorId}`} className="underline">
                        {payout.collectorAlias} ({payout.collectorPublicCode})
                      </Link>
                    ),
                  },
                  {
                    k: t('col.amount'),
                    v:
                      payout.amountSats === null
                        ? t('notPriced')
                        : `${formatSats(payout.amountSats)} / ${formatFiat(payout.amountFiatMinor, payout.fiatCurrency)}`,
                  },
                  {
                    k: t('event'),
                    v: (
                      <Link href={`/events/${payout.collectionEventId}`} className="underline">
                        {t('openEvent')}
                      </Link>
                    ),
                  },
                  {
                    k: t('openFlags'),
                    v:
                      payout.openFlags > 0 ? (
                        <Link href="/anomalies" className="underline">
                          {t('flags', { count: payout.openFlags })}
                        </Link>
                      ) : (
                        t('none')
                      ),
                  },
                  {
                    k: t('approvedBy'),
                    v: payout.approvedBy ? (
                      <>
                        <Mono>{payout.approvedBy}</Mono>{' '}
                        <span className="text-muted-foreground">
                          {formatDateTime(payout.approvedAt, tz)}
                        </span>
                      </>
                    ) : (
                      t('notYet')
                    ),
                  },
                  { k: t('attempts'), v: payout.attempts },
                  { k: t('provider'), v: payout.provider ?? t('none') },
                  {
                    k: t('paymentRef'),
                    v: payout.providerPaymentRef ? (
                      <Mono>{payout.providerPaymentRef}</Mono>
                    ) : (
                      t('none')
                    ),
                  },
                  { k: t('col.created'), v: formatDateTime(payout.createdAt, tz) },
                  {
                    k: t('settledAt'),
                    v: payout.settledAt ? formatDateTime(payout.settledAt, tz) : t('notYet'),
                  },
                ]}
              />
              <div className="mt-4">
                <PayoutActions payout={payout} onChanged={reload} />
                {payout.status === 'pending_approval' ? (
                  <p className="mt-2 text-xs text-muted-foreground">{t('approveHint')}</p>
                ) : null}
              </div>
            </Panel>
            <StuckPayoutTools payout={payout} onChanged={reload} />
          </>
        ) : null}
      </DataState>
    </div>
  );
}
