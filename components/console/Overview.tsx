// SPDX-License-Identifier: AGPL-3.0-only

'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useConsoleUser } from '@/components/console/context';
import { useApi } from '@/components/console/hooks';
import { ErrorNotice, Loading, PageHeader, Panel } from '@/components/console/kit';
import { formatSats } from '@/lib/console/format';
import type { Scope } from '@/lib/auth/permissions';

type Payout = { lastError: string | null };
type Summary = { byStatus: { status: string; count: number }[] };
type Treasury = {
  hotWallet: { available: number | null; lowBalance: boolean | null; error: string | null };
  pendingTopups: unknown[];
};

const CAP = 100;

function Card({
  label,
  hint,
  href,
  value,
  loading,
  attention,
  testId,
}: {
  readonly label: string;
  readonly hint: string;
  readonly href: string;
  readonly value: string;
  readonly loading: boolean;
  readonly attention: boolean;
  readonly testId: string;
}) {
  return (
    <Link
      href={href}
      className="block min-h-11 rounded-lg border border-border bg-card p-4 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <p className="font-display text-xs font-medium uppercase tracking-[0.02em] text-muted-foreground">
        {label}
      </p>
      <p
        className={`mt-2 font-display text-3xl font-bold ${attention ? 'text-foreground' : 'text-muted-foreground'}`}
        data-testid={testId}
      >
        {loading ? '...' : value}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </Link>
  );
}

function countText(n: number): string {
  return n >= CAP ? `${CAP}+` : String(n);
}

export function Overview() {
  const t = useTranslations('Console.overview');
  const user = useConsoleUser();
  const can = (scope: Scope) => user.can(scope);

  const pending = useApi<{ collectors: unknown[] }>(
    can('collector:authorize') ? `/collectors?status=pending&limit=${CAP}` : null,
  );
  const summary = useApi<Summary>(can('payout:read') ? '/payouts/summary' : null);
  const sending = useApi<{ payouts: Payout[] }>(
    can('payout:resolve') ? `/payouts?status=sending&limit=${CAP}` : null,
  );
  const flags = useApi<{ anomalies: unknown[] }>(
    can('anomaly:review') ? `/anomalies?status=open&limit=${CAP}` : null,
  );
  const treasury = useApi<Treasury>(can('treasury:read') ? '/treasury' : null);

  const count = (status: string) =>
    summary.data?.byStatus.find((row) => row.status === status)?.count ?? 0;
  const stuck = sending.data?.payouts.filter((p) => p.lastError === 'outcome_unknown').length ?? 0;
  const anyLoading =
    pending.loading || summary.loading || sending.loading || flags.loading || treasury.loading;
  const firstError = [pending, summary, sending, flags, treasury].find((q) => q.error)?.error;

  return (
    <div>
      <PageHeader title={t('title')} description={t('intro')} />
      {firstError ? <ErrorNotice error={firstError} /> : null}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {can('collector:authorize') ? (
          <Card
            testId="count-pending-collectors"
            label={t('pendingCollectors')}
            hint={t('pendingCollectorsHint')}
            href="/collectors"
            value={countText(pending.data?.collectors.length ?? 0)}
            loading={pending.loading}
            attention={(pending.data?.collectors.length ?? 0) > 0}
          />
        ) : null}
        {can('payout:read') ? (
          <>
            <Card
              testId="count-awaiting-approval"
              label={t('awaitingApproval')}
              hint={t('awaitingApprovalHint')}
              href="/payouts?status=pending_approval"
              value={String(count('pending_approval'))}
              loading={summary.loading}
              attention={count('pending_approval') > 0}
            />
            <Card
              testId="count-awaiting-wallet"
              label={t('awaitingWallet')}
              hint={t('awaitingWalletHint')}
              href="/payouts?status=awaiting_destination"
              value={String(count('awaiting_destination'))}
              loading={summary.loading}
              attention={count('awaiting_destination') > 0}
            />
            <Card
              testId="count-failed"
              label={t('failedPayouts')}
              hint={t('failedPayoutsHint')}
              href="/payouts?status=failed"
              value={String(count('failed'))}
              loading={summary.loading}
              attention={count('failed') > 0}
            />
          </>
        ) : null}
        {can('payout:resolve') ? (
          <Card
            testId="count-stuck"
            label={t('stuckPayouts')}
            hint={t('stuckPayoutsHint')}
            href="/payouts?status=sending"
            value={String(stuck)}
            loading={sending.loading}
            attention={stuck > 0}
          />
        ) : null}
        {can('anomaly:review') ? (
          <Card
            testId="count-flags"
            label={t('openFlags')}
            hint={t('openFlagsHint')}
            href="/anomalies"
            value={countText(flags.data?.anomalies.length ?? 0)}
            loading={flags.loading}
            attention={(flags.data?.anomalies.length ?? 0) > 0}
          />
        ) : null}
        {can('treasury:read') ? (
          <Card
            testId="count-proposals"
            label={t('openProposals')}
            hint={t('openProposalsHint')}
            href="/treasury"
            value={String(treasury.data?.pendingTopups.length ?? 0)}
            loading={treasury.loading}
            attention={(treasury.data?.pendingTopups.length ?? 0) > 0}
          />
        ) : null}
      </div>

      {can('treasury:read') && treasury.data ? (
        <Panel title={t('hotWallet')} className="mt-6">
          {treasury.data.hotWallet.error ? (
            <p className="text-sm text-destructive">{t('hotWalletUnreadable')}</p>
          ) : (
            <p className="text-sm">
              <span className="font-display text-2xl font-bold">
                {formatSats(treasury.data.hotWallet.available)}
              </span>
              {treasury.data.hotWallet.lowBalance ? (
                <span className="ml-3 font-medium">{t('lowBalance')}</span>
              ) : null}
            </p>
          )}
        </Panel>
      ) : null}
      {anyLoading && !firstError ? <Loading /> : null}
    </div>
  );
}
